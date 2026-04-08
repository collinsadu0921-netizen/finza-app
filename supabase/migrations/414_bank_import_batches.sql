-- Bank statement import batches (audit trail for CSV file / paste imports)

CREATE TABLE IF NOT EXISTS bank_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('file', 'paste')),
  filename TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_bank_import_batches_business ON bank_import_batches(business_id);
CREATE INDEX IF NOT EXISTS idx_bank_import_batches_account ON bank_import_batches(account_id);
CREATE INDEX IF NOT EXISTS idx_bank_import_batches_created ON bank_import_batches(created_at DESC);

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES bank_import_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_import_batch
  ON bank_transactions(import_batch_id)
  WHERE import_batch_id IS NOT NULL;

ALTER TABLE bank_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_select" ON bank_import_batches;
CREATE POLICY "tenant_select" ON bank_import_batches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = bank_import_batches.business_id
        AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tenant_insert" ON bank_import_batches;
CREATE POLICY "tenant_insert" ON bank_import_batches FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = bank_import_batches.business_id
        AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tenant_update" ON bank_import_batches;
CREATE POLICY "tenant_update" ON bank_import_batches FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = bank_import_batches.business_id
        AND bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = bank_import_batches.business_id
        AND bu.user_id = auth.uid()
    )
  );
