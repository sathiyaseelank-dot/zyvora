import { Kysely, sql } from 'kysely';

/**
 * Password reset tokens — Story E6-S5 / ZYV-50.
 *
 * The schema has no place to record a reset request, so this adds one.
 *
 * The raw token is NEVER stored. Only an Argon2id hash of it is, for the same
 * reason passwords are hashed: if this table is ever exposed by a dump or a
 * backup, the attacker holds hashes rather than usable reset links. A reset
 * token is a bearer credential with the power to take over an account, so
 * storing it in the clear would make a database leak equivalent to a mass
 * account takeover.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('password_reset_tokens')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`uuid_generate_v4()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('token_hash', 'varchar(255)', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('used_at', 'timestamptz')
    .addColumn('ip_address', 'varchar(45)')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // One active token per user lookup, and expiry sweeps.
  await db.schema
    .createIndex('password_reset_tokens_user_id_idx')
    .on('password_reset_tokens')
    .column('user_id')
    .execute();

  await db.schema
    .createIndex('password_reset_tokens_expires_at_idx')
    .on('password_reset_tokens')
    .column('expires_at')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('password_reset_tokens').execute();
}
