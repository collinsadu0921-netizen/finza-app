-- Align estimate_items with API: line-level discounts on quotes/estimates.
ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN estimate_items.discount_amount IS
  'Per-line discount in document currency; line net = qty * unit − discount_amount.';
