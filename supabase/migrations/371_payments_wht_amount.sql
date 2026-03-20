-- ============================================================================
-- Migration 371: Add wht_amount to payments
-- ============================================================================
-- When a customer deducts WHT from their payment, the company receives less
-- cash than the invoice total but is entitled to a WHT credit (tax asset).
-- This column stores the WHT amount deducted by the customer on this payment.
--
-- payments.amount   = FULL invoice amount (gross) — invoice status unchanged
-- payments.wht_amount = WHT portion withheld by customer
--
-- Ledger split (migration 372):
--   Dr Bank            = amount - wht_amount
--   Dr WHT Receivable  = wht_amount             (account 2155)
--   Cr AR              = amount                  (full gross clears AR)
-- ============================================================================

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS wht_amount NUMERIC DEFAULT 0;
