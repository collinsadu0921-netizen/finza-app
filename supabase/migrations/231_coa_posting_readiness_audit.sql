-- ============================================================================
-- CoA Posting Readiness Audit (read-only RPC)
-- ============================================================================
-- Returns one row per issue; zero rows when CoA is ready for all posting paths.
-- No mutations. Ledger-safe. Matches COA_POSTING_READINESS_AUDIT.md.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_coa_posting_readiness(p_business_id UUID)
RETURNS TABLE (
  check_name TEXT,
  account_code TEXT,
  issue TEXT
) AS $$
BEGIN
  -- A. Expense accounts (5000–5999): posting source (accounts) must be expense, not deleted
  RETURN QUERY
  SELECT
    'expense_accounts_posting'::TEXT,
    a.code::TEXT,
    ('type=' || COALESCE(a.type, 'NULL') || ' or deleted')::TEXT
  FROM accounts a
  WHERE a.business_id = p_business_id
    AND a.code BETWEEN '5000' AND '5999'
    AND (a.type <> 'expense' OR a.deleted_at IS NOT NULL);

  -- A2. Expense accounts: validation source (chart_of_accounts) must be expense, active
  RETURN QUERY
  SELECT
    'expense_accounts_coa'::TEXT,
    c.account_code::TEXT,
    ('account_type=' || COALESCE(c.account_type, 'NULL') || ' or is_active=false')::TEXT
  FROM chart_of_accounts c
  WHERE c.business_id = p_business_id
    AND c.account_code BETWEEN '5000' AND '5999'
    AND (c.account_type <> 'expense' OR c.is_active <> true);

  -- B. Revenue (4000): posting source
  RETURN QUERY
  SELECT
    'revenue_account_posting'::TEXT,
    a.code::TEXT,
    ('type=' || COALESCE(a.type, 'NULL') || ' or deleted')::TEXT
  FROM accounts a
  WHERE a.business_id = p_business_id
    AND a.code BETWEEN '4000' AND '4099'
    AND (a.type <> 'income' OR a.deleted_at IS NOT NULL);

  -- B2. Revenue: validation source (chart_of_accounts uses 'revenue')
  RETURN QUERY
  SELECT
    'revenue_account_coa'::TEXT,
    c.account_code::TEXT,
    ('account_type=' || COALESCE(c.account_type, 'NULL') || ' or is_active=false')::TEXT
  FROM chart_of_accounts c
  WHERE c.business_id = p_business_id
    AND c.account_code BETWEEN '4000' AND '4099'
    AND (c.account_type <> 'revenue' OR c.is_active <> true);

  -- C. AR control: mapping must exist and resolved account must be asset
  RETURN QUERY
  SELECT
    'ar_control'::TEXT,
    COALESCE(m.account_code, '(no mapping)')::TEXT,
    (CASE WHEN m.control_key IS NULL THEN 'missing mapping' WHEN a.id IS NULL THEN 'account missing or deleted' ELSE 'not asset (type=' || COALESCE(a.type, 'NULL') || ')' END)::TEXT
  FROM (SELECT 'AR' AS control_key) AS req
  LEFT JOIN chart_of_accounts_control_map m ON m.business_id = p_business_id AND m.control_key = req.control_key
  LEFT JOIN accounts a ON a.business_id = p_business_id AND a.code = m.account_code AND a.deleted_at IS NULL
  WHERE m.control_key IS NULL OR a.id IS NULL OR a.type <> 'asset';

  -- D. CASH control: mapping must exist and resolved account must be asset
  RETURN QUERY
  SELECT
    'cash_control'::TEXT,
    COALESCE(m.account_code, '(no mapping)')::TEXT,
    (CASE WHEN m.control_key IS NULL THEN 'missing mapping' WHEN a.id IS NULL THEN 'account missing or deleted' ELSE 'not asset (type=' || COALESCE(a.type, 'NULL') || ')' END)::TEXT
  FROM (SELECT 'CASH' AS control_key) AS req
  LEFT JOIN chart_of_accounts_control_map m ON m.business_id = p_business_id AND m.control_key = req.control_key
  LEFT JOIN accounts a ON a.business_id = p_business_id AND a.code = m.account_code AND a.deleted_at IS NULL
  WHERE m.control_key IS NULL OR a.id IS NULL OR a.type <> 'asset';

  -- E. Tax accounts (2100, 2110, 2120): must exist, liability, not deleted
  RETURN QUERY
  SELECT
    'tax_accounts'::TEXT,
    codes.code::TEXT,
    (CASE WHEN a.id IS NULL THEN 'missing' ELSE 'not liability or deleted (type=' || COALESCE(a.type, 'NULL') || ')' END)::TEXT
  FROM (SELECT unnest(ARRAY['2100','2110','2120']) AS code) AS codes
  LEFT JOIN accounts a ON a.business_id = p_business_id AND a.code = codes.code AND a.deleted_at IS NULL
  WHERE a.id IS NULL OR a.type <> 'liability';

  -- F. chart_of_accounts must have active entry for tax codes (assert_account_exists uses coa)
  RETURN QUERY
  SELECT
    'tax_accounts_coa'::TEXT,
    codes.account_code::TEXT,
    ('missing or inactive')::TEXT
  FROM (SELECT unnest(ARRAY['2100','2110','2120']) AS account_code) AS codes
  LEFT JOIN chart_of_accounts c ON c.business_id = p_business_id AND c.account_code = codes.account_code AND c.is_active = true
  WHERE c.id IS NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION check_coa_posting_readiness(UUID) IS
  'Read-only CoA posting readiness audit. Returns one row per issue (check_name, account_code, issue); zero rows when ready. No mutations.';
