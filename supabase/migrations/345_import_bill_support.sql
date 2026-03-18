-- ============================================================================
-- Migration 345: Import Bill Support
-- ============================================================================
-- Ghana businesses that import goods need to correctly record:
--   1. Import duty (ECOWAS CET: 0%, 5%, 10%, 20%, 35%)
--   2. Port levies (ECOWAS 0.5%, AU 0.2%, EXIM 0.75%, SIL 2%)
--   3. Examination fee (1% for used goods)
--   4. Clearing agent fee (separate service cost)
--   5. VAT/NHIL/GETFund on the full CIF + duty + levies base
--
-- Accounting treatment:
--   Dr  Landed Cost account (inventory or COGS or expense)  = CIF + duty + levies
--   Dr  VAT Input (2100)                                    = VAT amount
--   Dr  NHIL Input (2110)                                   = NHIL amount
--   Dr  GETFund Input (2120)                                = GETFund amount
--   Cr  AP (2000)                                           = total - WHT
--   Cr  WHT Payable (2150)                                  = WHT if applicable
-- ============================================================================

-- ============================================================================
-- 1. New COA accounts (added to create_system_accounts via direct insert helper)
-- ============================================================================

-- These accounts are added to businesses that have been set up already.
-- New businesses will get them via create_system_accounts (updated separately).

-- 1210: Import Goods / Inventory-in-Transit
-- Used when imported goods go into stock before being sold.
INSERT INTO accounts (business_id, code, name, type, sub_type, is_system)
SELECT b.id, '1210', 'Import Goods & Inventory', 'asset', 'current_asset', TRUE
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.code = '1210'
);

-- 5210: Import Duty & Port Levies
-- Tracks import duty, ECOWAS, AU, EXIM, SIL when expensed directly (non-inventory).
INSERT INTO accounts (business_id, code, name, type, sub_type, is_system)
SELECT b.id, '5210', 'Import Duty & Port Levies', 'expense', 'operating_expense', TRUE
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.code = '5210'
);

-- 5220: Clearing & Forwarding Costs
-- Tracks clearing agent fees, freight, and forwarding charges on imports.
INSERT INTO accounts (business_id, code, name, type, sub_type, is_system)
SELECT b.id, '5220', 'Clearing & Forwarding Costs', 'expense', 'operating_expense', TRUE
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.code = '5220'
);

-- ============================================================================
-- 2. New columns on bills table
-- ============================================================================

-- Bill type: 'standard' (default) or 'import'
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS bill_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (bill_type IN ('standard', 'import'));

-- CIF value (Cost + Insurance + Freight) — the customs valuation base
ALTER TABLE bills ADD COLUMN IF NOT EXISTS cif_value NUMERIC(15,2);

-- Import duty
ALTER TABLE bills ADD COLUMN IF NOT EXISTS import_duty_rate   NUMERIC(6,4) DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS import_duty_amount NUMERIC(15,2) DEFAULT 0;

-- Port levies (calculated on CIF value)
ALTER TABLE bills ADD COLUMN IF NOT EXISTS ecowas_levy      NUMERIC(15,2) DEFAULT 0;  -- 0.5%
ALTER TABLE bills ADD COLUMN IF NOT EXISTS au_levy          NUMERIC(15,2) DEFAULT 0;  -- 0.2%
ALTER TABLE bills ADD COLUMN IF NOT EXISTS exim_levy        NUMERIC(15,2) DEFAULT 0;  -- 0.75%
ALTER TABLE bills ADD COLUMN IF NOT EXISTS sil_levy         NUMERIC(15,2) DEFAULT 0;  -- 2% (used goods)
ALTER TABLE bills ADD COLUMN IF NOT EXISTS examination_fee  NUMERIC(15,2) DEFAULT 0;  -- 1% (used goods)

-- Clearing agent fee (separate service, goes to 5220)
ALTER TABLE bills ADD COLUMN IF NOT EXISTS clearing_agent_fee NUMERIC(15,2) DEFAULT 0;

-- Where landed cost (CIF + duty + levies) should be posted
-- Options: '1200' (Inventory), '1210' (Import Goods), '5000' (COGS), '5200' (Expenses), '5210' (Import Duty)
ALTER TABLE bills ADD COLUMN IF NOT EXISTS landed_cost_account_code TEXT DEFAULT '5200';

-- Human-readable description of the imported goods (e.g. "Electronics — Samsung monitors × 20")
ALTER TABLE bills ADD COLUMN IF NOT EXISTS import_description TEXT;

-- ============================================================================
-- 3. Update create_system_accounts to include new accounts for new businesses
-- ============================================================================

CREATE OR REPLACE FUNCTION ensure_import_accounts_exist(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO accounts (business_id, code, name, type, sub_type, is_system)
  VALUES
    (p_business_id, '1210', 'Import Goods & Inventory',    'asset',   'current_asset',     TRUE),
    (p_business_id, '5210', 'Import Duty & Port Levies',   'expense', 'operating_expense', TRUE),
    (p_business_id, '5220', 'Clearing & Forwarding Costs', 'expense', 'operating_expense', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ensure_import_accounts_exist(UUID) IS
  'Idempotently creates the three import-related COA accounts for a business. '
  'Safe to call multiple times. Used in create_system_accounts and on-demand.';

-- ============================================================================
-- 4. Comments
-- ============================================================================

COMMENT ON COLUMN bills.bill_type IS
  'standard = normal supplier bill; import = customs/import entry with CIF, duty, and levy breakdown';
COMMENT ON COLUMN bills.cif_value IS
  'Cost + Insurance + Freight value — the GRA/ICUMS customs valuation base';
COMMENT ON COLUMN bills.import_duty_rate IS
  'ECOWAS CET duty rate applied: 0.00, 0.05, 0.10, 0.20, or 0.35';
COMMENT ON COLUMN bills.landed_cost_account_code IS
  'Account code where CIF + duty + levies are posted: 1200 inventory, 1210 import goods, 5000 COGS, 5200 expenses';
