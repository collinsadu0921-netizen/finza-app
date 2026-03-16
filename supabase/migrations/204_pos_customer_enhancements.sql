-- ============================================================================
-- MIGRATION: POS Customer Enhancements (Phase 2)
-- ============================================================================
-- This migration adds customer metadata fields for POS operational value:
-- - Customer flags (frequent, VIP, credit_risk, special_handling)
-- - Default discount percentage (auto-applied at POS)
--
-- GUARDRAILS:
-- - All fields are metadata only (non-financial)
-- - Default discount must respect caps and role limits (enforced in API)
-- - No changes to accounting, ledger, or payment logic
-- ============================================================================

-- ============================================================================
-- STEP 1: Add customer flags (informational metadata)
-- ============================================================================
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_frequent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_credit_risk BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requires_special_handling BOOLEAN DEFAULT FALSE;

-- Indexes for flag queries (optional, for filtering)
CREATE INDEX IF NOT EXISTS idx_customers_is_frequent ON customers(is_frequent) WHERE is_frequent = TRUE;
CREATE INDEX IF NOT EXISTS idx_customers_is_vip ON customers(is_vip) WHERE is_vip = TRUE;
CREATE INDEX IF NOT EXISTS idx_customers_is_credit_risk ON customers(is_credit_risk) WHERE is_credit_risk = TRUE;

-- ============================================================================
-- STEP 2: Add default discount percentage
-- ============================================================================
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS default_discount_percent NUMERIC DEFAULT NULL 
    CHECK (default_discount_percent IS NULL OR (default_discount_percent >= 0 AND default_discount_percent <= 100));

-- Index for customers with default discounts (optional, for quick lookup)
CREATE INDEX IF NOT EXISTS idx_customers_default_discount ON customers(default_discount_percent) 
  WHERE default_discount_percent IS NOT NULL AND default_discount_percent > 0;

-- ============================================================================
-- STEP 3: Add comments documenting customer enhancement fields
-- ============================================================================
COMMENT ON COLUMN customers.is_frequent IS 
'Flag: Customer makes frequent purchases. Informational only, no behavioral impact.';

COMMENT ON COLUMN customers.is_vip IS 
'Flag: VIP customer requiring special attention. Informational only, no behavioral impact.';

COMMENT ON COLUMN customers.is_credit_risk IS 
'Flag: Customer has credit risk history. Informational only, no behavioral impact.';

COMMENT ON COLUMN customers.requires_special_handling IS 
'Flag: Customer requires special handling instructions. Informational only, no behavioral impact.';

COMMENT ON COLUMN customers.default_discount_percent IS 
'Default discount percentage (0-100) to auto-apply when customer is attached at POS.
Must respect business discount caps and user role limits (enforced in API).
NULL = no default discount.';

-- ============================================================================
-- STEP 4: Create function to get customer sale history (read-only)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_customer_sale_history(
  p_customer_id UUID,
  p_business_id UUID,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  sale_id UUID,
  sale_date TIMESTAMP WITH TIME ZONE,
  sale_amount NUMERIC,
  sale_description TEXT,
  item_count INTEGER,
  payment_method TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id AS sale_id,
    s.created_at AS sale_date,
    s.amount AS sale_amount,
    s.description AS sale_description,
    COUNT(si.id)::INTEGER AS item_count,
    s.payment_method AS payment_method
  FROM sales s
  LEFT JOIN sale_items si ON si.sale_id = s.id
  WHERE s.customer_id = p_customer_id
    AND s.business_id = p_business_id
    AND s.status = 'completed'
    AND s.deleted_at IS NULL
  GROUP BY s.id, s.created_at, s.amount, s.description, s.payment_method
  ORDER BY s.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_customer_sale_history IS 
'Returns read-only sale history for a customer. Used for POS context display only.
No accounting recalculation, no edits allowed.';

-- ============================================================================
-- STEP 5: Create function to get customer sale statistics (read-only)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_customer_sale_stats(
  p_customer_id UUID,
  p_business_id UUID
)
RETURNS TABLE (
  total_sales_count BIGINT,
  total_spend NUMERIC,
  average_basket_size NUMERIC,
  last_purchase_date TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT AS total_sales_count,
    COALESCE(SUM(s.amount), 0)::NUMERIC AS total_spend,
    CASE 
      WHEN COUNT(*) > 0 THEN COALESCE(AVG(s.amount), 0)::NUMERIC
      ELSE 0::NUMERIC
    END AS average_basket_size,
    MAX(s.created_at) AS last_purchase_date
  FROM sales s
  WHERE s.customer_id = p_customer_id
    AND s.business_id = p_business_id
    AND s.status = 'completed'
    AND s.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_customer_sale_stats IS 
'Returns read-only sale statistics for a customer. Used for POS context display only.
No accounting recalculation, no edits allowed.';
