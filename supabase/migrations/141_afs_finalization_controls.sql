-- ============================================================================
-- MIGRATION: Step 6 - AFS Finalization & Output Controls
-- ============================================================================
-- This migration adds AFS (Accounting Financial Statements) tables,
-- finalization controls, and immutability triggers.
--
-- Scope: AFS output controls ONLY (no ledger writes, no service/POS changes)
-- Mode: Read-only outputs with finalization guardrails
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE AFS_RUNS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS afs_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  input_hash TEXT NOT NULL, -- Hash/timestamp of input data snapshot
  period_start DATE,
  period_end DATE,
  finalized_at TIMESTAMP WITH TIME ZONE,
  finalized_by UUID REFERENCES auth.users(id),
  metadata JSONB, -- Additional metadata about the run
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for afs_runs
CREATE INDEX IF NOT EXISTS idx_afs_runs_business_id ON afs_runs(business_id);
CREATE INDEX IF NOT EXISTS idx_afs_runs_status ON afs_runs(status);
CREATE INDEX IF NOT EXISTS idx_afs_runs_business_status ON afs_runs(business_id, status);
CREATE INDEX IF NOT EXISTS idx_afs_runs_input_hash ON afs_runs(input_hash);
CREATE INDEX IF NOT EXISTS idx_afs_runs_period ON afs_runs(business_id, period_start, period_end);

-- ============================================================================
-- STEP 2: CREATE AFS_DOCUMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS afs_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  afs_run_id UUID NOT NULL REFERENCES afs_runs(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL, -- 'trial_balance', 'profit_loss', 'balance_sheet', 'general_ledger', etc.
  document_data JSONB NOT NULL, -- The actual document data
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for afs_documents
CREATE INDEX IF NOT EXISTS idx_afs_documents_run_id ON afs_documents(afs_run_id);
CREATE INDEX IF NOT EXISTS idx_afs_documents_type ON afs_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_afs_documents_run_type ON afs_documents(afs_run_id, document_type);

-- ============================================================================
-- STEP 3: IMMUTABILITY TRIGGERS
-- ============================================================================

-- Function: Prevent updates to finalized AFS runs
CREATE OR REPLACE FUNCTION prevent_afs_run_update_when_finalized()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'finalized' THEN
    RAISE EXCEPTION 'AFS run is finalized and cannot be modified. Run ID: %', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Block UPDATE on finalized afs_runs
DROP TRIGGER IF EXISTS trigger_prevent_afs_run_update_finalized ON afs_runs;
CREATE TRIGGER trigger_prevent_afs_run_update_finalized
  BEFORE UPDATE ON afs_runs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_afs_run_update_when_finalized();

-- Function: Prevent modifications to documents when parent run is finalized
CREATE OR REPLACE FUNCTION prevent_afs_document_modification_when_run_finalized()
RETURNS TRIGGER AS $$
DECLARE
  run_status TEXT;
BEGIN
  -- Check parent run status
  SELECT status INTO run_status
  FROM afs_runs
  WHERE id = COALESCE(NEW.afs_run_id, OLD.afs_run_id);
  
  IF run_status = 'finalized' THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'Cannot update AFS document: parent run is finalized. Run ID: %', COALESCE(NEW.afs_run_id, OLD.afs_run_id);
    ELSIF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Cannot delete AFS document: parent run is finalized. Run ID: %', OLD.afs_run_id;
    ELSIF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Cannot insert AFS document: parent run is finalized. Run ID: %', NEW.afs_run_id;
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger: Block INSERT/UPDATE/DELETE on afs_documents when parent run is finalized
DROP TRIGGER IF EXISTS trigger_prevent_afs_document_modification_finalized ON afs_documents;
CREATE TRIGGER trigger_prevent_afs_document_modification_finalized
  BEFORE INSERT OR UPDATE OR DELETE ON afs_documents
  FOR EACH ROW
  EXECUTE FUNCTION prevent_afs_document_modification_when_run_finalized();

-- ============================================================================
-- STEP 4: AUTO-UPDATE updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_afs_runs_updated_at ON afs_runs;
CREATE TRIGGER update_afs_runs_updated_at
  BEFORE UPDATE ON afs_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 5: RLS POLICIES
-- ============================================================================

-- Enable RLS on afs_runs
ALTER TABLE afs_runs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view AFS runs for their business (owner/admin/accountant)
DROP POLICY IF EXISTS "Users can view AFS runs for their business" ON afs_runs;
CREATE POLICY "Users can view AFS runs for their business"
  ON afs_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = afs_runs.business_id
        AND (
          businesses.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM business_users
            WHERE business_users.business_id = businesses.id
              AND business_users.user_id = auth.uid()
              AND business_users.role IN ('admin', 'owner', 'accountant')
          )
        )
    )
  );

