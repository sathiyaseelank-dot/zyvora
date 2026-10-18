-- Reconcile the backend's Kysely migration ledger with the Supabase schema.
--
-- THE PROBLEM THIS PREVENTS
-- The backend runs its own migration runner (`npm run migrate`, Kysely's
-- Migrator over apps/api/src/db/migrations). Kysely records what it has
-- applied in `kysely_migration`, and on every boot of a fresh environment
-- someone runs `npm run migrate` — the documented way to set the database up.
--
-- Once the schema comes from these Supabase migrations instead, Kysely sees an
-- empty ledger, believes 001-006 have never run, and tries to CREATE TABLE on
-- tables that already exist. Production fails at deploy time with
-- `relation "users" already exists`.
--
-- So the six migrations are marked applied here. The effect is that the Kysely
-- runner no-ops against a Supabase-provisioned database, and still does its
-- real work against a fresh local one — where these rows do not exist.
--
-- This is reconciliation, not a substitute for running anything. Every object
-- below genuinely exists: the baseline migration above created exactly this
-- schema, including the effects of 005 (products.stock_quantity dropped) and
-- 006 (the two address indexes). Marking them applied is a true statement, not
-- a suppression.
--
-- `on conflict do nothing` makes this safe to run more than once.

create table if not exists public.kysely_migration (
  name varchar(255) not null primary key,
  timestamp varchar(255) not null
);

create table if not exists public.kysely_migration_lock (
  id varchar(255) not null primary key,
  is_locked integer not null default 0
);

insert into public.kysely_migration (name, timestamp)
values
  ('001_initial_schema',              '2026-10-14T00:59:03.735Z'),
  ('002_commerce_orders_engagement', '2026-10-14T00:59:03.773Z'),
  ('003_password_reset_tokens',      '2026-10-14T01:58:20.619Z'),
  ('004_session_revocation',         '2026-10-14T13:11:56.856Z'),
  ('005_stock_single_source',        '2026-10-18T04:51:29.632Z'),
  ('006_address_indexes',            '2026-10-18T06:25:00.123Z')
on conflict (name) do nothing;

insert into public.kysely_migration_lock (id, is_locked)
values ('migration_lock', 0)
on conflict (id) do nothing;
