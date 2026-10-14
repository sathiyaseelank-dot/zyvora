import { Kysely, sql } from 'kysely';

/**
 * Session revocation after a credential change — Story ZYV-56 / ZYV-50.
 *
 * The session is a stateless JWT, so changing a password does nothing to
 * cookies already in the wild: a stolen cookie keeps working until it expires,
 * which is seven days by default. That defeats the point of changing a
 * password in response to a suspected compromise.
 *
 * `session_invalid_before` records the instant of the credential change. Any
 * token issued earlier is rejected on the next request, which is the standard
 * way to revoke a stateless session without a server-side session store.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('users')
    .addColumn('session_invalid_before', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('users_session_invalid_before_idx')
    .on('users')
    .column('session_invalid_before')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('users_session_invalid_before_idx')
    .on('users')
    .execute();

  await db.schema
    .alterTable('users')
    .dropColumn('session_invalid_before')
    .execute();

  void sql;
}