-- Policy: Users can insert AFS runs for their business (owner/admin/accountant)
DROP POLICY IF EXISTS "Users can insert AFS runs for their business" ON afs_runs;
CREATE POLICY "Users can insert AFS runs for their business"
  ON afs_runs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = afs_runs.business_id
        AND (
          businesses.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM business_users
            WHERE business_users.business_id = businesses.id
              AND business_users.user_id = auth.uid()
              AND business_users.role IN ('admin', 'owner', 'accountant')
          )
        )
    )
  );

-- Policy: Users can update AFS runs for their business (only draft status, owner/admin/accountant write)
DROP POLICY IF EXISTS "Users can update AFS runs for their business" ON afs_runs;
CREATE POLICY "Users can update AFS runs for their business"
  ON afs_runs FOR UPDATE
  USING (
    status = 'draft' -- Only draft runs can be updated
    AND EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = afs_runs.business_id
        AND (
          businesses.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM business_users
            WHERE business_users.business_id = businesses.id
              AND business_users.user_id = auth.uid()
              AND business_users.role IN ('admin', 'owner', 'accountant')
          )
        )
    )
  );

-- Enable RLS on afs_documents
ALTER TABLE afs_documents ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view AFS documents for their business
DROP POLICY IF EXISTS "Users can view AFS documents for their business" ON afs_documents;
CREATE POLICY "Users can view AFS documents for their business"
  ON afs_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM afs_runs
      INNER JOIN businesses ON businesses.id = afs_runs.business_id
      WHERE afs_runs.id = afs_documents.afs_run_id
        AND (
          businesses.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM business_users
            WHERE business_users.business_id = businesses.id
              AND business_users.user_id = auth.uid()
              AND business_users.role IN ('admin', 'owner', 'accountant')
          )
        )
    )
  );

-- Policy: Users can insert AFS documents for their business
DROP POLICY IF EXISTS "Users can insert AFS documents for their business" ON afs_documents;
CREATE POLICY "Users can insert AFS documents for their business"
  ON afs_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM afs_runs
      INNER JOIN businesses ON businesses.id = afs_runs.business_id
      WHERE afs_runs.id = afs_documents.afs_run_id
        AND afs_runs.status = 'draft' -- Only draft runs can have documents inserted
        AND (
          businesses.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM business_users
            WHERE business_users.business_id = businesses.id
              AND business_users.user_id = auth.uid()
              AND business_users.role IN ('admin', 'owner', 'accountant')
          )
        )
    )
  );

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE afs_runs IS 'AFS (Accounting Financial Statements) runs - generated financial statement outputs';
COMMENT ON TABLE afs_documents IS 'AFS documents - individual financial statements within a run';
COMMENT ON FUNCTION prevent_afs_run_update_when_finalized() IS 'Hard constraint: Prevents UPDATE on finalized AFS runs. Finalized runs are immutable.';
COMMENT ON FUNCTION prevent_afs_document_modification_when_run_finalized() IS 'Hard constraint: Prevents INSERT/UPDATE/DELETE on AFS documents when parent run is finalized.';

-- ============================================================================
-- SAFETY VERIFICATION
-- ============================================================================
-- This migration creates AFS (Accounting Financial Statements) tables and APIs.
-- 
-- VERIFIED: Zero writes to:
--   - ledger tables (journal_entries, journal_entry_lines, accounts)
--   - service workspace tables (invoices, bills, expenses, etc.)
--   - POS/retail tables
--
-- AFS operations:
--   - READ-only queries from ledger (for validation in finalization)
--   - WRITE only to afs_runs and afs_documents tables
--   - Finalization updates only afs_runs.status
--
-- Scope: AFS output controls ONLY (no ledger writes, no service/POS changes)
-- Ready for Step 7: Accountant UX + Review Flow
