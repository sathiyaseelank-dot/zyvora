import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import { db } from '../db/client.js';
import { asyncHandler } from '../http/async-handler.js';
import { AppError } from '../http/errors.js';
import { validate, valid } from '../http/validate.js';
import { requireAuth } from '../http/auth.js';

/**
 * Address book (ZYV-58).
 *
 *   GET    /api/addresses
 *   POST   /api/addresses
 *   GET    /api/addresses/:id
 *   PATCH  /api/addresses/:id
 *   DELETE /api/addresses/:id
 *
 * Authenticated throughout. An address is personal data — a street, a mobile
 * and a full name — so there is no guest path here at all; a signed-out
 * caller gets 401 from requireAuth before any handler runs.
 *
 * The default-address rule is enforced by a partial unique index (migration
 * 006), not by this code. The handler clears the other defaults first so the
 * request succeeds, but the constraint is what makes it true under concurrency:
 * two simultaneous "make this my default" requests would both read zero
 * defaults, and only the index stops the second write.
 */

const MAX_ADDRESSES = 10;

const addressBodySchema = z.object({
  fullName: z.string().trim().min(2).max(255),
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Mobile must be a 10-digit Indian number'),
  email: z.string().trim().toLowerCase().email().max(255),
  houseNumberAndStreet: z.string().trim().min(3).max(500),
  area: z.string().trim().min(2).max(255),
  landmark: z.string().trim().max(500).nullish(),
  city: z.string().trim().min(2).max(255),
  state: z.string().trim().min(2).max(255),
  pinCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'PIN code must be 6 digits'),
  country: z.string().trim().min(2).max(255).default('India'),
  deliveryInstructions: z.string().trim().max(500).nullish(),
  isDefault: z.boolean().default(false),
});

/** PATCH accepts any subset. `isDefault` alone is the common case. */
const addressPatchSchema = addressBodySchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });

const idParamSchema = z.object({
  id: z.string().uuid('Address id must be a UUID'),
});

type AddressRow = {
  id: string;
  /** Nullable in the schema, never null in practice: every route is authed. */
  user_id: string | null;
  full_name: string;
  mobile: string;
  email: string;
  house_number_and_street: string;
  area: string;
  landmark: string | null;
  city: string;
  state: string;
  pin_code: string;
  country: string;
  delivery_instructions: string | null;
  is_default: boolean;
};

/**
 * Wire shape for the client: camelCase, and nothing else.
 *
 * A serialiser rather than `return row` so the snake_case column names never
 * reach the frontend, and so fields added to the table later do not silently
 * start being exposed.
 */
function toAddress(row: AddressRow) {
  return {
    id: row.id,
    fullName: row.full_name,
    mobile: row.mobile,
    email: row.email,
    houseNumberAndStreet: row.house_number_and_street,
    area: row.area,
    landmark: row.landmark,
    city: row.city,
    state: row.state,
    pinCode: row.pin_code,
    country: row.country,
    deliveryInstructions: row.delivery_instructions,
    isDefault: row.is_default,
  };
}

/** Columns selected in a fixed order, so every query is consistent. */
const COLUMNS = [
  'id',
  'user_id',
  'full_name',
  'mobile',
  'email',
  'house_number_and_street',
  'area',
  'landmark',
  'city',
  'state',
  'pin_code',
  'country',
  'delivery_instructions',
  'is_default',
] as const;

/**
 * Read an address that belongs to `userId`.
 *
 * Scoping by user in the WHERE clause — rather than fetching by id and
 * comparing afterwards — means another account's address is indistinguishable
 * from one that does not exist, so the endpoint cannot be used to discover that
 * a given id is real.
 */
async function ownedAddress(userId: string, addressId: string) {
  const row = await db
    .selectFrom('addresses')
    .select([...COLUMNS])
    .where('id', '=', addressId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!row) throw new AppError('NOT_FOUND', 'Address not found');
  return row;
}

/**
 * Clear every other default for this user.
 *
 * Runs before setting a new one so the partial unique index never sees two
 * defaults at once. Within a transaction, so a rollback leaves the previous
 * default intact rather than leaving the user with none.
 */
async function clearOtherDefaults(userId: string, keepId: string) {
  await db
    .updateTable('addresses')
    .set({ is_default: false })
    .where('user_id', '=', userId)
    .where('id', '!=', keepId)
    .where('is_default', '=', true)
    .execute();
}

export const addressRouter: Router = Router();

/*
 * Scoped to the /addresses PREFIX, not applied router-wide.
 *
 * `router.use(requireAuth())` with no path runs for every request that ENTERS
 * the router, including ones that match no address route. This router is
 * mounted at /api, so that form 401'd every anonymous request behind it —
 * including the guest cart and checkout-validation endpoints registered after
 * it. Scoping to the prefix keeps the safety property (a route added under
 * /addresses later is authenticated by default) without capturing the rest
 * of the API.
 */
addressRouter.use('/addresses', requireAuth());

