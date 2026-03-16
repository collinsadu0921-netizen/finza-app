-- ============================================================================
-- MIGRATION: Step 8.4 - COA Mapping Schemes & Firm Templates
-- ============================================================================
-- This migration creates coa_mapping_schemes table to support firm-level
-- templates for COA mappings, exception thresholds, and AFS structure.
--
-- Scope: Accounting Workspace ONLY (no Service/POS changes)
-- Mode: Firm-level template management
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE COA_MAPPING_SCHEMES TABLE
-- ============================================================================
-- Drop table if it exists (since this is a new table, safe to drop)
DROP TABLE IF EXISTS coa_mapping_schemes CASCADE;

CREATE TABLE coa_mapping_schemes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID REFERENCES accounting_firms(id) ON DELETE CASCADE,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scheme_type TEXT NOT NULL CHECK (scheme_type IN ('coa_statutory_mapping', 'exception_thresholds', 'afs_notes_structure')),
  is_template BOOLEAN NOT NULL DEFAULT FALSE,
  scheme_data JSONB NOT NULL, -- Stores the actual scheme configuration
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- Either firm_id (for templates) or business_id (for client schemes) must be set
  CHECK ((firm_id IS NOT NULL AND business_id IS NULL) OR (firm_id IS NULL AND business_id IS NOT NULL))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_coa_mapping_schemes_firm_id ON coa_mapping_schemes(firm_id) WHERE firm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coa_mapping_schemes_business_id ON coa_mapping_schemes(business_id) WHERE business_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coa_mapping_schemes_is_template ON coa_mapping_schemes(is_template) WHERE is_template = TRUE;
CREATE INDEX IF NOT EXISTS idx_coa_mapping_schemes_scheme_type ON coa_mapping_schemes(scheme_type);
CREATE INDEX IF NOT EXISTS idx_coa_mapping_schemes_firm_type ON coa_mapping_schemes(firm_id, scheme_type) WHERE firm_id IS NOT NULL AND is_template = TRUE;

-- Comments
COMMENT ON TABLE coa_mapping_schemes IS 'COA mapping schemes that can be templates (firm-level) or client-specific implementations';
COMMENT ON COLUMN coa_mapping_schemes.id IS 'Primary key';
COMMENT ON COLUMN coa_mapping_schemes.firm_id IS 'Reference to accounting firm (for templates)';
COMMENT ON COLUMN coa_mapping_schemes.business_id IS 'Reference to client business (for client-specific schemes)';
COMMENT ON COLUMN coa_mapping_schemes.name IS 'Name of the scheme';
COMMENT ON COLUMN coa_mapping_schemes.scheme_type IS 'Type of scheme: coa_statutory_mapping, exception_thresholds, afs_notes_structure';
COMMENT ON COLUMN coa_mapping_schemes.is_template IS 'Whether this scheme is a template (firm-level) or client-specific';
COMMENT ON COLUMN coa_mapping_schemes.scheme_data IS 'JSONB data storing the scheme configuration (varies by scheme_type)';
COMMENT ON COLUMN coa_mapping_schemes.created_by IS 'User ID who created the scheme';

-- ============================================================================
-- STEP 2: AUTO-UPDATE updated_at TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION update_coa_mapping_schemes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_coa_mapping_schemes_updated_at ON coa_mapping_schemes;
CREATE TRIGGER trigger_update_coa_mapping_schemes_updated_at
  BEFORE UPDATE ON coa_mapping_schemes
  FOR EACH ROW
  EXECUTE FUNCTION update_coa_mapping_schemes_updated_at();

-- ============================================================================
-- STEP 3: RLS POLICIES
-- ============================================================================

-- Enable RLS on coa_mapping_schemes
ALTER TABLE coa_mapping_schemes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view templates from their firms
DROP POLICY IF EXISTS "Users can view templates from their firms" ON coa_mapping_schemes;
CREATE POLICY "Users can view templates from their firms"
  ON coa_mapping_schemes FOR SELECT
  USING (
    -- Template schemes: user must belong to the firm
    (is_template = TRUE AND firm_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = coa_mapping_schemes.firm_id
        AND accounting_firm_users.user_id = auth.uid()
    ))
    OR
    -- Client schemes: user must have access to the business
    (is_template = FALSE AND business_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM businesses
        WHERE businesses.id = coa_mapping_schemes.business_id
          AND businesses.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM accounting_firm_users
        INNER JOIN accounting_firm_clients ON accounting_firm_clients.firm_id = accounting_firm_users.firm_id
        WHERE accounting_firm_clients.business_id = coa_mapping_schemes.business_id
          AND accounting_firm_users.user_id = auth.uid()
      )
    ))
  );

-- Policy: Users can insert templates in their firms (partner/senior only)
DROP POLICY IF EXISTS "Users can insert templates in their firms" ON coa_mapping_schemes;
CREATE POLICY "Users can insert templates in their firms"
  ON coa_mapping_schemes FOR INSERT
  WITH CHECK (
    -- Templates: user must be partner or senior in the firm
    (is_template = TRUE AND firm_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = coa_mapping_schemes.firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role IN ('partner', 'senior')
    ))
    OR
    -- Client schemes: user must have write/approve access
    (is_template = FALSE AND business_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM businesses
        WHERE businesses.id = coa_mapping_schemes.business_id
          AND businesses.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM accounting_firm_users
        INNER JOIN accounting_firm_clients ON accounting_firm_clients.firm_id = accounting_firm_users.firm_id
        WHERE accounting_firm_clients.business_id = coa_mapping_schemes.business_id
          AND accounting_firm_users.user_id = auth.uid()
          AND accounting_firm_clients.access_level IN ('write', 'approve')
      )
    ))
  );

-- Policy: Users can update templates in their firms (partner/senior only)
DROP POLICY IF EXISTS "Users can update templates in their firms" ON coa_mapping_schemes;
CREATE POLICY "Users can update templates in their firms"
  ON coa_mapping_schemes FOR UPDATE
  USING (
    -- Templates: user must be partner or senior in the firm
    (is_template = TRUE AND firm_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = coa_mapping_schemes.firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role IN ('partner', 'senior')
    ))
    OR
    -- Client schemes: user must have write/approve access
    (is_template = FALSE AND business_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM businesses
        WHERE businesses.id = coa_mapping_schemes.business_id
          AND businesses.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM accounting_firm_users
        INNER JOIN accounting_firm_clients ON accounting_firm_clients.firm_id = accounting_firm_users.firm_id
        WHERE accounting_firm_clients.business_id = coa_mapping_schemes.business_id
          AND accounting_firm_users.user_id = auth.uid()
          AND accounting_firm_clients.access_level IN ('write', 'approve')
      )
    ))
  );

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Step 8.4: COA Mapping Schemes & Firm Templates created';
  RAISE NOTICE '  - coa_mapping_schemes table created';
  RAISE NOTICE '  - is_template flag supported (firm-level templates)';
  RAISE NOTICE '  - Scheme types: coa_statutory_mapping, exception_thresholds, afs_notes_structure';
END;
$$;
