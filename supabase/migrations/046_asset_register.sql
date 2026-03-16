-- Migration: Asset Register and Depreciation System
-- Adds asset management with automatic depreciation and ledger posting

-- ============================================================================
-- ASSETS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  asset_code TEXT,
  category TEXT NOT NULL CHECK (category IN ('vehicle', 'equipment', 'furniture', 'electronics', 'tools', 'other')),
  purchase_date DATE NOT NULL,
  purchase_amount NUMERIC NOT NULL DEFAULT 0,
  supplier_name TEXT,
  useful_life_years INTEGER NOT NULL DEFAULT 5,
  depreciation_method TEXT DEFAULT 'straight_line' CHECK (depreciation_method = 'straight_line'),
  salvage_value NUMERIC DEFAULT 0,
  current_value NUMERIC NOT NULL DEFAULT 0,
  accumulated_depreciation NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disposed')),
  disposal_date DATE,
  disposal_amount NUMERIC,
  disposal_buyer TEXT,
  disposal_notes TEXT,
  notes TEXT,
  attachment_path TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for assets
CREATE INDEX IF NOT EXISTS idx_assets_business_id ON assets(business_id);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_asset_code ON assets(asset_code) WHERE asset_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_deleted_at ON assets(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- DEPRECIATION_ENTRIES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS depreciation_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  amount NUMERIC NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(asset_id, date) -- Prevent double depreciation for same month
);

