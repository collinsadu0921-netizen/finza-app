-- Migration 343: Add vat_scheme to businesses
-- Phase 1 of VAT compliance status support.
-- Default is 'standard' so all existing businesses are unaffected.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS vat_scheme TEXT NOT NULL DEFAULT 'standard'
  CHECK (vat_scheme IN ('standard', 'vfrs', 'none'));

COMMENT ON COLUMN businesses.vat_scheme IS
  'VAT registration scheme: standard = VAT-registered standard rate (15%+NHIL+GETFund), vfrs = VAT Flat Rate Scheme (3% flat, retailers), none = not VAT registered';
