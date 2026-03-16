-- ============================================================================
-- MIGRATION: Advanced Discounts (Phase 1 - Ledger-Safe Pricing)
-- ============================================================================
-- This migration adds discount support to sales with ZERO accounting drift.
-- Discounts are applied BEFORE posting, so ledger only sees final net amounts.
--
-- GUARDRAILS:
-- - All totals must be immutable after posting
-- - No report may recompute discounts from UI state
-- - Ledger is the only source of truth after sale completion
-- - Discounts applied BEFORE tax calculation
-- ============================================================================

-- ============================================================================
-- STEP 1: Add discount fields to sale_items
-- ============================================================================
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS discount_type TEXT CHECK (discount_type IN ('none', 'percent', 'amount')) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0;

-- Index for discount queries (optional, for reporting)
CREATE INDEX IF NOT EXISTS idx_sale_items_discount_type ON sale_items(discount_type) WHERE discount_type != 'none';

-- ============================================================================
-- STEP 2: Add discount fields to sales
-- ============================================================================
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS cart_discount_type TEXT CHECK (cart_discount_type IN ('none', 'percent', 'amount')),
  ADD COLUMN IF NOT EXISTS cart_discount_value NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cart_discount_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_discount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal_before_discount NUMERIC,
  ADD COLUMN IF NOT EXISTS subtotal_after_discount NUMERIC;

-- Indexes for discount queries (optional, for reporting)
CREATE INDEX IF NOT EXISTS idx_sales_cart_discount_type ON sales(cart_discount_type) WHERE cart_discount_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_total_discount ON sales(total_discount) WHERE total_discount > 0;

-- ============================================================================
-- STEP 3: Add comments documenting discount constraints
-- ============================================================================
COMMENT ON COLUMN sale_items.discount_type IS 
'Line item discount type: none, percent (0-100), or amount (>=0).
Discount is applied BEFORE tax calculation.';

COMMENT ON COLUMN sale_items.discount_value IS 
'Discount value: percentage (0-100) or fixed amount (>=0).
Interpreted based on discount_type.';

COMMENT ON COLUMN sale_items.discount_amount IS 
'Computed discount amount for this line item (immutable after posting).
net_line = (qty * unit_price) - discount_amount';

COMMENT ON COLUMN sales.cart_discount_type IS 
'Cart-level discount type: none, percent (0-100), or amount (>=0).
Applied AFTER line item discounts, BEFORE tax calculation.';

COMMENT ON COLUMN sales.cart_discount_value IS 
'Cart discount value: percentage (0-100) or fixed amount (>=0).
Interpreted based on cart_discount_type.';

COMMENT ON COLUMN sales.cart_discount_amount IS 
'Computed cart discount amount (immutable after posting).
Applied proportionally across net lines for tax correctness.';

COMMENT ON COLUMN sales.total_discount IS 
'Total discount (line + cart) computed at sale creation (immutable after posting).
total_discount = sum(line_discount_amount) + cart_discount_amount';

COMMENT ON COLUMN sales.subtotal_before_discount IS 
'Subtotal before any discounts applied (immutable after posting).
Used for reporting and validation.';

COMMENT ON COLUMN sales.subtotal_after_discount IS 
'Subtotal after all discounts applied, before tax (immutable after posting).
Tax is calculated on this net base.';
