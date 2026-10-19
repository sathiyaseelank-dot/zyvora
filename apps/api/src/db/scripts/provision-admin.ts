/**
 * Provision an administrator account (ZYV-84, the missing half of the story).
 *
 * Self-registration can only ever create a customer — see the comment in
 * routes/auth.ts: "An admin is provisioned, never self-assigned." This script
 * is that provisioning path. It is the only supported way to create an admin,
 * and it is deliberately NOT exposed over HTTP: there is no admin-creating
 * endpoint to attack.
 *
 * Usage:
 *   npm run admin:provision -w @zyvora/api -- <email> [--name "Full Name"]
 *
 * The password is read from the ADMIN_PROVISION_PASSWORD environment variable
 * so it never appears in shell history or in the process argument list.
 *
 *   ADMIN_PROVISION_PASSWORD='...' npm run admin:provision -w @zyvora/api -- \
 *     ss@example.com --name "Site Admin"
 *
 * Safe to re-run: it promotes an existing account or resets its password.
 * It never deletes anything.
 */
import { db } from '../client.js';
import { hashPassword, validatePassword } from '../../auth/password.js';

const args = process.argv.slice(2);
const email = args[0]?.trim().toLowerCase();
const nameIdx = args.indexOf('--name');
const fullName = nameIdx >= 0 ? args[nameIdx + 1]?.trim() : undefined;

function die(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (!email || !email.includes('@')) {
  die(
    'usage: npm run admin:provision -w @zyvora/api -- <email> [--name "Full Name"]',
  );
}

const password = process.env.ADMIN_PROVISION_PASSWORD ?? '';
if (!password) {
  die(
    'ADMIN_PROVISION_PASSWORD is not set. Refusing to provision an account with no password.',
  );
}

// Reuse the application's own rules. Provisioning must not be a way around them.
const problem = validatePassword(password);
if (problem) {
  die(`password rejected by the application rules: ${problem}`);
}

const passwordHash = await hashPassword(password);

const adminRole = await db
  .selectFrom('roles')
  .select('id')
  .where('name', '=', 'admin')
  .executeTakeFirst();
if (!adminRole) {
  die(
    "no 'admin' role exists in the database. Roles come from migration 001 / reference data.",
  );
}

const existing = await db
  .selectFrom('users')
  .select(['id', 'email', 'role_id'])
  .where('email', '=', email)
  .executeTakeFirst();

let outcome: string;

if (existing) {
  await db
    .updateTable('users')
    .set({
      password_hash: passwordHash,
      role_id: adminRole.id,
      updated_at: new Date(),
      ...(fullName ? { full_name: fullName } : {}),
    })
    .where('id', '=', existing.id)
    .execute();
  outcome = `promoted existing account ${email}`;
} else {
  await db
    .insertInto('users')
    .values({
      email,
      password_hash: passwordHash,
      role_id: adminRole.id,
      ...(fullName ? { full_name: fullName } : {}),
    })
    .execute();
  outcome = `created new admin account ${email}`;
}

// Read back from the database rather than trusting the write's own success.
const verified = await db
  .selectFrom('users')
  .innerJoin('roles', 'roles.id', 'users.role_id')
  .select(['users.email', 'users.full_name', 'roles.name as role'])
  .where('users.email', '=', email)
  .executeTakeFirstOrThrow();

console.log(`${outcome}`);
console.log(`  email      ${verified.email}`);
console.log(`  full name  ${verified.full_name ?? '(unset)'}`);
console.log(`  role       ${verified.role}`);
console.log(
  'Log in at /login, then open /admin. The role is read from the database on login.',
);

await db.destroy();
