-- CoA dedup integrity audit (read-only). DO NOT FIX.
-- Run in Supabase SQL Editor or: psql "$DATABASE_URL" -f scripts/coa-dedup-integrity-audit.sql

-- STEP 1 — Orphan ledger references
SELECT COUNT(*) AS orphan_jel
FROM journal_entry_lines jel
LEFT JOIN accounts a ON a.id = jel.account_id
WHERE a.id IS NULL;

-- STEP 2 — Cross-tenant ledger references
SELECT COUNT(*) AS cross_tenant_jel
FROM journal_entry_lines jel
JOIN accounts a ON a.id = jel.account_id
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE a.business_id <> je.business_id;

-- STEP 3 — Orphan opening balances
SELECT COUNT(*) AS orphan_pob
FROM period_opening_balances pob
LEFT JOIN accounts a ON a.id = pob.account_id
WHERE a.id IS NULL;

-- STEP 4 — Orphan snapshots (fails if period_account_snapshot was dropped)
SELECT COUNT(*) AS orphan_pas
FROM period_account_snapshot pas
LEFT JOIN accounts a ON a.id = pas.account_id
WHERE a.id IS NULL;

-- STEP 5 — Duplicate active account codes
SELECT business_id, code, COUNT(*)
FROM accounts
WHERE deleted_at IS NULL
GROUP BY business_id, code
HAVING COUNT(*) > 1;

-- STEP 6 — Active account count per business
SELECT business_id, COUNT(*)
FROM accounts
WHERE deleted_at IS NULL
GROUP BY business_id;
