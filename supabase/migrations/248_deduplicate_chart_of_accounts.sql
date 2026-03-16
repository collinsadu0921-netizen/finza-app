-- ============================================================================
-- Migration: Chart of Accounts Deduplication + Ledger Consolidation (FINAL)
-- ============================================================================
-- Resolves duplicate account codes per business by:
-- 1. Selecting one canonical account per (business_id, code) among active (deleted_at IS NULL)
-- 2. Migrating ALL ledger and referencing tables to canonical account
-- 3. Deleting duplicate accounts (non-canonical only)
-- 4. Enforcing uniqueness via partial unique index (business_id, code) WHERE deleted_at IS NULL
-- 5. Marking trial balance snapshots stale for affected businesses
--
-- CRITICAL: ZERO ledger data loss; only FK reassignment; transaction-safe; idempotent.
-- Referencing tables: journal_entry_lines, period_opening_balances, period_account_snapshot,
--   opening_balance_lines, opening_balance_batches, carry_forward_lines,
--   bank_transactions, reconciliation_periods.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 0: Capture pre-count for validation (abort if mismatch later)
-- ============================================================================
DO $$
DECLARE
  v_jel_count_before BIGINT;
  v_dup_count INT;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _dedup_pre_counts (
    journal_entry_lines_count BIGINT,
    accounts_count_before BIGINT,
    captured_at TIMESTAMPTZ DEFAULT NOW()
  );
  DELETE FROM _dedup_pre_counts;
  SELECT COUNT(*) INTO v_jel_count_before FROM journal_entry_lines;
  INSERT INTO _dedup_pre_counts (journal_entry_lines_count, accounts_count_before)
  SELECT v_jel_count_before, (SELECT COUNT(*) FROM accounts WHERE deleted_at IS NULL);

  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT business_id, code
    FROM accounts
    WHERE deleted_at IS NULL
    GROUP BY business_id, code
    HAVING COUNT(*) > 1
  ) t;

  IF v_dup_count = 0 THEN
    RAISE NOTICE 'No duplicate (business_id, code) found in accounts. Index/constraint will still be enforced.';
  ELSE
    RAISE NOTICE 'Deduplication: % duplicate (business_id, code) group(s) will be merged.', v_dup_count;
  END IF;
END $$;

-- ============================================================================
-- STEP 1: Build canonical account selection
-- Priority: (1) most journal_entry_lines, (2) earliest created_at, (3) lowest id
-- accounts.created_at exists (043_accounting_core)
-- ============================================================================
CREATE TEMP TABLE IF NOT EXISTS _canonical_accounts (
  business_id UUID NOT NULL,
  code TEXT NOT NULL,
  canonical_account_id UUID NOT NULL,
  duplicate_account_ids UUID[] NOT NULL,
  PRIMARY KEY (business_id, code)
);

INSERT INTO _canonical_accounts (business_id, code, canonical_account_id, duplicate_account_ids)
SELECT
  d.business_id,
  d.code,
  (
    SELECT a.id
    FROM accounts a
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt
      FROM journal_entry_lines jel
      WHERE jel.account_id = a.id
    ) jel_cnt ON TRUE
    WHERE a.business_id = d.business_id
      AND a.code = d.code
      AND a.deleted_at IS NULL
    ORDER BY COALESCE(jel_cnt.cnt, 0) DESC, a.created_at ASC, a.id ASC
    LIMIT 1
  ) AS canonical_account_id,
  ARRAY_AGG(a.id ORDER BY a.created_at ASC, a.id ASC) AS duplicate_account_ids
FROM (
  SELECT business_id, code
  FROM accounts
  WHERE deleted_at IS NULL
  GROUP BY business_id, code
  HAVING COUNT(*) > 1
) d
JOIN accounts a ON a.business_id = d.business_id AND a.code = d.code AND a.deleted_at IS NULL
GROUP BY d.business_id, d.code;

-- Exclude canonical from duplicate list
UPDATE _canonical_accounts c
SET duplicate_account_ids = (
  SELECT ARRAY_AGG(u) FROM unnest(c.duplicate_account_ids) u WHERE u <> c.canonical_account_id
)
WHERE canonical_account_id = ANY(duplicate_account_ids);

