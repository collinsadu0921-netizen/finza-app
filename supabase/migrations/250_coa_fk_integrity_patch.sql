-- ============================================================================
-- Migration 250: CoA FK Integrity Patch
-- ============================================================================
-- Final integrity hardening (no behaviour change):
-- 1. Composite FK support — unnest conkey/confkey; discover every column referencing accounts.id.
-- 2. Tenant-safe reassignment — join accounts (dup + canonical); require same business_id.
-- 3. User schema only — restrict FK discovery to n.nspname = 'public' (exclude pg_catalog, information_schema).
--
-- Idempotent, transaction-safe, no ledger mutation beyond FK reassignment, no snapshot schema changes.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 0: Capture pre-count for validation
-- ============================================================================
DO $$
DECLARE
  v_jel_count_before BIGINT;
  v_dup_count INT;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _dedup_pre_counts (
    journal_entry_lines_count BIGINT,
    captured_at TIMESTAMPTZ DEFAULT NOW()
  );
  DELETE FROM _dedup_pre_counts;
  SELECT COUNT(*) INTO v_jel_count_before FROM journal_entry_lines;
  INSERT INTO _dedup_pre_counts (journal_entry_lines_count) VALUES (v_jel_count_before);

  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT business_id, code
    FROM accounts
    WHERE deleted_at IS NULL
    GROUP BY business_id, code
    HAVING COUNT(*) > 1
  ) t;

  IF v_dup_count = 0 THEN
    RAISE NOTICE 'No duplicate (business_id, code) found. Index and validations will still run.';
  ELSE
    RAISE NOTICE 'Deduplication: % duplicate group(s) will be merged.', v_dup_count;
  END IF;
END $$;

-- ============================================================================
-- STEP 1: Build canonical account selection (stable: COALESCE created_at and cnt)
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
    ORDER BY COALESCE(jel_cnt.cnt, 0) DESC,
             COALESCE(a.created_at, '1970-01-01'::timestamptz) ASC,
             a.id ASC
    LIMIT 1
  ) AS canonical_account_id,
  ARRAY_AGG(a.id ORDER BY COALESCE(a.created_at, '1970-01-01'::timestamptz) ASC, a.id ASC) AS duplicate_account_ids
FROM (
  SELECT business_id, code
  FROM accounts
  WHERE deleted_at IS NULL
  GROUP BY business_id, code
  HAVING COUNT(*) > 1
) d
JOIN accounts a ON a.business_id = d.business_id AND a.code = d.code AND a.deleted_at IS NULL
GROUP BY d.business_id, d.code;

UPDATE _canonical_accounts c
SET duplicate_account_ids = (
  SELECT ARRAY_AGG(u) FROM unnest(c.duplicate_account_ids) u WHERE u <> c.canonical_account_id
)
WHERE canonical_account_id = ANY(duplicate_account_ids);

DELETE FROM _canonical_accounts
WHERE duplicate_account_ids = '{}' OR duplicate_account_ids IS NULL;

-- ============================================================================
-- STEP 2: Capture affected businesses BEFORE any deletes (idempotent snapshot stale)
-- ============================================================================
CREATE TEMP TABLE IF NOT EXISTS _affected_businesses (
  business_id UUID PRIMARY KEY
);
DELETE FROM _affected_businesses;
INSERT INTO _affected_businesses (business_id)
SELECT DISTINCT business_id FROM _canonical_accounts;

-- ============================================================================
-- STEP 3: Discover ALL FKs referencing accounts.id (composite + public only)
-- Unnest conkey/confkey; keep only columns that reference accounts.id.
-- Exclude pg_catalog and information_schema (only public).
-- ============================================================================
CREATE TEMP TABLE IF NOT EXISTS _fk_refs (
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  constraint_name TEXT NOT NULL,
  PRIMARY KEY (schema_name, table_name, column_name)
);
DELETE FROM _fk_refs;

INSERT INTO _fk_refs (schema_name, table_name, column_name, constraint_name)
SELECT DISTINCT
  n.nspname::TEXT,
  c.relname::TEXT,
  a.attname::TEXT,
  pc.conname::TEXT
FROM pg_constraint pc
JOIN pg_class c ON c.oid = pc.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL unnest(pc.conkey, pc.confkey) AS k(conkey_elem, confkey_elem)
JOIN pg_attribute a ON a.attrelid = pc.conrelid AND a.attnum = k.conkey_elem AND a.attnum > 0 AND NOT a.attisdropped
WHERE pc.contype = 'f'
  AND pc.confrelid = 'public.accounts'::regclass
  AND k.confkey_elem = (
    SELECT attnum FROM pg_attribute
    WHERE attrelid = 'public.accounts'::regclass AND attname = 'id' AND attnum > 0 AND NOT attisdropped
  )
  AND n.nspname = 'public'
  AND (n.nspname::text, c.relname::text) <> ('public', 'accounts');

