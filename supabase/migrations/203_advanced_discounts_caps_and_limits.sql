-- ============================================================================
-- MIGRATION: Advanced Discounts - Caps and Role-Based Limits
-- ============================================================================
-- This migration adds discount caps and role-based limit configuration
-- to businesses, enabling controlled discounting without accounting risk.
--
-- GUARDRAILS:
-- - Discounts remain price-inclusive (no ledger changes)
-- - Caps enforced BEFORE sale completion
-- - Role limits enforced in UI and API (never trust UI alone)
-- ============================================================================

-- ============================================================================
-- STEP 1: Add discount cap configuration to businesses
-- ============================================================================
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS max_discount_percent NUMERIC DEFAULT 50 CHECK (max_discount_percent >= 0 AND max_discount_percent <= 100),
  ADD COLUMN IF NOT EXISTS max_discount_amount NUMERIC DEFAULT NULL CHECK (max_discount_amount IS NULL OR max_discount_amount >= 0),
  ADD COLUMN IF NOT EXISTS max_discount_per_sale_percent NUMERIC DEFAULT NULL CHECK (max_discount_per_sale_percent IS NULL OR (max_discount_per_sale_percent >= 0 AND max_discount_per_sale_percent <= 100)),
  ADD COLUMN IF NOT EXISTS max_discount_per_sale_amount NUMERIC DEFAULT NULL CHECK (max_discount_per_sale_amount IS NULL OR max_discount_per_sale_amount >= 0),
  ADD COLUMN IF NOT EXISTS max_discount_per_line_percent NUMERIC DEFAULT NULL CHECK (max_discount_per_line_percent IS NULL OR (max_discount_per_line_percent >= 0 AND max_discount_per_line_percent <= 100)),
  ADD COLUMN IF NOT EXISTS max_discount_per_line_amount NUMERIC DEFAULT NULL CHECK (max_discount_per_line_amount IS NULL OR max_discount_per_line_amount >= 0);

-- ============================================================================
-- STEP 2: Add role-based discount limits configuration
-- ============================================================================
-- Store as JSONB for flexibility: { "cashier": { "max_percent": 10, "max_amount": null }, ... }
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS discount_role_limits JSONB DEFAULT '{
    "cashier": { "max_percent": 10, "max_amount": null },
    "manager": { "max_percent": 50, "max_amount": null },
    "admin": { "max_percent": 100, "max_amount": null },
    "owner": { "max_percent": 100, "max_amount": null }
  }'::jsonb;

-- ============================================================================
-- STEP 3: Add comments documenting discount cap constraints
-- ============================================================================
COMMENT ON COLUMN businesses.max_discount_percent IS 
'Global maximum discount percentage (0-100). Applies to all discounts combined (line + cart).';

COMMENT ON COLUMN businesses.max_discount_amount IS 
'Global maximum discount amount (currency). Applies to all discounts combined. NULL = no limit.';

COMMENT ON COLUMN businesses.max_discount_per_sale_percent IS 
'Maximum discount percentage per sale (0-100). NULL = use global max_discount_percent.';

COMMENT ON COLUMN businesses.max_discount_per_sale_amount IS 
'Maximum discount amount per sale (currency). NULL = use global max_discount_amount or no limit.';

COMMENT ON COLUMN businesses.max_discount_per_line_percent IS 
'Maximum discount percentage per line item (0-100). NULL = use global max_discount_percent.';

COMMENT ON COLUMN businesses.max_discount_per_line_amount IS 
'Maximum discount amount per line item (currency). NULL = use global max_discount_amount or no limit.';

COMMENT ON COLUMN businesses.discount_role_limits IS 
'Role-based discount limits (JSONB). Format: { "role": { "max_percent": number, "max_amount": number | null } }.
Enforced in UI and API. Cashier default: 10%, Manager: 50%, Admin/Owner: 100%.';

-- ============================================================================
-- STEP 4: Create helper function to get role discount limit
-- ============================================================================
CREATE OR REPLACE FUNCTION get_role_discount_limit(
  p_business_id UUID,
  p_role TEXT
)
RETURNS JSONB AS $$
DECLARE
  role_limits JSONB;
  role_limit JSONB;
BEGIN
  -- Get discount role limits from business
  SELECT discount_role_limits INTO role_limits
  FROM businesses
  WHERE id = p_business_id;
  
  -- If no limits configured, return NULL (no limit)
  IF role_limits IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Get limit for specific role
  role_limit := role_limits->p_role;
  
  -- If role not found, return NULL (no limit)
  IF role_limit IS NULL THEN
    RETURN NULL;
  END IF;
  
  RETURN role_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_role_discount_limit IS 
'Returns discount limit configuration for a specific role. Returns NULL if no limit configured.';
