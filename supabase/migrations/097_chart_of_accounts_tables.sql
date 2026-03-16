-- ============================================================================
-- MIGRATION: Accounting Mode A4.1 - Chart of Accounts Base Tables
-- ============================================================================
-- This migration creates business-level Chart of Accounts tables.
-- NO posting logic. NO guards. TABLES ONLY.
--
-- Scope: Accounting Mode ONLY
-- No functions, no guards, no seeds, no posting logic modifications
-- ============================================================================

-- ============================================================================
-- STEP 1: chart_of_accounts TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (
    account_type IN ('asset','liability','equity','revenue','expense')
  ),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (business_id, account_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_business_id ON chart_of_accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_account_code ON chart_of_accounts(account_code);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_account_type ON chart_of_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_is_active ON chart_of_accounts(is_active) WHERE is_active = TRUE;

-- Comments
COMMENT ON TABLE chart_of_accounts IS 'Business-level Chart of Accounts for Accounting Mode. Defines account codes, names, and types.';
COMMENT ON COLUMN chart_of_accounts.account_code IS 'Unique account code within business (e.g., 1000, 1100, 4000)';
COMMENT ON COLUMN chart_of_accounts.account_type IS 'Account type: asset, liability, equity, revenue, expense';
COMMENT ON COLUMN chart_of_accounts.is_active IS 'Whether this account is currently active and available for use';

-- ============================================================================
-- STEP 2: chart_of_accounts_control_map TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS chart_of_accounts_control_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  control_key TEXT NOT NULL,
  account_code TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (business_id, control_key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_control_map_business_id ON chart_of_accounts_control_map(business_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_control_map_control_key ON chart_of_accounts_control_map(control_key);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_control_map_account_code ON chart_of_accounts_control_map(account_code);

-- Comments
COMMENT ON TABLE chart_of_accounts_control_map IS 'Maps control keys to account codes for Accounting Mode. Used for posting governance.';
COMMENT ON COLUMN chart_of_accounts_control_map.control_key IS 'Control key identifier (e.g., revenue_account, ar_account, cash_account)';
COMMENT ON COLUMN chart_of_accounts_control_map.account_code IS 'Account code from chart_of_accounts that this control key maps to';

-- ============================================================================
-- VERIFICATION: Tables created successfully
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Accounting Mode A4.1: Chart of Accounts base tables created';
  RAISE NOTICE '  - chart_of_accounts: Business-level account definitions';
  RAISE NOTICE '  - chart_of_accounts_control_map: Control key to account code mappings';
  RAISE NOTICE '  - NO functions, NO guards, NO posting logic modifications';
END;
$$;