DELETE FROM _canonical_accounts
WHERE duplicate_account_ids = '{}' OR duplicate_account_ids IS NULL;

-- When _canonical_accounts is empty, all UPDATE/DELETE below affect 0 rows; index still applied at end.

-- ============================================================================
-- STEP 2: Reassign journal_entry_lines
-- ============================================================================
UPDATE journal_entry_lines jel
SET account_id = c.canonical_account_id
FROM _canonical_accounts c,
     unnest(c.duplicate_account_ids) AS dup_id(uid)
WHERE jel.account_id = dup_id.uid;

-- ============================================================================
-- STEP 3: period_opening_balances (merge when same period + canonical)
-- ============================================================================
UPDATE period_opening_balances pob
SET opening_balance = pob.opening_balance + d.total_dup_balance
FROM (
  SELECT c.canonical_account_id, pob_dup.period_id, SUM(pob_dup.opening_balance) AS total_dup_balance
  FROM _canonical_accounts c,
       unnest(c.duplicate_account_ids) AS dup_id(uid),
       period_opening_balances pob_dup
  WHERE pob_dup.account_id = dup_id.uid
    AND EXISTS (
      SELECT 1 FROM period_opening_balances pob_c
      WHERE pob_c.period_id = pob_dup.period_id AND pob_c.account_id = c.canonical_account_id
    )
  GROUP BY c.canonical_account_id, pob_dup.period_id
) d
WHERE pob.period_id = d.period_id AND pob.account_id = d.canonical_account_id;

DELETE FROM period_opening_balances pob
WHERE pob.account_id IN (SELECT unnest(c.duplicate_account_ids) FROM _canonical_accounts c)
  AND EXISTS (
    SELECT 1 FROM _canonical_accounts c
    WHERE pob.account_id = ANY(c.duplicate_account_ids)
      AND EXISTS (
        SELECT 1 FROM period_opening_balances pob_c
        WHERE pob_c.period_id = pob.period_id AND pob_c.account_id = c.canonical_account_id
      )
  );

UPDATE period_opening_balances pob
SET account_id = c.canonical_account_id
FROM _canonical_accounts c,
     unnest(c.duplicate_account_ids) AS dup_id(uid)
WHERE pob.account_id = dup_id.uid;

-- ============================================================================
-- STEP 4: period_account_snapshot (merge then reassign)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'period_account_snapshot') THEN
    UPDATE period_account_snapshot pas
    SET ending_balance = pas.ending_balance + d.total_dup_balance
    FROM (
      SELECT c.canonical_account_id, pas_dup.period_id, SUM(pas_dup.ending_balance) AS total_dup_balance
      FROM _canonical_accounts c,
           unnest(c.duplicate_account_ids) AS dup_id(uid),
           period_account_snapshot pas_dup
      WHERE pas_dup.account_id = dup_id.uid
        AND EXISTS (
          SELECT 1 FROM period_account_snapshot pas_c
          WHERE pas_c.period_id = pas_dup.period_id AND pas_c.account_id = c.canonical_account_id
        )
      GROUP BY c.canonical_account_id, pas_dup.period_id
    ) d
    WHERE pas.period_id = d.period_id AND pas.account_id = d.canonical_account_id;

    DELETE FROM period_account_snapshot pas
    WHERE pas.account_id IN (SELECT unnest(c.duplicate_account_ids) FROM _canonical_accounts c)
      AND EXISTS (
        SELECT 1 FROM _canonical_accounts c
        WHERE pas.account_id = ANY(c.duplicate_account_ids)
          AND EXISTS (
            SELECT 1 FROM period_account_snapshot pas_c
            WHERE pas_c.period_id = pas.period_id AND pas_c.account_id = c.canonical_account_id
          )
      );

    UPDATE period_account_snapshot pas
    SET account_id = c.canonical_account_id
    FROM _canonical_accounts c,
         unnest(c.duplicate_account_ids) AS dup_id(uid)
    WHERE pas.account_id = dup_id.uid;
  END IF;
