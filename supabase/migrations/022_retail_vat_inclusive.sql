-- Add VAT-inclusive pricing flag for Retail Mode
-- Stage 29: Convert Retail POS to VAT-inclusive pricing

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS retail_vat_inclusive boolean DEFAULT false;

COMMENT ON COLUMN businesses.retail_vat_inclusive IS 'If true, product prices in Retail Mode are VAT-inclusive. POS will not add taxes, and taxes will be extracted internally for reporting.';










