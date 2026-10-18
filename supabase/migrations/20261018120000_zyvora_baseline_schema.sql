-- ZYVORA baseline schema for Supabase.
--
-- WHY ONE FILE RATHER THAN SIX
-- The backend already has six sequential migrations (apps/api/src/db/migrations,
-- 001 through 006). Those stay exactly where they are and still run — see the
-- companion migration `..._reconcile_kysely_migration_ledger.sql`.
--
-- Supabase, by contrast, applies whatever is in supabase/migrations in
-- timestamp order to a database it tracks itself. Porting 001-006 one-for-one
-- would produce six files whose only purpose is to express one schema, and
-- would misrepresent the history: the six Kysely files were authored against a
-- local PostgreSQL instance, not as a Supabase history. A single baseline that
-- reproduces the END state is both honest and easier to review.
--
-- This is generated from the live schema, not transcribed by hand: every
-- table, column, type, default, nullability, foreign key, delete rule, unique
-- constraint and index below was read out of information_schema and pg_indexes
-- on a database that had all six Kysely migrations applied. It also reflects
-- migration 005, which dropped products.stock_quantity — that column is
-- absent here deliberately. inventory is the single source of stock truth.
--
-- Ordering below is dependency order, so this applies cleanly to an empty
-- database.

-- The backend's Kysely migrations use uuid_generate_v4() as the id default.
-- The same expression is used here rather than gen_random_uuid() so the two
-- schema definitions stay textually comparable; both produce a v4 UUID.
create extension if not exists "uuid-ossp";

-- Make the id default resolve deterministically rather than by luck.
--
-- On Supabase, uuid-ossp is installed into the `extensions` schema, not
-- `public`, and the session search_path happens to be
-- `"$user", public, extensions` — so an unqualified `uuid_generate_v4()`
-- works. That is an incidental property of the session default, not a
-- guarantee: a migration runner using a different search_path would fail with
-- "function uuid_generate_v4() does not exist" halfway through, leaving a
-- half-built schema on the production database.
--
-- Pinning it here costs nothing and makes the dependency explicit. Tables are
-- still created schema-qualified below, so this cannot silently redirect them.
set search_path = public, extensions;

-- ---------------------------------------------------------------- identity --

create table if not exists public.roles (
  id uuid primary key default uuid_generate_v4(),
  name varchar(50) not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key default uuid_generate_v4(),
  email varchar(255) not null unique,
  password_hash varchar(255) not null,
  full_name varchar(255),
  mobile varchar(20),
  role_id uuid not null references public.roles (id) on delete no action,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Added by migration 004. Every session issued at or before this instant is
  -- rejected, which is what makes a password reset log other devices out.
  session_invalid_before timestamptz
);

create index if not exists users_session_invalid_before_idx
  on public.users (session_invalid_before);

create table if not exists public.addresses (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users (id) on delete cascade,
  full_name varchar(255) not null,
  mobile varchar(20) not null,
  email varchar(255) not null,
  house_number_and_street text not null,
  area varchar(255) not null,
  landmark text,
  city varchar(100) not null,
  state varchar(100) not null,
  pin_code varchar(10) not null,
  country varchar(100) not null,
  delivery_instructions text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- Migration 006. Without this index every "my addresses" read was a
-- sequential scan.
create index if not exists addresses_user_id_idx
  on public.addresses (user_id);

-- Also from 006. A plain unique on (user_id, is_default) would forbid more
-- than one non-default address, so this is a PARTIAL unique index. Two
-- concurrent "make this my default" requests both read zero defaults and both
-- write one; only this constraint stops the second.
create unique index if not exists addresses_one_default_per_user
  on public.addresses (user_id)
  where is_default;

create table if not exists public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users (id) on delete set null,
  action varchar(100) not null,
  entity_type varchar(100) not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address varchar(45),
  user_agent text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- catalog --

create table if not exists public.categories (
  id uuid primary key default uuid_generate_v4(),
  name varchar(100) not null unique,
  slug varchar(100) not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default uuid_generate_v4(),
  name varchar(255) not null,
  description text not null,
  category_id uuid not null references public.categories (id) on delete no action,
  -- Whole rupees. Money is an integer end to end; only formatting to "₹1,999"
  -- happens at the edge, never in the database.
  price int not null,
  image varchar(500) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_images (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products (id) on delete cascade,
  url varchar(500) not null,
  alt_text varchar(255),
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

-- On-hand and reserved, so a checkout in flight cannot oversell.
create table if not exists public.inventory (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products (id) on delete cascade,
  quantity int not null,
  reserved_quantity int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  rating int not null,
  title varchar(255),
  body text,
  is_verified_purchase boolean not null default false,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------------- cart --
--
-- user_id and session_id are both nullable and never both set: an account cart
-- has user_id, a guest cart has session_id. This is what lets the same table
-- serve both.

create table if not exists public.carts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users (id) on delete cascade,
  session_id varchar(255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cart_items (
  id uuid primary key default uuid_generate_v4(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete no action,
  -- No price column, deliberately. Every total is recomputed from
  -- products.price on read, so a repriced product cannot sit in a basket
  -- holding a stale figure.
  quantity int not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- commerce --

create table if not exists public.coupons (
  id uuid primary key default uuid_generate_v4(),
  code varchar(50) not null unique,
  discount_type varchar(20) not null,
  discount_value int not null,
  min_order_amount int,
  max_discount int,
  usage_limit int,
  used_count int not null default 0,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users (id) on delete no action,
  checkout_session_id uuid not null,
  subtotal int not null,
  shipping int not null default 0,
  tax int not null default 0,
  discount int not null default 0,
  total int not null,
  status varchar(50) not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete no action,
  -- Name and unit_price are snapshotted deliberately: an order must keep
  -- showing what was bought even after the product is renamed or repriced.
  name varchar(255) not null,
  unit_price int not null,
  quantity int not null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references public.orders (id) on delete cascade,
  razorpay_order_id varchar(100),
  razorpay_payment_id varchar(100),
  amount int not null,
  currency varchar(3) not null default 'INR',
  status varchar(50) not null,
  method varchar(50),
  created_at timestamptz not null default now()
);

create table if not exists public.refunds (
  id uuid primary key default uuid_generate_v4(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  amount int not null,
  reason text not null,
  status varchar(50) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references public.orders (id) on delete cascade,
  carrier varchar(100),
  tracking_number varchar(100),
  status varchar(50) not null,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- password --
--
-- Added by migration 003. The raw reset token is never stored: only its
-- Argon2id hash, keyed by the row id.

create table if not exists public.password_reset_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash varchar(255) not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  ip_address varchar(45),
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_id_idx
  on public.password_reset_tokens (user_id);

create index if not exists password_reset_tokens_expires_at_idx
  on public.password_reset_tokens (expires_at);
