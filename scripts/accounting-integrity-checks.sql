-- ============================================================================
-- Accounting integrity checks (read-only) — run after CoA dedup 248/249/250
-- Run in Supabase SQL Editor. Replace :business_id with a real UUID to scope.
-- ============================================================================

-- 1) Duplicate active accounts (should be 0 after 248/249/250)
SELECT business_id, code, count(*) AS cnt
FROM accounts
WHERE deleted_at IS NULL
GROUP BY business_id, code
HAVING count(*) > 1
ORDER BY count(*) DESC;

-- 2) Orphan journal_entry_lines (account_id not in accounts)
SELECT count(*) AS orphan_jel
FROM journal_entry_lines jel
LEFT JOIN accounts a ON a.id = jel.account_id
WHERE a.id IS NULL;

-- 3) Partial unique index on accounts (must exist for create_system_accounts ON CONFLICT)
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'accounts' AND indexname LIKE '%unique%';

-- 4) Resolver RPCs exist
SELECT proname, pronargs
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    'ensure_accounting_initialized',
    'resolve_default_accounting_period',
    'ensure_accounting_period',
    'get_trial_balance_from_snapshot',
    'generate_trial_balance',
    'create_system_accounts',
    'initialize_business_chart_of_accounts',
    'initialize_business_accounting_period'
  )
ORDER BY proname;

-- 5) Optional: duplicate (business_id, code) in chart_of_accounts (UI may show CoA list)
SELECT business_id, account_code, count(*) AS cnt
FROM chart_of_accounts
WHERE is_active = TRUE
GROUP BY business_id, account_code
HAVING count(*) > 1
ORDER BY count(*) DESC;
