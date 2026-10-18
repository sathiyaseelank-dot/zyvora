-- Row Level Security: deny the Supabase API roles, leave the backend untouched.
--
-- WHY THIS IS NEEDED, EVEN THOUGH THE APP NEVER CALLS SUPABASE
-- On Supabase, every table in the `public` schema is reachable over PostgREST
-- using the project's `anon` key. That key is published in browser bundles by
-- design — Supabase's own docs describe shipping it to the client. This
-- application does not use it, but "the app doesn't use it" is not a control:
-- the anon key is public, and without RLS the following are readable by anyone
-- who has visited the site:
--
--     GET /rest/v1/users?select=*        -> every row, including password_hash
--     GET /rest/v1/audit_logs            -> the full audit trail
--     GET /rest/v1/password_reset_tokens -> Argon2id hashes of live reset tokens
--
-- RLS with no policies denies everything to a role. That is the correct
-- posture here: the ONLY legitimate access path is the Express backend, which
-- connects with the pooler `postgres` role over DATABASE_URL.
--
-- WHY THIS DOES NOT BREAK THE BACKEND
-- Row Level Security does not apply to the table OWNER. The `postgres` role is
-- the owner of objects it creates, so enabling RLS (without FORCE) leaves the
-- backend's access completely unchanged. Only `anon` and `authenticated` — the
-- roles PostgREST switches to for API requests — are denied.
--
-- VERIFY BEFORE RELYING ON IT
--   1. Apply this migration.
--   2. With the anon key: curl "$SUPABASE_URL/rest/v1/users?select=*"
--      -apikey: "$ANON_KEY"   -> expect [] (or 401), never rows.
--   3. Against the app: log in, load the catalog and the cart. If ANY request
--      fails with "permission denied for table", the backend is connecting as
--      a non-owner role; drop this file and fix the connection instead.
--
-- This is deliberately a separate migration, applied AFTER the schema, so that
-- a problem with the connection role is discovered against a working
-- application rather than during the initial deploy.

alter table public.roles                    enable row level security;
alter table public.users                    enable row level security;
alter table public.addresses                enable row level security;
alter table public.audit_logs               enable row level security;
alter table public.carts                    enable row level security;
alter table public.cart_items               enable row level security;
alter table public.categories               enable row level security;
alter table public.products                 enable row level security;
alter table public.product_images           enable row level security;
alter table public.inventory                enable row level security;
alter table public.reviews                  enable row level security;
alter table public.coupons                  enable row level security;
alter table public.orders                   enable row level security;
alter table public.order_items              enable row level security;
alter table public.payments                 enable row level security;
alter table public.refunds                  enable row level security;
alter table public.shipments                enable row level security;
alter table public.password_reset_tokens    enable row level security;

-- Kysely's own bookkeeping. Denying these costs nothing: the backend is the
-- owner and bypasses RLS, and the Supabase API has no business reading a
-- migration ledger.
alter table public.kysely_migration          enable row level security;
alter table public.kysely_migration_lock     enable row level security;

-- No policies are created on purpose. A table with RLS enabled and zero
-- policies denies every statement to every non-owner role, which is what we
-- want. Adding a permissive policy later would open the table again and must be
-- a deliberate, reviewed change.
