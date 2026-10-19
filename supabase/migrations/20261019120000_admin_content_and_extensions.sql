-- Migration 20261019120000_admin_content_and_extensions.sql
-- Supports ZYV-78 (compare_at_price) and ZYV-93 (banners, content_blocks)

SET search_path = public, extensions;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS compare_at_price integer;

CREATE TABLE IF NOT EXISTS public.banners (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  title character varying(255) NOT NULL,
  image_url character varying(1024) NOT NULL,
  link_url character varying(1024),
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_blocks (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  slug character varying(100) NOT NULL UNIQUE,
  title character varying(255) NOT NULL,
  body text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

INSERT INTO public.content_blocks (slug, title, body)
VALUES
  ('shipping-policy', 'Shipping Policy', 'Standard delivery within 3-5 business days across India.'),
  ('cancellation-policy', 'Cancellation Policy', 'Orders may be cancelled within 2 hours of placement before dispatch.'),
  ('return-refund-policy', 'Return & Refund Policy', 'Items may be returned within 7 days of delivery in original condition.'),
  ('privacy-policy', 'Privacy Policy', 'We value customer privacy and do not sell personal data.'),
  ('terms-and-conditions', 'Terms & Conditions', 'Use of ZYVORA storefront is subject to standard terms of service.')
ON CONFLICT (slug) DO NOTHING;

-- Enable RLS by default
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_blocks ENABLE ROW LEVEL SECURITY;
