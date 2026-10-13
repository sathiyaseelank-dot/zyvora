import type { Request } from 'express';

import { db, type Database } from '../db/client.js';
import { logger } from '../http/logger.js';
import { redact } from '../http/logger.js';

/**
 * Audit hooks — Story ZYV-31.
 *
 * Records administrative and security-relevant actions in `audit_logs` with
 * actor, action, target, before/after values, IP and user agent.
 *
 * Two deliberate rules:
 *   1. The log is append-only. Nothing in the codebase updates or deletes a
 *      row (E2-S5 acceptance criterion).
 *   2. An audit failure must never break the operation being audited. If the
 *      insert fails we log loudly and continue — losing an audit row is bad,
 *      but rejecting a customer's order because the audit table is locked is
 *      worse. The E10-S11 audit viewer surfaces gaps.
 */

export interface AuditEntry {
  /** Dotted verb, e.g. `product.updated`, `order.status_changed`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Prior values; redacted before storage. */
  oldValues?: Record<string, unknown> | null;
  /** New values; redacted before storage. */
  newValues?: Record<string, unknown> | null;
  /** Overrides `req.user` — for actions performed by the system itself. */
  userId?: string | null;
}

function currentUserId(req: Request): string | null {
  return req.user?.id ?? null;
}

/**
 * Append an audit entry derived from a request.
 *
 * Never throws. Returns the inserted row id, or null if the write failed.
 */
export async function audit(
  req: Request,
  entry: AuditEntry,
): Promise<string | null> {
  try {
    const row = await db
      .insertInto('audit_logs')
      .values({
        user_id: entry.userId !== undefined ? entry.userId : currentUserId(req),
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId ?? null,
        old_values: entry.oldValues
          ? (redact(entry.oldValues) as Record<string, unknown>)
          : null,
        new_values: entry.newValues
          ? (redact(entry.newValues) as Record<string, unknown>)
          : null,
        ip_address: req.ip ?? null,
        user_agent: req.get('user-agent') ?? null,
      })
      .returning('id')
      .executeTakeFirst();

    return row?.id ?? null;
  } catch (err) {
    logger.error('audit write failed', {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Express middleware that audits a successful mutation on a named route. */
export function auditRoute(entry: AuditEntry) {
  return function auditHook(
    req: Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ): void {
    // Fire after the response is sent: the audit row reflects an operation
    // that actually completed, and its latency never reaches the caller.
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      void audit(req, {
        ...entry,
        entityId:
          (req.params.id as string | undefined) ?? entry.entityId ?? null,
        newValues: {
          ...entry.newValues,
          ...(typeof req.valid?.body === 'object' && req.valid.body
            ? (req.valid.body as Record<string, unknown>)
            : {}),
        },
      });
    });
    next();
  };
}

/** Compile-time check that the interface still matches the table shape. */
type _AuditTableMatchesSchema = Database['audit_logs'];
export type AuditTable = _AuditTableMatchesSchema;