END $$;

-- ============================================================================
-- STEP 5: opening_balance_lines
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'opening_balance_lines') THEN
    UPDATE opening_balance_lines obl
    SET account_id = c.canonical_account_id
    FROM _canonical_accounts c,
         unnest(c.duplicate_account_ids) AS dup_id(uid)
    WHERE obl.account_id = dup_id.uid;
  END IF;
END $$;

-- ============================================================================
-- STEP 6: opening_balance_batches (equity_offset_account_id)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'opening_balance_batches') THEN
    UPDATE opening_balance_batches obb
    SET equity_offset_account_id = c.canonical_account_id
    FROM _canonical_accounts c,
         unnest(c.duplicate_account_ids) AS dup_id(uid)
    WHERE obb.equity_offset_account_id = dup_id.uid;
  END IF;
END $$;

-- ============================================================================
-- STEP 7: carry_forward_lines (account_id)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'carry_forward_lines') THEN
    UPDATE carry_forward_lines cfl
    SET account_id = c.canonical_account_id
    FROM _canonical_accounts c,
         unnest(c.duplicate_account_ids) AS dup_id(uid)
    WHERE cfl.account_id = dup_id.uid;
  END IF;
END $$;

-- ============================================================================
-- STEP 8: bank_transactions (account_id)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bank_transactions') THEN
    UPDATE bank_transactions bt
    SET account_id = c.canonical_account_id
    FROM _canonical_accounts c,
         unnest(c.duplicate_account_ids) AS dup_id(uid)
    WHERE bt.account_id = dup_id.uid;
  END IF;
END $$;

-- ============================================================================
-- STEP 9: reconciliation_periods (account_id)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reconciliation_periods') THEN
    UPDATE reconciliation_periods rp
    SET account_id = c.canonical_account_id
    FROM _canonical_accounts c,
         unnest(c.duplicate_account_ids) AS dup_id(uid)
    WHERE rp.account_id = dup_id.uid;
  END IF;
END $$;

-- ============================================================================
-- STEP 10: Delete duplicate accounts (only non-canonical ids)
-- ============================================================================
DELETE FROM accounts a
WHERE a.id IN (
  SELECT unnest(c.duplicate_account_ids) FROM _canonical_accounts c
);

-- ============================================================================
-- STEP 11: Uniqueness — partial unique index (allows soft-deleted duplicates)
-- Drop any existing full unique constraint, then create partial index.
-- ============================================================================
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_business_id_code_key;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS unique_account_code_per_business;

DROP INDEX IF EXISTS accounts_unique_business_code_active_idx;
CREATE UNIQUE INDEX accounts_unique_business_code_active_idx
  ON accounts (business_id, code)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- STEP 12: Mark trial_balance_snapshots stale for affected businesses
-- ============================================================================
UPDATE trial_balance_snapshots tbs
SET
  is_stale = TRUE,
  last_ledger_change_at = NOW(),
  stale_reason = 'coa_deduplication'
WHERE tbs.business_id IN (SELECT DISTINCT business_id FROM _canonical_accounts);

-- ============================================================================
-- STEP 13: Hard validations — ABORT if any fail
-- ============================================================================
DO $$
DECLARE
  v_before BIGINT;
  v_after BIGINT;
  v_dup_remain INT;
  v_orphan_jel BIGINT;
  v_orphan_pob BIGINT;
  v_orphan_pas BIGINT;
  v_orphan_obl BIGINT;
  v_orphan_obb BIGINT;
  v_orphan_cfl BIGINT;
  v_orphan_bt BIGINT;
  v_orphan_rp BIGINT;
