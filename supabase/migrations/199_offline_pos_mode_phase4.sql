-- ============================================================================
-- MIGRATION: Offline POS Mode (Phase 4 - Deferred Posting, Ledger-Safe)
-- ============================================================================
-- This migration enables offline POS operation with deferred posting.
-- Offline transactions are queued locally and synced when connectivity is restored.
-- The ledger remains authoritative - offline mode never bypasses it.
--
-- GUARDRAILS:
-- - Offline mode does NOT post to ledger
-- - Transactions are queued and posted later with original timestamps
-- - Period locking is enforced during sync
-- - Idempotent sync (safe to retry)
-- ============================================================================

-- ============================================================================
-- STEP 1: Create offline_transactions table
-- ============================================================================
CREATE TABLE IF NOT EXISTS offline_transactions (
  local_id TEXT PRIMARY KEY,                    -- Device-generated unique ID
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  register_id UUID REFERENCES registers(id) ON DELETE SET NULL,
  cashier_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('sale', 'refund', 'void')),
  payload JSONB NOT NULL,                       -- Full transaction intent (immutable)
  entry_date TIMESTAMP WITH TIME ZONE NOT NULL,  -- Original intended accounting date (frozen)
  status TEXT NOT NULL CHECK (status IN ('pending', 'synced', 'failed')) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE,
  canonical_sale_id UUID REFERENCES sales(id) ON DELETE SET NULL, -- Link to synced sale
  error_message TEXT,                            -- Error details if sync failed
  retry_count INTEGER DEFAULT 0                  -- Track sync retry attempts
);

-- Indexes for offline_transactions
CREATE INDEX IF NOT EXISTS idx_offline_transactions_business_id ON offline_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_offline_transactions_store_id ON offline_transactions(store_id);
CREATE INDEX IF NOT EXISTS idx_offline_transactions_register_id ON offline_transactions(register_id);
CREATE INDEX IF NOT EXISTS idx_offline_transactions_cashier_id ON offline_transactions(cashier_id);
CREATE INDEX IF NOT EXISTS idx_offline_transactions_status ON offline_transactions(status);
CREATE INDEX IF NOT EXISTS idx_offline_transactions_entry_date ON offline_transactions(entry_date);
CREATE INDEX IF NOT EXISTS idx_offline_transactions_created_at ON offline_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_offline_transactions_canonical_sale_id ON offline_transactions(canonical_sale_id) WHERE canonical_sale_id IS NOT NULL;

-- Composite index for efficient pending transaction queries
CREATE INDEX IF NOT EXISTS idx_offline_transactions_pending_sync ON offline_transactions(business_id, status, created_at) WHERE status = 'pending';

-- ============================================================================
-- STEP 2: Row-Level Security (RLS) Policies
-- ============================================================================
ALTER TABLE offline_transactions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view offline transactions for their business
CREATE POLICY "Users can view offline transactions for their business"
  ON offline_transactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = offline_transactions.business_id
      AND business_users.user_id = auth.uid()
    )
  );

-- Policy: Users can insert offline transactions for their business
CREATE POLICY "Users can insert offline transactions for their business"
  ON offline_transactions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = offline_transactions.business_id
      AND business_users.user_id = auth.uid()
    )
    AND cashier_id = auth.uid() -- Can only create transactions for themselves
  );

-- Policy: System can update offline transactions (for sync status)
-- Note: This is typically done via service role, but we allow updates for sync operations
CREATE POLICY "Users can update offline transactions for their business"
  ON offline_transactions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = offline_transactions.business_id
      AND business_users.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = offline_transactions.business_id
      AND business_users.user_id = auth.uid()
    )
    -- Prevent modification of immutable fields
    AND payload = OLD.payload
    AND entry_date = OLD.entry_date
  );

-- ============================================================================
-- STEP 3: Comments
-- ============================================================================
COMMENT ON TABLE offline_transactions IS 
'Queue for offline POS transactions. Transactions are created offline and synced when connectivity is restored. The ledger remains authoritative - offline mode never bypasses it.';

COMMENT ON COLUMN offline_transactions.local_id IS 
'Device-generated unique identifier. Used for idempotency during sync.';

COMMENT ON COLUMN offline_transactions.payload IS 
'Full transaction intent (JSONB). Immutable once stored. Contains all sale/refund/void details.';

COMMENT ON COLUMN offline_transactions.entry_date IS 
'Original intended accounting date. Frozen at creation. Used for period locking validation during sync.';

COMMENT ON COLUMN offline_transactions.status IS 
'Transaction status: pending (awaiting sync), synced (successfully posted), failed (requires supervisor resolution).';

COMMENT ON COLUMN offline_transactions.canonical_sale_id IS 
'Link to the canonical sale created during sync. NULL until transaction is synced.';

COMMENT ON COLUMN offline_transactions.error_message IS 
'Error details if sync failed. Used for supervisor review and resolution.';