-- ============================================================================
-- STEP 4: Special merge + reassign for period_opening_balances
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
-- STEP 5: Special merge + reassign for period_account_snapshot (if exists)
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
-- STEP 6: Dynamic reassignment — tenant-safe (dup_account.business_id = canonical_account.business_id)
-- Exclude period_opening_balances and period_account_snapshot (already handled above).
-- ============================================================================
DO $$
DECLARE
  r RECORD;
  q TEXT;
BEGIN
  FOR r IN
    SELECT f.schema_name, f.table_name, f.column_name
    FROM _fk_refs f
    WHERE NOT (
      f.schema_name = 'public'
      AND f.table_name = 'period_opening_balances'
      AND f.column_name = 'account_id'
    )
    AND NOT (
      f.schema_name = 'public'
      AND f.table_name = 'period_account_snapshot'
      AND f.column_name = 'account_id'
    )
  LOOP
    -- Use subquery so c/dup_account/canonical_account are in scope; tenant-safe via WHERE.
    q := format(
      'UPDATE %I.%I t SET %I = x.canonical_account_id '
      'FROM ( '
      '  SELECT c.canonical_account_id, (unnest(c.duplicate_account_ids)) AS duplicate_id '
      '  FROM _canonical_accounts c '
      '  JOIN accounts dup_account ON dup_account.id = ANY(c.duplicate_account_ids) '
      '  JOIN accounts canonical_account ON canonical_account.id = c.canonical_account_id '
      '    AND canonical_account.business_id = dup_account.business_id '
      '  CROSS JOIN LATERAL unnest(c.duplicate_account_ids) AS dup_id(uid) '
      '  WHERE dup_account.id = dup_id.uid '
      ') x '
      'WHERE t.%I = x.duplicate_id',
      r.schema_name, r.table_name, r.column_name, r.column_name
    );
    EXECUTE q;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 7: Delete duplicate accounts
-- ============================================================================
DELETE FROM accounts a
WHERE a.id IN (
  SELECT unnest(c.duplicate_account_ids) FROM _canonical_accounts c
);

-- ============================================================================
-- STEP 8: Protect index creation — lock then create partial unique index
-- ============================================================================
LOCK TABLE accounts IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_business_id_code_key;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS unique_account_code_per_business;

DROP INDEX IF EXISTS accounts_unique_business_code_active_idx;
CREATE UNIQUE INDEX accounts_unique_business_code_active_idx
  ON accounts (business_id, code)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- STEP 9: Mark trial_balance_snapshots stale using _affected_businesses
-- ============================================================================
UPDATE trial_balance_snapshots tbs
SET
  is_stale = TRUE,
  last_ledger_change_at = NOW(),
  stale_reason = 'coa_deduplication'
WHERE tbs.business_id IN (SELECT business_id FROM _affected_businesses);

-- ============================================================================
-- STEP 10: Hard validations
-- ============================================================================
DO $$
DECLARE
  v_before BIGINT;
  v_after BIGINT;
  v_dup_remain INT;
  v_orphan_count BIGINT;
  r RECORD;
  q TEXT;
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

  -- 3) Dynamic orphan check for every discovered FK column
  FOR r IN SELECT schema_name, table_name, column_name FROM _fk_refs
  LOOP
    q := format(
      'SELECT COUNT(*) FROM %I.%I t WHERE t.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = t.%I)',
      r.schema_name, r.table_name, r.column_name, r.column_name
    );
    EXECUTE q INTO v_orphan_count;
    IF v_orphan_count > 0 THEN
      RAISE EXCEPTION 'Orphan FKs: %.%.% has % rows with value not in accounts.id', r.schema_name, r.table_name, r.column_name, v_orphan_count;
    END IF;
  END LOOP;

  RAISE NOTICE 'Validations passed: JEL count unchanged (%), no active duplicates, no orphan FKs.', v_after;
  DROP TABLE IF EXISTS _dedup_pre_counts;
END $$;

-- Log affected
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
DROP TABLE IF EXISTS _affected_businesses;
DROP TABLE IF EXISTS _fk_refs;

COMMIT;

-- ============================================================================
-- COMMENT
-- ============================================================================
COMMENT ON INDEX accounts_unique_business_code_active_idx IS
  'One active account per (business_id, code). Partial index WHERE deleted_at IS NULL. FK integrity patch 250.';
