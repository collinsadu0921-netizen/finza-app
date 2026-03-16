-- ============================================================================
-- MIGRATION: Step 8.8 Batch 2 - Firm Client Engagements
-- ============================================================================
-- This migration creates the engagement model for firm-client relationships.
-- Engagements are explicit, intentional, auditable, and time-bound.
--
-- Scope: Accounting Workspace ONLY
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE FIRM_CLIENT_ENGAGEMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS firm_client_engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_firm_id UUID NOT NULL REFERENCES accounting_firms(id) ON DELETE CASCADE,
  client_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'suspended', 'terminated')) DEFAULT 'pending',
  access_level TEXT NOT NULL CHECK (access_level IN ('read', 'write', 'approve')),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  accepted_by UUID REFERENCES auth.users(id),
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraint: Only one active engagement per firm-client pair
  -- This is enforced via a unique partial index below
  CONSTRAINT engagement_effective_dates_check CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_firm_client_engagements_firm_id 
  ON firm_client_engagements(accounting_firm_id);
CREATE INDEX IF NOT EXISTS idx_firm_client_engagements_business_id 
  ON firm_client_engagements(client_business_id);
CREATE INDEX IF NOT EXISTS idx_firm_client_engagements_status 
  ON firm_client_engagements(status);
CREATE INDEX IF NOT EXISTS idx_firm_client_engagements_created_by 
  ON firm_client_engagements(created_by);
CREATE INDEX IF NOT EXISTS idx_firm_client_engagements_effective_dates 
  ON firm_client_engagements(effective_from, effective_to);

-- Unique partial index: Only one active engagement per firm-client pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_firm_client_engagements_one_active
  ON firm_client_engagements(accounting_firm_id, client_business_id)
  WHERE status = 'active';

-- Comments
COMMENT ON TABLE firm_client_engagements IS 
  'Explicit, intentional, auditable firm-client engagements with lifecycle management';
COMMENT ON COLUMN firm_client_engagements.id IS 'Primary key';
COMMENT ON COLUMN firm_client_engagements.accounting_firm_id IS 'Reference to the accounting firm';
COMMENT ON COLUMN firm_client_engagements.client_business_id IS 'Reference to the client business';
COMMENT ON COLUMN firm_client_engagements.status IS 
  'Engagement status: pending (awaiting acceptance), active (operational), suspended (temporarily paused), terminated (ended)';
COMMENT ON COLUMN firm_client_engagements.access_level IS 
  'Access level: read (view only), write (can modify), approve (can approve actions)';
COMMENT ON COLUMN firm_client_engagements.effective_from IS 
  'Date from which engagement becomes effective (must be >= today for pending engagements)';
COMMENT ON COLUMN firm_client_engagements.effective_to IS 
  'Date when engagement ends (NULL = ongoing)';
COMMENT ON COLUMN firm_client_engagements.created_by IS 
  'User ID who created the engagement (firm user)';
COMMENT ON COLUMN firm_client_engagements.accepted_by IS 
  'User ID who accepted the engagement (client business owner)';
COMMENT ON COLUMN firm_client_engagements.accepted_at IS 
  'Timestamp when engagement was accepted';

-- ============================================================================
-- STEP 2: AUTO-UPDATE updated_at TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION update_firm_client_engagements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_firm_client_engagements_updated_at ON firm_client_engagements;
CREATE TRIGGER trigger_update_firm_client_engagements_updated_at
  BEFORE UPDATE ON firm_client_engagements
  FOR EACH ROW
  EXECUTE FUNCTION update_firm_client_engagements_updated_at();

-- ============================================================================
-- STEP 3: FUNCTION - Get Active Engagement
-- ============================================================================
-- Returns the active engagement for a firm-client pair, if it exists and is effective
CREATE OR REPLACE FUNCTION get_active_engagement(
  p_firm_id UUID,
  p_business_id UUID,
  p_check_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  id UUID,
  status TEXT,
  access_level TEXT,
  effective_from DATE,
  effective_to DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    e.status,
    e.access_level,
    e.effective_from,
    e.effective_to
  FROM firm_client_engagements e
  WHERE e.accounting_firm_id = p_firm_id
    AND e.client_business_id = p_business_id
    AND e.status = 'active'
    AND e.effective_from <= p_check_date
    AND (e.effective_to IS NULL OR e.effective_to >= p_check_date)
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_active_engagement(UUID, UUID, DATE) IS 
  'Returns the active engagement for a firm-client pair if it exists and is effective on the given date';

-- ============================================================================
-- STEP 4: FUNCTION - Check Engagement Access
-- ============================================================================
-- Checks if a firm has the required access level for a business via engagement
CREATE OR REPLACE FUNCTION check_engagement_access(
  p_firm_id UUID,
  p_business_id UUID,
  p_required_access TEXT,
  p_check_date DATE DEFAULT CURRENT_DATE
)
RETURNS BOOLEAN AS $$
DECLARE
  v_engagement_access TEXT;
  v_access_hierarchy TEXT[] := ARRAY['read', 'write', 'approve'];
  v_required_index INTEGER;
  v_engagement_index INTEGER;
BEGIN
  -- Get active engagement
  SELECT access_level INTO v_engagement_access
  FROM get_active_engagement(p_firm_id, p_business_id, p_check_date)
  LIMIT 1;

  -- If no engagement, no access
  IF v_engagement_access IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check if engagement access level meets required level
  -- Hierarchy: read < write < approve
  SELECT array_position(v_access_hierarchy, p_required_access) INTO v_required_index;
  SELECT array_position(v_access_hierarchy, v_engagement_access) INTO v_engagement_index;

  -- Engagement access must be >= required access
  RETURN v_engagement_index >= v_required_index;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_engagement_access(UUID, UUID, TEXT, DATE) IS 
  'Checks if a firm has the required access level for a business via an active engagement. Returns TRUE if engagement exists, is active, effective, and access level is sufficient.';

-- ============================================================================
-- STEP 5: RLS POLICIES
-- ============================================================================
ALTER TABLE firm_client_engagements ENABLE ROW LEVEL SECURITY;

-- Policy: Firm users can view engagements for their firm
DROP POLICY IF EXISTS "Firm users can view their firm engagements" ON firm_client_engagements;
CREATE POLICY "Firm users can view their firm engagements"
  ON firm_client_engagements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = firm_client_engagements.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
    )
  );

-- Policy: Business owners can view engagements for their business
DROP POLICY IF EXISTS "Business owners can view their business engagements" ON firm_client_engagements;
CREATE POLICY "Business owners can view their business engagements"
  ON firm_client_engagements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = firm_client_engagements.client_business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Policy: Partners/Seniors can create engagements (will be enforced in API)
-- Note: INSERT/UPDATE/DELETE policies will be added in later steps as needed
-- For now, we rely on API-level enforcement

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Step 8.8 Batch 2: Firm Client Engagements created';
  RAISE NOTICE '  - firm_client_engagements table created';
  RAISE NOTICE '  - Status lifecycle: pending → active → suspended/terminated';
  RAISE NOTICE '  - One active engagement per firm-client pair enforced';
  RAISE NOTICE '  - Access level hierarchy: read < write < approve';
  RAISE NOTICE '  - Effective date tracking (from/to)';
END;
$$;