BEGIN
  -- 1) Ledger preservation
  SELECT journal_entry_lines_count INTO v_before FROM _dedup_pre_counts LIMIT 1;
  SELECT COUNT(*) INTO v_after FROM journal_entry_lines;
  IF v_before <> v_after THEN
    RAISE EXCEPTION 'Ledger preservation failed: journal_entry_lines before % vs after %', v_before, v_after;
  END IF;

  -- 2) No remaining duplicates among active accounts
  SELECT COUNT(*) INTO v_dup_remain
  FROM (
    SELECT business_id, code
    FROM accounts
    WHERE deleted_at IS NULL
    GROUP BY business_id, code
    HAVING COUNT(*) > 1
  ) t;
  IF v_dup_remain > 0 THEN
    RAISE EXCEPTION 'Validation failed: % duplicate (business_id, code) still exist among active accounts.', v_dup_remain;
  END IF;

  -- 3) No orphan references (account_id not in accounts)
  SELECT COUNT(*) INTO v_orphan_jel FROM journal_entry_lines jel WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = jel.account_id);
  IF v_orphan_jel > 0 THEN RAISE EXCEPTION 'Orphan journal_entry_lines.account_id: % rows', v_orphan_jel; END IF;

  SELECT COUNT(*) INTO v_orphan_pob FROM period_opening_balances pob WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = pob.account_id);
  IF v_orphan_pob > 0 THEN RAISE EXCEPTION 'Orphan period_opening_balances.account_id: % rows', v_orphan_pob; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'period_account_snapshot') THEN
    SELECT COUNT(*) INTO v_orphan_pas FROM period_account_snapshot pas WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = pas.account_id);
    IF v_orphan_pas > 0 THEN RAISE EXCEPTION 'Orphan period_account_snapshot.account_id: % rows', v_orphan_pas; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'opening_balance_lines') THEN
    SELECT COUNT(*) INTO v_orphan_obl FROM opening_balance_lines obl WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = obl.account_id);
    IF v_orphan_obl > 0 THEN RAISE EXCEPTION 'Orphan opening_balance_lines.account_id: % rows', v_orphan_obl; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'opening_balance_batches') THEN
    SELECT COUNT(*) INTO v_orphan_obb FROM opening_balance_batches obb WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = obb.equity_offset_account_id);
    IF v_orphan_obb > 0 THEN RAISE EXCEPTION 'Orphan opening_balance_batches.equity_offset_account_id: % rows', v_orphan_obb; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'carry_forward_lines') THEN
    SELECT COUNT(*) INTO v_orphan_cfl FROM carry_forward_lines cfl WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = cfl.account_id);
    IF v_orphan_cfl > 0 THEN RAISE EXCEPTION 'Orphan carry_forward_lines.account_id: % rows', v_orphan_cfl; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bank_transactions') THEN
    SELECT COUNT(*) INTO v_orphan_bt FROM bank_transactions bt WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = bt.account_id);
    IF v_orphan_bt > 0 THEN RAISE EXCEPTION 'Orphan bank_transactions.account_id: % rows', v_orphan_bt; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reconciliation_periods') THEN
    SELECT COUNT(*) INTO v_orphan_rp FROM reconciliation_periods rp WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = rp.account_id);
    IF v_orphan_rp > 0 THEN RAISE EXCEPTION 'Orphan reconciliation_periods.account_id: % rows', v_orphan_rp; END IF;
  END IF;

  RAISE NOTICE 'Validations passed: JEL count unchanged (%), no active duplicates, no orphan FKs.', v_after;
  DROP TABLE IF EXISTS _dedup_pre_counts;
END $$;

-- Log affected (business_id, code, canonical_id, duplicates_removed)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT business_id, code, canonical_account_id, array_length(duplicate_account_ids, 1) AS dup_count
    FROM _canonical_accounts
  LOOP
    RAISE NOTICE 'Deduplicated: business_id=%, code=%, canonical_account_id=%, duplicates_removed=%',
      r.business_id, r.code, r.canonical_account_id, r.dup_count;
  END LOOP;
END $$;

DROP TABLE IF EXISTS _canonical_accounts;

COMMIT;

-- ============================================================================
-- COMMENT
-- ============================================================================
COMMENT ON INDEX accounts_unique_business_code_active_idx IS
  'One active account per (business_id, code). Partial index: WHERE deleted_at IS NULL. Enforced after deduplication migration 248.';
