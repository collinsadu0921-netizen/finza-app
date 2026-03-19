-- Add FX (foreign currency) support to supplier bills and expenses
-- Allows bills and expenses to be recorded in a foreign currency
-- while booking the equivalent amount in the business's home currency.
--
-- fx_rate:             exchange rate at time of document creation (e.g. 14.5 means 1 USD = 14.5 GHS)
-- home_currency_code:  the business's functional/home currency (e.g. GHS)
-- home_currency_total: the document total converted to home currency (total * fx_rate)
--
-- When fx_rate IS NULL the document is in the business's home currency (existing behaviour).

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS currency_code TEXT,
  ADD COLUMN IF NOT EXISTS currency_symbol TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS home_currency_code TEXT,
  ADD COLUMN IF NOT EXISTS home_currency_total NUMERIC;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS currency_code TEXT,
  ADD COLUMN IF NOT EXISTS currency_symbol TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS home_currency_code TEXT,
  ADD COLUMN IF NOT EXISTS home_currency_total NUMERIC;

-- Indexes for reporting on FX documents
CREATE INDEX IF NOT EXISTS idx_bills_fx_rate ON bills(fx_rate) WHERE fx_rate IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_fx_rate ON expenses(fx_rate) WHERE fx_rate IS NOT NULL;

COMMENT ON COLUMN bills.fx_rate IS
'Exchange rate at time of bill creation (1 unit of currency_code = fx_rate units of home currency). NULL for home-currency bills.';

COMMENT ON COLUMN expenses.fx_rate IS
'Exchange rate at time of expense creation (1 unit of currency_code = fx_rate units of home currency). NULL for home-currency expenses.';
