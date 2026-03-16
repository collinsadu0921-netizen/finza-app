-- ============================================================================
-- Migration 251: create_system_accounts without ON CONFLICT
-- ============================================================================
-- Fixes: "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" when the partial unique index on accounts (business_id, code)
-- is missing (e.g. 248/249/250 not run or failed before index creation).
--
-- Replaces create_system_accounts with an idempotent version that uses
-- WHERE NOT EXISTS instead of ON CONFLICT, so it works with or without the
-- unique index. Safe to run; no data change beyond ensuring system accounts exist.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_system_accounts(p_business_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Assets: insert only if no active account exists for (business_id, code)
  INSERT INTO accounts (business_id, name, code, type, description, is_system)
  SELECT v.business_id, v.name, v.code, v.type, v.description, v.is_system
  FROM (VALUES
    (p_business_id, 'Cash', '1000', 'asset', 'Cash on hand', TRUE),
    (p_business_id, 'Bank', '1010', 'asset', 'Bank account', TRUE),
    (p_business_id, 'Mobile Money', '1020', 'asset', 'Mobile money accounts', TRUE),
    (p_business_id, 'Accounts Receivable', '1100', 'asset', 'Amounts owed by customers', TRUE),
    (p_business_id, 'Inventory', '1200', 'asset', 'Inventory assets', TRUE),
    (p_business_id, 'Fixed Assets', '1600', 'asset', 'Fixed assets including equipment, vehicles, and property', TRUE),
    (p_business_id, 'Accumulated Depreciation', '1650', 'asset', 'Accumulated depreciation on fixed assets', TRUE)
  ) AS v(business_id, name, code, type, description, is_system)
  WHERE NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.business_id = v.business_id AND a.code = v.code AND a.deleted_at IS NULL
  );

  -- Liabilities
  INSERT INTO accounts (business_id, name, code, type, description, is_system)
  SELECT v.business_id, v.name, v.code, v.type, v.description, v.is_system
  FROM (VALUES
    (p_business_id, 'Accounts Payable', '2000', 'liability', 'Amounts owed to suppliers', TRUE),
    (p_business_id, 'VAT Payable', '2100', 'liability', 'VAT output tax minus input tax', TRUE),
    (p_business_id, 'NHIL Payable', '2110', 'liability', 'NHIL output tax minus input tax', TRUE),
    (p_business_id, 'GETFund Payable', '2120', 'liability', 'GETFund output tax minus input tax', TRUE),
    (p_business_id, 'COVID Levy Payable', '2130', 'liability', 'COVID-19 Health Recovery Levy output tax minus input tax', TRUE),
    (p_business_id, 'Other Tax Liabilities', '2200', 'liability', 'Other tax obligations', TRUE),
    (p_business_id, 'PAYE Liability', '2210', 'liability', 'PAYE tax payable to GRA', TRUE),
    (p_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'SSNIT employee contributions payable', TRUE),
    (p_business_id, 'SSNIT Employer Contribution Payable', '2230', 'liability', 'SSNIT employer contributions payable', TRUE),
    (p_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
  ) AS v(business_id, name, code, type, description, is_system)
  WHERE NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.business_id = v.business_id AND a.code = v.code AND a.deleted_at IS NULL
  );

  -- Equity
  INSERT INTO accounts (business_id, name, code, type, description, is_system)
  SELECT v.business_id, v.name, v.code, v.type, v.description, v.is_system
  FROM (VALUES
    (p_business_id, 'Owner''s Equity', '3000', 'equity', 'Owner investment', TRUE),
    (p_business_id, 'Retained Earnings', '3100', 'equity', 'Accumulated profits', TRUE)
  ) AS v(business_id, name, code, type, description, is_system)
  WHERE NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.business_id = v.business_id AND a.code = v.code AND a.deleted_at IS NULL
  );

  -- Income
  INSERT INTO accounts (business_id, name, code, type, description, is_system)
  SELECT v.business_id, v.name, v.code, v.type, v.description, v.is_system
  FROM (VALUES
    (p_business_id, 'Service Revenue', '4000', 'income', 'Revenue from services', TRUE),
    (p_business_id, 'Gain on Asset Disposal', '4200', 'income', 'Gains from disposal of fixed assets', TRUE)
  ) AS v(business_id, name, code, type, description, is_system)
  WHERE NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.business_id = v.business_id AND a.code = v.code AND a.deleted_at IS NULL
  );

  -- Expenses
  INSERT INTO accounts (business_id, name, code, type, description, is_system)
  SELECT v.business_id, v.name, v.code, v.type, v.description, v.is_system
  FROM (VALUES
    (p_business_id, 'Cost of Sales', '5000', 'expense', 'Direct costs', TRUE),
    (p_business_id, 'Operating Expenses', '5100', 'expense', 'General operating expenses', TRUE),
    (p_business_id, 'Supplier Bills', '5200', 'expense', 'Supplier invoices', TRUE),
    (p_business_id, 'Administrative Expenses', '5300', 'expense', 'Admin and overhead', TRUE),
    (p_business_id, 'Depreciation Expense', '5700', 'expense', 'Depreciation expense for fixed assets', TRUE),
    (p_business_id, 'Loss on Asset Disposal', '5800', 'expense', 'Losses from disposal of fixed assets', TRUE),
    (p_business_id, 'Payroll Expense', '6000', 'expense', 'Employee salaries and wages', TRUE),
    (p_business_id, 'Employer SSNIT Contribution', '6010', 'expense', 'Employer SSNIT contributions', TRUE)
  ) AS v(business_id, name, code, type, description, is_system)
  WHERE NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.business_id = v.business_id AND a.code = v.code AND a.deleted_at IS NULL
  );
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION create_system_accounts(UUID) SET search_path = public;
ALTER FUNCTION create_system_accounts(UUID) SECURITY DEFINER;

COMMENT ON FUNCTION create_system_accounts(UUID) IS
  'Idempotent: ensures system accounts exist for the business. Uses WHERE NOT EXISTS (no ON CONFLICT) so it works when the partial unique index accounts_unique_business_code_active_idx is missing. Migration 251.';
