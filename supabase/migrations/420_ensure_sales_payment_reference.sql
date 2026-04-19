-- Ensure sales payment columns + indexes exist (environments that missed 010 / 015 / 016).
-- Idempotent: safe to re-run. Does not alter payment_status CHECK (see 070_fix_payment_status_constraint.sql).

-- 010_payment_settings.sql
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS momo_transaction_id text,
  ADD COLUMN IF NOT EXISTS hubtel_transaction_id text;

-- 016_add_payment_breakdown_fields.sql
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS cash_amount numeric,
  ADD COLUMN IF NOT EXISTS momo_amount numeric,
  ADD COLUMN IF NOT EXISTS card_amount numeric,
  ADD COLUMN IF NOT EXISTS payment_lines jsonb;

-- 015_add_payment_change_fields.sql
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS cash_received numeric,
  ADD COLUMN IF NOT EXISTS change_given numeric DEFAULT 0;

-- Indexes from 010 / 015 / 016
CREATE INDEX IF NOT EXISTS idx_sales_payment_status ON sales(payment_status);
CREATE INDEX IF NOT EXISTS idx_sales_momo_transaction_id ON sales(momo_transaction_id);
CREATE INDEX IF NOT EXISTS idx_sales_cash_amount ON sales(cash_amount) WHERE cash_amount IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_momo_amount ON sales(momo_amount) WHERE momo_amount IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_card_amount ON sales(card_amount) WHERE card_amount IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_payment_lines ON sales USING gin (payment_lines) WHERE payment_lines IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_cash_received ON sales(cash_received) WHERE cash_received IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_change_given ON sales(change_given) WHERE change_given IS NOT NULL;
