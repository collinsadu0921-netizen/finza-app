-- Add FX (foreign currency) support to financial documents
-- Allows invoices, estimates, and proforma invoices to be issued in a foreign currency
-- while booking the equivalent amount in the business's home currency.
--
-- fx_rate:            exchange rate at time of document creation (e.g. 14.5 means 1 USD = 14.5 GHS)
-- home_currency_code: the business's functional/home currency (e.g. GHS)
-- home_currency_total: the document total converted to home currency (total * fx_rate)
--
-- When fx_rate IS NULL the document is in the business's home currency (existing behaviour).

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS home_currency_code TEXT,
  ADD COLUMN IF NOT EXISTS home_currency_total NUMERIC;

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS currency_code TEXT,
  ADD COLUMN IF NOT EXISTS currency_symbol TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS home_currency_code TEXT,
  ADD COLUMN IF NOT EXISTS home_currency_total NUMERIC;

ALTER TABLE proforma_invoices
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS home_currency_code TEXT,
  ADD COLUMN IF NOT EXISTS home_currency_total NUMERIC;

-- Index for reporting on FX documents
CREATE INDEX IF NOT EXISTS idx_invoices_fx_rate ON invoices(fx_rate) WHERE fx_rate IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_fx_rate ON proforma_invoices(fx_rate) WHERE fx_rate IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_fx_rate ON estimates(fx_rate) WHERE fx_rate IS NOT NULL;
