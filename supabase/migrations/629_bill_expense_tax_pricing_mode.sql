-- Phase 2 (tax-inclusive/exclusive pricing): persist the document-level pricing mode
-- for supplier bills and expenses.
--
-- Legacy fallback: existing rows (and any caller that omits the mode) resolve to 'inclusive',
-- matching the historical meaning of stored amounts. New bills/expenses default to 'inclusive'.
--
-- Rollback: assess records first; after exclusive documents exist, dropping these columns
-- destroys the information needed to interpret their entered amounts. Prefer reverting
-- application code and retaining the columns.

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS tax_pricing_mode TEXT NOT NULL DEFAULT 'inclusive'
  CONSTRAINT bills_tax_pricing_mode_check
  CHECK (tax_pricing_mode IN ('inclusive', 'exclusive'));

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS tax_pricing_mode TEXT NOT NULL DEFAULT 'inclusive'
  CONSTRAINT expenses_tax_pricing_mode_check
  CHECK (tax_pricing_mode IN ('inclusive', 'exclusive'));

COMMENT ON COLUMN bills.tax_pricing_mode IS
  'How entered bill line prices are interpreted: inclusive (gross; tax extracted) or exclusive (net; tax added on top).';

COMMENT ON COLUMN expenses.tax_pricing_mode IS
  'How the entered expense amount is interpreted: inclusive (gross; tax extracted) or exclusive (net; tax added on top).';