addressRouter.get(
  '/addresses',
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await db
      .selectFrom('addresses')
      .select([...COLUMNS])
      .where('user_id', '=', req.user!.id)
      // Default first, then most recently used. A stable order matters here:
      // without it the list can reorder between renders and the highlighted
      // default appears to move.
      .orderBy('is_default', 'desc')
      .orderBy('created_at', 'desc')
      .execute();

    res.json({ data: rows.map(toAddress) });
  }),
);

addressRouter.post(
  '/addresses',
  validate({ body: addressBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = valid<z.infer<typeof addressBodySchema>>(req, 'body');
    const userId = req.user!.id;

    const existing = await db
      .selectFrom('addresses')
      .select('id')
      .where('user_id', '=', userId)
      .execute();

    if (existing.length >= MAX_ADDRESSES) {
      throw new AppError(
        'VALIDATION_ERROR',
        `You can save at most ${MAX_ADDRESSES} addresses`,
      );
    }

    // The first address a person saves is their default whether they ticked
    // the box or not — an address book where nothing is default sends the
    // checkout asking "which one?" every time.
    const isFirst = existing.length === 0;
    const wantDefault = body.isDefault || isFirst;

    const id = randomUUID();

    const created = await db.transaction().execute(async (trx) => {
      if (wantDefault) {
        await trx
          .updateTable('addresses')
          .set({ is_default: false })
          .where('user_id', '=', userId)
          .where('is_default', '=', true)
          .execute();
      }

      return trx
        .insertInto('addresses')
        .values({
          id,
          user_id: userId,
          full_name: body.fullName,
          mobile: body.mobile,
          email: body.email,
          house_number_and_street: body.houseNumberAndStreet,
          area: body.area,
          landmark: body.landmark ?? null,
          city: body.city,
          state: body.state,
          pin_code: body.pinCode,
          country: body.country,
          delivery_instructions: body.deliveryInstructions ?? null,
          is_default: wantDefault,
          created_at: new Date(),
        })
        .returning([...COLUMNS])
        .executeTakeFirstOrThrow();
    });

    res.status(201).json({ data: toAddress(created) });
  }),
);

addressRouter.get(
  '/addresses/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<z.infer<typeof idParamSchema>>(req, 'params');
    const row = await ownedAddress(req.user!.id, id);
    res.json({ data: toAddress(row) });
  }),
);

addressRouter.patch(
  '/addresses/:id',
  validate({ params: idParamSchema, body: addressPatchSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<z.infer<typeof idParamSchema>>(req, 'params');
    const body = valid<z.infer<typeof addressPatchSchema>>(req, 'body');
    const userId = req.user!.id;

    // Confirms ownership before anything is written.
    await ownedAddress(userId, id);

    const patch: Record<string, unknown> = {};
    if (body.fullName !== undefined) patch.full_name = body.fullName;
    if (body.mobile !== undefined) patch.mobile = body.mobile;
    if (body.email !== undefined) patch.email = body.email;
    if (body.houseNumberAndStreet !== undefined)
      patch.house_number_and_street = body.houseNumberAndStreet;
    if (body.area !== undefined) patch.area = body.area;
    if (body.landmark !== undefined) patch.landmark = body.landmark ?? null;
    if (body.city !== undefined) patch.city = body.city;
    if (body.state !== undefined) patch.state = body.state;
    if (body.pinCode !== undefined) patch.pin_code = body.pinCode;
    if (body.country !== undefined) patch.country = body.country;
    if (body.deliveryInstructions !== undefined)
      patch.delivery_instructions = body.deliveryInstructions ?? null;

    const updated = await db.transaction().execute(async (trx) => {
      if (body.isDefault === true) {
        await clearOtherDefaults(userId, id);
      }
      if (body.isDefault === false) {
        // Un-defaulting the only address would leave the account with none, and
        // checkout needs somewhere to deliver. Refused rather than silently
        // ignored: the client asked for something specific.
        const others = await trx
          .selectFrom('addresses')
          .select('id')
          .where('user_id', '=', userId)
          .where('id', '!=', id)
          .execute();
        if (others.length === 0) {
          throw new AppError(
            'VALIDATION_ERROR',
            'This is your only address — mark another as default instead',
          );
        }
      }
      if (body.isDefault !== undefined) patch.is_default = body.isDefault;

      return trx
        .updateTable('addresses')
        .set(patch)
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .returning([...COLUMNS])
        .executeTakeFirstOrThrow();
    });

    res.json({ data: toAddress(updated) });
  }),
);

addressRouter.delete(
  '/addresses/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = valid<z.infer<typeof idParamSchema>>(req, 'params');
    const userId = req.user!.id;

    await ownedAddress(userId, id);

    await db.transaction().execute(async (trx) => {
      const removed = await trx
        .deleteFrom('addresses')
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .returning('is_default')
        .executeTakeFirst();

      // Deleting your default would leave the account with none, and checkout
      // has nowhere to deliver. Promote the next one instead.
      if (removed?.is_default) {
        const next = await trx
          .selectFrom('addresses')
          .select('id')
          .where('user_id', '=', userId)
          .orderBy('created_at', 'desc')
          .executeTakeFirst();

        if (next) {
          await trx
            .updateTable('addresses')
            .set({ is_default: true })
            .where('id', '=', next.id)
            .execute();
        }
      }
    });

    res.status(204).send();
  }),
);
