-- Migration 20261019140000: order address snapshot and customer order lifecycle fields
-- Equivalent to apps/api/src/db/migrations/008_order_address_and_lifecycle.ts

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_address_id uuid REFERENCES public.addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shipping_address_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS return_reason text,
  ADD COLUMN IF NOT EXISTS return_requested_at timestamp with time zone;