-- Indexes for depreciation_entries
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_asset_id ON depreciation_entries(asset_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_business_id ON depreciation_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_date ON depreciation_entries(date);
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_journal_entry_id ON depreciation_entries(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_deleted_at ON depreciation_entries(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- FUNCTION: Generate asset code
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_asset_code(p_business_id UUID)
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  prefix TEXT := 'AST-';
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(asset_code FROM '[0-9]+$') AS INTEGER)), 0) + 1
  INTO next_num
  FROM assets
  WHERE business_id = p_business_id
    AND asset_code ~ '^AST-[0-9]+$';

  RETURN prefix || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Calculate monthly depreciation
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_monthly_depreciation(
  p_purchase_amount NUMERIC,
  p_salvage_value NUMERIC,
  p_useful_life_years INTEGER
)
RETURNS NUMERIC AS $$
BEGIN
  IF p_useful_life_years <= 0 THEN
    RETURN 0;
  END IF;

  RETURN ROUND((p_purchase_amount - p_salvage_value) / (p_useful_life_years * 12), 2);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Post asset purchase to ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_asset_purchase_to_ledger(
  p_asset_id UUID,
  p_payment_account_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_purchase_amount NUMERIC;
  v_asset_account_id UUID;
  v_payment_account UUID;
  v_journal_entry_id UUID;
BEGIN
  -- Get asset details
  SELECT business_id, purchase_amount
  INTO v_business_id, v_purchase_amount
  FROM assets
  WHERE id = p_asset_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  -- Get or create Fixed Assets account (1600)
  SELECT id INTO v_asset_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '1600'
    AND type = 'asset';

  IF v_asset_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Fixed Assets', '1600', 'asset', 'Fixed assets including equipment, vehicles, and property', TRUE)
    RETURNING id INTO v_asset_account_id;
  END IF;

  -- Use provided payment account or default to Cash (1010)
  IF p_payment_account_id IS NOT NULL THEN
    v_payment_account := p_payment_account_id;
  ELSE
    SELECT id INTO v_payment_account
    FROM accounts
    WHERE business_id = v_business_id
      AND code = '1010'
      AND type = 'asset';

    IF v_payment_account IS NULL THEN
      RAISE EXCEPTION 'Cash account (1010) not found';
    END IF;
  END IF;

  -- Create journal entry
  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (v_business_id, CURRENT_DATE, 'Asset Purchase: ' || (SELECT name FROM assets WHERE id = p_asset_id), 'asset', p_asset_id)
  RETURNING id INTO v_journal_entry_id;

  -- Debit Fixed Assets
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_asset_account_id, v_purchase_amount, 0, 'Asset Purchase');

  -- Credit Cash/Bank/Payment Account
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_payment_account, 0, v_purchase_amount, 'Payment for Asset');

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Post depreciation to ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_depreciation_to_ledger(
  p_depreciation_entry_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_asset_id UUID;
  v_amount NUMERIC;
  v_date DATE;
  v_asset_name TEXT;
  v_depreciation_expense_account_id UUID;
  v_accumulated_depreciation_account_id UUID;
  v_journal_entry_id UUID;
BEGIN
  -- Get depreciation entry details
  SELECT de.business_id, de.asset_id, de.amount, de.date, a.name
  INTO v_business_id, v_asset_id, v_amount, v_date, v_asset_name
  FROM depreciation_entries de
  JOIN assets a ON a.id = de.asset_id
  WHERE de.id = p_depreciation_entry_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Depreciation entry not found';
  END IF;

  -- Get or create Depreciation Expense account (5700)
  SELECT id INTO v_depreciation_expense_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '5700'
    AND type = 'expense';

  IF v_depreciation_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Depreciation Expense', '5700', 'expense', 'Depreciation expense for fixed assets', TRUE)
    RETURNING id INTO v_depreciation_expense_account_id;
  END IF;

  -- Get or create Accumulated Depreciation account (1650)
  SELECT id INTO v_accumulated_depreciation_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '1650'
    AND type = 'asset';

  IF v_accumulated_depreciation_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Accumulated Depreciation', '1650', 'asset', 'Accumulated depreciation on fixed assets', TRUE)
    RETURNING id INTO v_accumulated_depreciation_account_id;
  END IF;

  -- Create journal entry
  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (v_business_id, v_date, 'Depreciation: ' || v_asset_name, 'depreciation', p_depreciation_entry_id)
  RETURNING id INTO v_journal_entry_id;

  -- Debit Depreciation Expense
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_depreciation_expense_account_id, v_amount, 0, 'Depreciation Expense');

  -- Credit Accumulated Depreciation
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_accumulated_depreciation_account_id, 0, v_amount, 'Accumulated Depreciation');

  -- Update depreciation entry with journal_entry_id
  UPDATE depreciation_entries
  SET journal_entry_id = v_journal_entry_id
  WHERE id = p_depreciation_entry_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Post asset disposal to ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_asset_disposal_to_ledger(
  p_asset_id UUID,
  p_disposal_amount NUMERIC,
  p_payment_account_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_purchase_amount NUMERIC;
  v_accumulated_depreciation NUMERIC;
  v_current_value NUMERIC;
  v_asset_account_id UUID;
  v_accumulated_depreciation_account_id UUID;
  v_payment_account UUID;
  v_gain_loss_account_id UUID;
  v_journal_entry_id UUID;
  v_asset_name TEXT;
  v_gain_loss_amount NUMERIC;
  v_is_gain BOOLEAN;
BEGIN
  -- Get asset details
  SELECT business_id, purchase_amount, accumulated_depreciation, current_value, name
  INTO v_business_id, v_purchase_amount, v_accumulated_depreciation, v_current_value, v_asset_name
  FROM assets
  WHERE id = p_asset_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  -- Calculate gain/loss
  v_gain_loss_amount := p_disposal_amount - v_current_value;
  v_is_gain := v_gain_loss_amount > 0;

  -- Get accounts
  SELECT id INTO v_asset_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '1600'
    AND type = 'asset';

  SELECT id INTO v_accumulated_depreciation_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '1650'
    AND type = 'asset';

  -- Use provided payment account or default to Cash
  IF p_payment_account_id IS NOT NULL THEN
    v_payment_account := p_payment_account_id;
  ELSE
    SELECT id INTO v_payment_account
    FROM accounts
    WHERE business_id = v_business_id
      AND code = '1010'
      AND type = 'asset';
  END IF;

  -- Get or create Gain/Loss on Disposal account
  IF v_is_gain THEN
    SELECT id INTO v_gain_loss_account_id
    FROM accounts
    WHERE business_id = v_business_id
      AND code = '4200'
      AND type = 'income';

    IF v_gain_loss_account_id IS NULL THEN
      INSERT INTO accounts (business_id, name, code, type, description, is_system)
      VALUES (v_business_id, 'Gain on Asset Disposal', '4200', 'income', 'Gains from disposal of fixed assets', TRUE)
      RETURNING id INTO v_gain_loss_account_id;
    END IF;
  ELSE
    SELECT id INTO v_gain_loss_account_id
    FROM accounts
    WHERE business_id = v_business_id
      AND code = '5800'
      AND type = 'expense';

    IF v_gain_loss_account_id IS NULL THEN
      INSERT INTO accounts (business_id, name, code, type, description, is_system)
      VALUES (v_business_id, 'Loss on Asset Disposal', '5800', 'expense', 'Losses from disposal of fixed assets', TRUE)
      RETURNING id INTO v_gain_loss_account_id;
    END IF;
  END IF;

  -- Create journal entry
  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (v_business_id, CURRENT_DATE, 'Asset Disposal: ' || v_asset_name, 'asset', p_asset_id)
  RETURNING id INTO v_journal_entry_id;

  -- Debit Cash (disposal amount)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_payment_account, p_disposal_amount, 0, 'Proceeds from Asset Disposal');

  -- Credit Accumulated Depreciation (remove accumulated depreciation)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_accumulated_depreciation_account_id, 0, v_accumulated_depreciation, 'Remove Accumulated Depreciation');

  -- Credit Fixed Assets (remove asset at cost)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_asset_account_id, 0, v_purchase_amount, 'Remove Asset from Books');

  -- Debit/Credit Gain/Loss
  IF v_is_gain THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_entry_id, v_gain_loss_account_id, 0, v_gain_loss_amount, 'Gain on Disposal');
  ELSE
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_entry_id, v_gain_loss_account_id, v_gain_loss_amount, 0, 'Loss on Disposal');
  END IF;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- AUTO-UPDATE updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS update_assets_updated_at ON assets;
CREATE TRIGGER update_assets_updated_at
  BEFORE UPDATE ON assets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_depreciation_entries_updated_at ON depreciation_entries;
CREATE TRIGGER update_depreciation_entries_updated_at
  BEFORE UPDATE ON depreciation_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on assets
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view assets for their business"
  ON assets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = assets.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert assets for their business"
  ON assets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = assets.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update assets for their business"
  ON assets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = assets.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete assets for their business"
  ON assets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = assets.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Enable RLS on depreciation_entries
ALTER TABLE depreciation_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view depreciation entries for their business"
  ON depreciation_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = depreciation_entries.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert depreciation entries for their business"
  ON depreciation_entries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = depreciation_entries.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update depreciation entries for their business"
  ON depreciation_entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE depreciation_entries.business_id = businesses.id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete depreciation entries for their business"
  ON depreciation_entries FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = depreciation_entries.business_id
        AND businesses.owner_id = auth.uid()
    )
  );


