-- Index every foreign-key column that does not already have one.
--
-- 16 of the 18 FK columns in this schema had no supporting index. Postgres does
-- not create these automatically, which has two costs that are invisible until
-- the data grows:
--
--   1. ON DELETE CASCADE (and SET NULL) must scan the child table to find
--      matching rows, because without an index there is no way to locate them.
--      Deleting one user cascades to addresses, carts, reviews,
--      password_reset_tokens; scanning each of those on every delete holds locks
--      for the length of the scan.
--   2. Joins driven from the parent side use a sequential scan of the child.
--
-- These are purely additive. No column, constraint or behaviour changes, so
-- this is safe to apply to a database that already holds data.
--
-- The two columns that already have an index are skipped rather than given a
-- duplicate: addresses.user_id (addresses_user_id_idx) and
-- password_reset_tokens.user_id (password_reset_tokens_user_id_idx).

-- identity
create index if not exists users_role_id_idx        on public.users (role_id);
create index if not exists carts_user_id_idx        on public.carts (user_id);
create index if not exists orders_user_id_idx       on public.orders (user_id);
create index if not exists audit_logs_user_id_idx   on public.audit_logs (user_id);

-- carts. carts.session_id is not a foreign key but is the lookup key for every
-- guest cart request — one sequential scan per basket read without it.
create index if not exists carts_session_id_idx     on public.carts (session_id);

-- catalog
create index if not exists products_category_id_idx on public.products (category_id);
create index if not exists inventory_product_id_idx on public.inventory (product_id);
create index if not exists product_images_product_id_idx on public.product_images (product_id);
create index if not exists cart_items_product_id_idx  on public.cart_items (product_id);
create index if not exists reviews_product_id_idx      on public.reviews (product_id);

-- cart. cart_items.cart_id is the single hottest access path in the app: every
-- basket read filters on it.
create index if not exists cart_items_cart_id_idx    on public.cart_items (cart_id);

-- commerce
create index if not exists order_items_order_id_idx   on public.order_items (order_id);
create index if not exists order_items_product_id_idx on public.order_items (product_id);
create index if not exists payments_order_id_idx      on public.payments (order_id);
create index if not exists refunds_payment_id_idx     on public.refunds (payment_id);
create index if not exists shipments_order_id_idx     on public.shipments (order_id);
create index if not exists reviews_user_id_idx        on public.reviews (user_id);

-- orders.checkout_session_id carries no foreign key, but it is how a returning
-- shopper finds their order, and the column is a bare uuid with no lookup
-- behind it.
create index if not exists orders_checkout_session_id_idx on public.orders (checkout_session_id);
