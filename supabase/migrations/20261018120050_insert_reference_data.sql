-- Reference data: roles and categories.
--
-- CAUGHT BY TESTING, NOT BY READING
-- The baseline migration reproduced every table, column, default, foreign key
-- and index, and applied cleanly to an empty database. It was still wrong.
--
-- Migration 001 in apps/api/src/db/migrations does two things: it creates the
-- schema, and it INSERTS the two roles and four categories the application
-- depends on. The seed script reads categories to resolve `category_id` for
-- every product it inserts — it never inserts them itself. A Supabase database
-- built from the schema alone therefore had:
--
--     categories: 0 rows
--     roles:      0 rows
--
-- and `npm run seed` died immediately with
--
--     null value in column "category_id" of relation "products"
--     violates not-null constraint
--
-- which is a confusing way to discover a missing reference table. This
-- migration closes the gap.
--
-- Values are taken from the live database, not from the migration source, so
-- they are what the running application actually reads. `on conflict do
-- nothing` keyed on the natural key makes this idempotent.

insert into public.roles (name, description) values
  ('customer', 'Regular customer'),
  ('admin',    'Administrator with full access')
on conflict (name) do nothing;

-- The four slugs are closed unions in the API layer: categorySchema in
-- apps/api/src/routes/catalog.ts enumerates exactly these. A fifth category
-- added here would not be queryable through the catalog endpoint.
insert into public.categories (name, slug, description) values
  ('Car Flags',   'car-flags',   'Premium car flags for your vehicle'),
  ('Bike Flags',  'bike-flags',  'Stylish bike flags for motorcycles'),
  ('Accessories', 'accessories', 'Mounting accessories and add-ons'),
  ('Gift Sets',   'gift-sets',   'Curated gift sets for enthusiasts')
on conflict (slug) do nothing;
