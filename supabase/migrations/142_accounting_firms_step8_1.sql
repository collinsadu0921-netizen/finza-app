-- ============================================================================
-- MIGRATION: Step 8.1 - Accounting Firms Entity & Relationships
-- ============================================================================
-- This migration creates accounting firms tables and relationships to enable
-- accounting firms to manage multiple clients efficiently.
--
-- Scope: Accounting Workspace ONLY (no Service/POS changes)
-- Mode: Firm-level multi-client management
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE ACCOUNTING_FIRMS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_firms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounting_firms_created_by ON accounting_firms(created_by);

-- Comments
COMMENT ON TABLE accounting_firms IS 'Accounting firms that can manage multiple client businesses';
COMMENT ON COLUMN accounting_firms.id IS 'Primary key';
COMMENT ON COLUMN accounting_firms.name IS 'Name of the accounting firm';
COMMENT ON COLUMN accounting_firms.created_by IS 'User ID who created the firm';
COMMENT ON COLUMN accounting_firms.created_at IS 'Timestamp when the firm was created';
COMMENT ON COLUMN accounting_firms.updated_at IS 'Timestamp when the firm was last updated';

-- ============================================================================
-- STEP 2: CREATE ACCOUNTING_FIRM_USERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_firm_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES accounting_firms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('partner', 'senior', 'junior', 'readonly')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (firm_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounting_firm_users_firm_id ON accounting_firm_users(firm_id);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_users_user_id ON accounting_firm_users(user_id);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_users_role ON accounting_firm_users(role);

-- Comments
COMMENT ON TABLE accounting_firm_users IS 'Users associated with accounting firms and their roles';
COMMENT ON COLUMN accounting_firm_users.id IS 'Primary key';
COMMENT ON COLUMN accounting_firm_users.firm_id IS 'Reference to the accounting firm';
COMMENT ON COLUMN accounting_firm_users.user_id IS 'Reference to the user';
COMMENT ON COLUMN accounting_firm_users.role IS 'Role within the firm: partner, senior, junior, or readonly';

-- ============================================================================
-- STEP 3: CREATE ACCOUNTING_FIRM_CLIENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_firm_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES accounting_firms(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL CHECK (access_level IN ('read', 'write', 'approve')),
  granted_by UUID NOT NULL REFERENCES auth.users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (firm_id, business_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounting_firm_clients_firm_id ON accounting_firm_clients(firm_id);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_clients_business_id ON accounting_firm_clients(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_clients_granted_by ON accounting_firm_clients(granted_by);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_clients_access_level ON accounting_firm_clients(access_level);

-- Comments
COMMENT ON TABLE accounting_firm_clients IS 'Client businesses linked to accounting firms with access levels';
COMMENT ON COLUMN accounting_firm_clients.id IS 'Primary key';
COMMENT ON COLUMN accounting_firm_clients.firm_id IS 'Reference to the accounting firm';
COMMENT ON COLUMN accounting_firm_clients.business_id IS 'Reference to the client business';
COMMENT ON COLUMN accounting_firm_clients.access_level IS 'Access level: read, write, or approve';
COMMENT ON COLUMN accounting_firm_clients.granted_by IS 'User ID who granted the access';
COMMENT ON COLUMN accounting_firm_clients.granted_at IS 'Timestamp when access was granted';

-- ============================================================================
-- STEP 4: AUTO-UPDATE updated_at TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION update_accounting_firm_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_accounting_firms_updated_at ON accounting_firms;
CREATE TRIGGER trigger_update_accounting_firms_updated_at
  BEFORE UPDATE ON accounting_firms
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_firm_updated_at();

DROP TRIGGER IF EXISTS trigger_update_accounting_firm_users_updated_at ON accounting_firm_users;
CREATE TRIGGER trigger_update_accounting_firm_users_updated_at
  BEFORE UPDATE ON accounting_firm_users
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_firm_updated_at();

DROP TRIGGER IF EXISTS trigger_update_accounting_firm_clients_updated_at ON accounting_firm_clients;
CREATE TRIGGER trigger_update_accounting_firm_clients_updated_at
  BEFORE UPDATE ON accounting_firm_clients
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_firm_updated_at();

-- ============================================================================
-- STEP 5: RLS POLICIES (Basic - will be enhanced in later steps)
-- ============================================================================

-- Enable RLS on accounting_firms
ALTER TABLE accounting_firms ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view firms they belong to
DROP POLICY IF EXISTS "Users can view firms they belong to" ON accounting_firms;
CREATE POLICY "Users can view firms they belong to"
  ON accounting_firms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = accounting_firms.id
        AND accounting_firm_users.user_id = auth.uid()
    )
    OR created_by = auth.uid()
  );

-- Enable RLS on accounting_firm_users
ALTER TABLE accounting_firm_users ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view firm users in firms they belong to
DROP POLICY IF EXISTS "Users can view firm users in their firms" ON accounting_firm_users;
CREATE POLICY "Users can view firm users in their firms"
  ON accounting_firm_users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounting_firm_users afu
      WHERE afu.firm_id = accounting_firm_users.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- Enable RLS on accounting_firm_clients
ALTER TABLE accounting_firm_clients ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view clients of firms they belong to
DROP POLICY IF EXISTS "Users can view clients of their firms" ON accounting_firm_clients;
CREATE POLICY "Users can view clients of their firms"
  ON accounting_firm_clients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = accounting_firm_clients.firm_id
        AND accounting_firm_users.user_id = auth.uid()
    )
  );

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Step 8.1: Accounting Firms Entity & Relationships created';
  RAISE NOTICE '  - accounting_firms table created';
  RAISE NOTICE '  - accounting_firm_users table created (roles: partner, senior, junior, readonly)';
  RAISE NOTICE '  - accounting_firm_clients table created (access levels: read, write, approve)';
END;
$$;
