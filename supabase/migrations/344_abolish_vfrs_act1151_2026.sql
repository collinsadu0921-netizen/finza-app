-- Migration 344: Abolish VFRS — Value Added Tax Act, 2025 (Act 1151)
-- Effective January 1, 2026, the VAT Flat Rate Scheme (VFRS) was abolished in Ghana.
-- All businesses previously on VFRS are migrated to the standard rate.
-- The CHECK constraint is updated to remove 'vfrs' as a valid value.

-- 1. Migrate any existing VFRS businesses to standard rate
UPDATE businesses
SET vat_scheme = 'standard'
WHERE vat_scheme = 'vfrs';

-- 2. Drop old constraint and replace with updated one (no vfrs)
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_vat_scheme_check;
ALTER TABLE businesses
  ADD CONSTRAINT businesses_vat_scheme_check
  CHECK (vat_scheme IN ('standard', 'none'));

-- 3. Ensure the default is still 'standard'
ALTER TABLE businesses
  ALTER COLUMN vat_scheme SET DEFAULT 'standard';

-- 4. Update column comment to reflect current law (overwrites migration 343 comment)
COMMENT ON COLUMN businesses.vat_scheme IS
  'VAT registration scheme under Ghana VAT Act 2025 (Act 1151, effective Jan 1 2026): '
  'standard = VAT-registered, standard rate (15% VAT + 2.5% NHIL + 2.5% GETFund = 20% total, all claimable as input tax); '
  'none = not VAT registered (annual turnover below GHS 750,000). '
  'The VAT Flat Rate Scheme (vfrs) was abolished effective January 1, 2026.';
