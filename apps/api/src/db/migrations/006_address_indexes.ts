import { Kysely, sql } from 'kysely';

/**
 * Migration 006 — address integrity and lookup indexes.
 *
 * Two gaps in the schema as built by migration 001:
 *
 * 1. `addresses` had no index on `user_id`. Every "my addresses" lookup — the
 *    first thing GET /api/addresses does — was a sequential scan of the table.
 *    Fine at seed size, wrong at any real volume.
 *
 * 2. Nothing stopped a user marking two addresses as default. The column is
 *    just a boolean; the constraint has to be a partial UNIQUE index, because
 *    a plain unique on (user_id, is_default) would also forbid more than one
 *    non-default address.
 *
 * The uniqueness is enforced HERE rather than in the handler on purpose. Two
 * concurrent "mark this as my default" requests both read zero defaults, both
 * write one, and the second either overwrites the first or leaves two
 * depending on which code path won. A partial unique index makes the second
 * write fail regardless of how it arrived.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // If the data already violates the rule, collapse it: keep the oldest
  // default per user and clear the rest. Without this the index below would
  // fail to build on a database that has drifted.
  await sql`
    UPDATE addresses a
       SET is_default = false
     WHERE a.is_default
       AND a.id <> (
         SELECT b.id FROM addresses b
          WHERE b.user_id = a.user_id AND b.is_default
          ORDER BY b.created_at ASC, b.id ASC
          LIMIT 1
       )
  `.execute(db);

  await sql`CREATE INDEX IF NOT EXISTS addresses_user_id_idx
              ON addresses (user_id)`.execute(db);

  // One default per user, and only one.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default_per_user
              ON addresses (user_id)
              WHERE is_default`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS addresses_one_default_per_user`.execute(db);
  await sql`DROP INDEX IF EXISTS addresses_user_id_idx`.execute(db);
}
