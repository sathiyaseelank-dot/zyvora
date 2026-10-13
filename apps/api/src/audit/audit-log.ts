import type { Request, Response, NextFunction } from 'express';

import { db } from '../db/client.js';
import { logger, redact } from '../http/logger.js';

/**
 * Audit hooks — Story ZYV-31.
 *
 * Records administrative and security-relevant actions in `audit_logs` with
 * actor, action, target, before/after values, IP and user agent.
 *
 * Three deliberate rules:
 *   1. The log is append-only. Nothing in the codebase updates or deletes a
 *      row (E2-S5 acceptance criterion).
 *   2. An audit failure must never break the operation being audited. If the
 *      insert fails we log loudly and continue — losing an audit row is bad,
 *      but rejecting a customer's order because the audit table is locked is
 *      worse. The E10-S11 audit viewer surfaces gaps.
 *   3. A failure must never be SILENT. `audit()` returns null on failure and
 *      every caller must treat null as "this action was not recorded".
 */

export interface AuditEntry {
  /** Dotted verb, e.g. `product.updated`, `order.status_changed`. */
  action: string;
  entityType: string;
  /**
   * Target identifier.
   *
   * The column is a uuid, but real targets are not always uuids — orders are
   * addressed by order number (`ZYV-ORD-1001`), products by SKU. A non-uuid
   * value is preserved under `entityRef` in the JSON payload instead of being
   * silently dropped, which is what this function used to do.
   */
  entityId?: string | null;
  /** Prior values; redacted before storage. */
  oldValues?: Record<string, unknown> | null;
  /** New values; redacted before storage. */
  newValues?: Record<string, unknown> | null;
  /** Overrides `req.user` — for actions performed by the system itself. */
  userId?: string | null;
}

export interface AuditResult {
  id: string | null;
  ok: boolean;
  /** Populated when ok is false, for logging by the caller. */
  error?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Column widths from migration 002. Exceeding them aborts the insert. */
const MAX_ACTION = 100;
const MAX_ENTITY_TYPE = 100;
const MAX_IP = 45;

const TRUNCATED = '…';

function clamp(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + TRUNCATED;
}

function currentUserId(req: Request): string | null {
  return req.user?.id ?? null;
}

/**
 * Append an audit entry derived from a request.
 *
 * Never throws. Returns the inserted row id and whether the write succeeded —
 * a null `id` means the action was NOT recorded and the caller must not
 * assume otherwise.
 */
export async function audit(
  req: Request,
  entry: AuditEntry,
): Promise<AuditResult> {
  const entityId = entry.entityId ?? null;
  const isUuid = entityId !== null && UUID_RE.test(entityId);

  // A non-uuid target would abort the insert on the uuid column, which is how
  // this function used to lose every audit row for order numbers and SKUs
  // without telling anyone. Keep the reference in the payload instead.
  const entityRef = !isUuid && entityId !== null ? entityId : null;

  // `newValues` is legitimately null when the caller passed no body, so
  // entityRef must build a fresh object rather than assign through a cast — a
  // cast would satisfy the type checker and then throw at runtime.
  const newValues: Record<string, unknown> | null =
    entry.newValues || entityRef !== null
      ? {
          ...(entityRef !== null ? { entityRef } : {}),
          ...(entry.newValues ?? {}),
        }
      : null;

  return writeAuditRow(req, entry, isUuid ? entityId : null, newValues);
}

async function writeAuditRow(
  req: Request,
  entry: AuditEntry,
  entityId: string | null,
  newValues: Record<string, unknown> | null,
): Promise<AuditResult> {
  try {
    const row = await db
      .insertInto('audit_logs')
      .values({
        user_id: entry.userId !== undefined ? entry.userId : currentUserId(req),
        action: clamp(entry.action, MAX_ACTION),
        entity_type: clamp(entry.entityType, MAX_ENTITY_TYPE),
        entity_id: entityId,
        old_values: entry.oldValues
          ? (redact(entry.oldValues) as Record<string, unknown>)
          : null,
        new_values: newValues
          ? (redact(newValues) as Record<string, unknown>)
          : null,
        ip_address: req.ip ? clamp(req.ip, MAX_IP) : null,
        user_agent: req.get('user-agent') ?? null,
      })
      .returning('id')
      .executeTakeFirst();

    if (!row) return { id: null, ok: false, error: 'insert returned no row' };
    return { id: row.id, ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('audit write failed', {
      action: entry.action,
      entityType: entry.entityType,
      entityId,
      error,
    });
    return { id: null, ok: false, error };
  }
}

/**
 * Default audit middleware for an administrative boundary.
 *
 * Every successful state-changing request under the mount point is recorded.
 * Placing the action here means a new admin route is audited by default
 * rather than by someone remembering to add a hook.
 *
 *   app.use('/api/admin', requireAuth(), requireAdmin, auditAdmin('product'), adminRouter);
 *
 * The action is derived from method and entityType — deliberately NOT from the
 * request path. Embedding the concrete path puts the resource id inside the
 * action string, producing a distinct action per row and making "show me every
 * admin.patch on a product" unqueryable.
 */
export function auditAdmin(
  entityType = 'unknown',
): (req: Request, res: Response, next: NextFunction) => void {
  return function auditHook(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // Fire after the response is sent: the row reflects an operation that
    // actually completed, and its latency never reaches the caller.
    res.on('finish', () => {
      // Only successful mutations. A 4xx/5xx changed nothing, so there is
      // nothing to record, and a failed write must not be mistaken for one.
      if (res.statusCode >= 400) return;
      if (
        req.method === 'GET' ||
        req.method === 'HEAD' ||
        req.method === 'OPTIONS'
      ) {
        return;
      }

      void audit(req, {
        action: `admin.${req.method.toLowerCase()}.${entityType}`,
        entityType,
        entityId: (req.params?.id as string | undefined) ?? null,
        newValues:
          typeof req.valid?.body === 'object' && req.valid.body
            ? (req.valid.body as Record<string, unknown>)
            : null,
      });
    });
    next();
  };
}
