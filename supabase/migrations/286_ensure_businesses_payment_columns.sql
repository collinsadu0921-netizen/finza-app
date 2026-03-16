-- Ensure payment provider columns exist on businesses (fixes schema cache / missing column errors).
-- Migration 010 adds these; this is idempotent for DBs where 010 ran in a different order or schema cache was stale.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS momo_settings jsonb,
  ADD COLUMN IF NOT EXISTS hubtel_settings jsonb;
