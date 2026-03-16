-- ============================================================================
-- MIGRATION: Accountant Firms and Client Access Tables
-- ============================================================================
-- This migration creates the data model for accountant firms and client access.
-- Allows one accountant firm to manage multiple client businesses with
-- explicit, auditable access.
--
-- Scope: Accounting Mode ONLY
-- ============================================================================

-- ============================================================================
-- CREATE ACCOUNTANT FIRMS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS accountant_firms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accountant_firms_created_by ON accountant_firms(created_by);

-- Comments
COMMENT ON TABLE accountant_firms IS 'Accountant firms that can manage multiple client businesses';
COMMENT ON COLUMN accountant_firms.id IS 'Primary key';
COMMENT ON COLUMN accountant_firms.name IS 'Name of the accountant firm';
COMMENT ON COLUMN accountant_firms.created_by IS 'User ID who created the firm';
COMMENT ON COLUMN accountant_firms.created_at IS 'Timestamp when the firm was created';

-- ============================================================================
-- CREATE ACCOUNTANT FIRM USERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS accountant_firm_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES accountant_firms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('partner', 'manager', 'staff')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (firm_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accountant_firm_users_firm_id ON accountant_firm_users(firm_id);
CREATE INDEX IF NOT EXISTS idx_accountant_firm_users_user_id ON accountant_firm_users(user_id);
CREATE INDEX IF NOT EXISTS idx_accountant_firm_users_role ON accountant_firm_users(role);

-- Comments
COMMENT ON TABLE accountant_firm_users IS 'Users associated with accountant firms and their roles';
COMMENT ON COLUMN accountant_firm_users.id IS 'Primary key';
COMMENT ON COLUMN accountant_firm_users.firm_id IS 'Reference to the accountant firm';
COMMENT ON COLUMN accountant_firm_users.user_id IS 'Reference to the user';
COMMENT ON COLUMN accountant_firm_users.role IS 'Role within the firm: partner, manager, or staff';
COMMENT ON COLUMN accountant_firm_users.created_at IS 'Timestamp when the user was added to the firm';

-- ============================================================================
-- CREATE ACCOUNTANT CLIENT ACCESS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS accountant_client_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES accountant_firms(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL CHECK (access_level IN ('readonly', 'write')),
  granted_by UUID NOT NULL REFERENCES auth.users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (firm_id, business_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accountant_client_access_firm_id ON accountant_client_access(firm_id);
CREATE INDEX IF NOT EXISTS idx_accountant_client_access_business_id ON accountant_client_access(business_id);
CREATE INDEX IF NOT EXISTS idx_accountant_client_access_granted_by ON accountant_client_access(granted_by);
CREATE INDEX IF NOT EXISTS idx_accountant_client_access_access_level ON accountant_client_access(access_level);

-- Comments
COMMENT ON TABLE accountant_client_access IS 'Access grants from accountant firms to client businesses';
COMMENT ON COLUMN accountant_client_access.id IS 'Primary key';
COMMENT ON COLUMN accountant_client_access.firm_id IS 'Reference to the accountant firm';
COMMENT ON COLUMN accountant_client_access.business_id IS 'Reference to the client business';
COMMENT ON COLUMN accountant_client_access.access_level IS 'Access level: readonly or write';
COMMENT ON COLUMN accountant_client_access.granted_by IS 'User ID who granted the access';
COMMENT ON COLUMN accountant_client_access.granted_at IS 'Timestamp when access was granted';




