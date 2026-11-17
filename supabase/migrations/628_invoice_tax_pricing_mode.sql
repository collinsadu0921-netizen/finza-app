-- Phase 1 (tax-inclusive/exclusive pricing): persist the document-level pricing mode
-- for invoices so the line-item unit-price interpretation survives taxes being toggled
-- off/on and document re-opens.
--
-- Legacy fallback: existing rows (and any caller that does not supply a mode) resolve to
-- 'inclusive', which matches the historical meaning of stored line prices. New invoices
-- created through the UI may be 'exclusive' (net prices, tax added on top).
--
-- Rollback: ALTER TABLE invoices DROP COLUMN IF EXISTS tax_pricing_mode;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS tax_pricing_mode TEXT NOT NULL DEFAULT 'inclusive'
  CONSTRAINT invoices_tax_pricing_mode_check
  CHECK (tax_pricing_mode IN ('inclusive', 'exclusive'));

COMMENT ON COLUMN invoices.tax_pricing_mode IS
  'How entered line-item unit prices are interpreted: inclusive (gross; tax extracted) or exclusive (net; tax added on top).';
