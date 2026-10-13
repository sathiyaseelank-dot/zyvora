import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../http/async-handler.js';
import { db } from '../db/client.js';
import { AppError } from '../http/errors.js';
import { validate, valid } from '../http/validate.js';

/**
 * Administrative boundary — Stories ZYV-35 (enforcement), ZYV-31 (audit).
 *
 * This router holds the enforcement, not the administration. E10 adds the
 * product/order/customer management features; what belongs in E3 is the wall
 * every one of those features must sit behind:
 *
 *   - authentication and role checks applied once, at the mount point
 *   - audit-on-write applied once, so a new admin route is recorded by
 *     default instead of by remembering to add a hook
 *
 * The read-only audit viewer below is not an E10 feature invented here: it is
 * what makes E3-S7 observable. An audit trail nobody can read has not been
 * demonstrated to work. E10-S11 extends this into the full audit view.
 */
export const adminRouter: Router = Router();

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(100).optional(),
});

type AuditQuery = z.infer<typeof auditQuerySchema>;

/**
 * GET /api/admin/audit-log — read-only.
 *
 * The log is append-only: this router exposes no POST/PUT/DELETE, and no code
 * path anywhere in the codebase updates or deletes an audit row.
 */
adminRouter.get(
  '/audit-log',
  validate({ query: auditQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { limit, action, entityType } = valid<AuditQuery>(req, 'query');

    let query = db
      .selectFrom('audit_logs')
      .selectAll()
      .orderBy('created_at', 'desc');

    if (action) query = query.where('action', '=', action);
    if (entityType) query = query.where('entity_type', '=', entityType);

    const rows = await query.limit(limit).execute();

    res.json({ data: rows, meta: { limit } });
  }),
);

const uuidParamSchema = z.object({ id: z.string().uuid() });

/** GET /api/admin/audit-log/:id — a single entry. */
adminRouter.get(
  '/audit-log/:id',
  validate({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<{ id: string }>(req, 'params');

    const row = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!row) throw new AppError('NOT_FOUND', 'Audit entry not found');
    res.json({ data: row });
  }),
);
