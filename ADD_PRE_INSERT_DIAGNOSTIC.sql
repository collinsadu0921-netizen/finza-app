-- ============================================================================
-- TEMPORARY DIAGNOSTIC: Add PRE-INSERT JSONB Totals Capture
-- ============================================================================
-- Purpose: Prove where credits are lost - in JSONB or during INSERT
-- 
-- This adds a RAISE NOTICE right before the INSERT loop in post_journal_entry()
-- to capture the exact JSONB totals at the moment before INSERT.
--
-- TEMPORARY - Remove after root cause is proven
-- ============================================================================

-- First, verify current function has safe extraction (migration 184)
DO $$
DECLARE
  func_oid OID;
  func_def TEXT;
BEGIN
  SELECT p.oid INTO func_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'post_journal_entry'
    AND p.pronargs = 14
  ORDER BY p.oid DESC
  LIMIT 1;
  
  IF func_oid IS NULL THEN
    RAISE EXCEPTION 'No 14-parameter post_journal_entry found';
  END IF;
  
  func_def := pg_get_functiondef(func_oid);
  
  -- Check if diagnostic already exists
  IF func_def LIKE '%PRE-INSERT JSONB TOTALS%' THEN
    RAISE NOTICE 'Diagnostic RAISE NOTICE already exists in function';
    RETURN;
  END IF;
  
  RAISE NOTICE 'Function found (OID: %), diagnostic will be added', func_oid;
END $$;

-- Now add the diagnostic by recreating the function
-- We'll insert the diagnostic right after "RETURNING id INTO journal_id;" and before the INSERT loop
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB,
  p_is_adjustment BOOLEAN DEFAULT FALSE,
  p_adjustment_reason TEXT DEFAULT NULL,
  p_adjustment_ref TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL,
  p_posted_by_accountant_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  journal_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;  -- CRITICAL: Must initialize to 0, not NULL
  total_credit NUMERIC := 0; -- CRITICAL: Must initialize to 0, not NULL
  account_id UUID;
  system_accountant_id UUID;
BEGIN
  -- PHASE 6: Validate adjustment metadata
  IF p_is_adjustment = TRUE THEN
    IF p_adjustment_reason IS NULL OR TRIM(p_adjustment_reason) = '' THEN
      RAISE EXCEPTION 'Adjustment entries require a non-empty adjustment_reason';
    END IF;
    IF p_reference_type != 'adjustment' THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_type = ''adjustment''. Found: %', p_reference_type;
    END IF;
    IF p_reference_id IS NOT NULL THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_id = NULL. Adjustments are standalone entries.';
    END IF;
  ELSE
    IF p_adjustment_reason IS NOT NULL OR p_adjustment_ref IS NOT NULL THEN
      RAISE EXCEPTION 'Non-adjustment entries cannot have adjustment_reason or adjustment_ref';
    END IF;
  END IF;

  -- PHASE 12: Backfill entries must have reason and actor
  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

  -- RETAIL FIX: If posted_by_accountant_id not provided, use business owner as system accountant
  IF p_posted_by_accountant_id IS NULL THEN
    SELECT owner_id INTO system_accountant_id
    FROM businesses
    WHERE id = p_business_id;
    
    IF system_accountant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post journal entry: Business owner not found for business %. System accountant required for automatic posting.', p_business_id;
    END IF;
    
    p_posted_by_accountant_id := system_accountant_id;
  END IF;

  PERFORM assert_accounting_period_is_open(p_business_id, p_date, p_is_adjustment);

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->'debit')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  -- Create journal entry (including posted_by_accountant_id for authorization)
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    is_adjustment,
    adjustment_reason,
    adjustment_ref,
    created_by,
    entry_type,
    backfill_reason,
    backfill_at,
    backfill_actor,
    posted_by_accountant_id
  )
  VALUES (
    p_business_id,
    p_date,
    p_description,
    p_reference_type,
    p_reference_id,
    p_is_adjustment,
    p_adjustment_reason,
    p_adjustment_ref,
    p_created_by,
    CASE WHEN p_entry_type = 'backfill' THEN 'backfill' ELSE NULL END,
    CASE WHEN p_entry_type = 'backfill' THEN p_backfill_reason ELSE NULL END,
    CASE WHEN p_entry_type = 'backfill' THEN NOW() ELSE NULL END,
    CASE WHEN p_entry_type = 'backfill' THEN p_backfill_actor ELSE NULL END,
    p_posted_by_accountant_id
  )
  RETURNING id INTO journal_id;

  -- ============================================================================
  -- TEMPORARY DIAGNOSTIC: PRE-INSERT JSONB Totals (REMOVE AFTER ROOT CAUSE PROOF)
  -- ============================================================================
  RAISE NOTICE 'PRE-INSERT JSONB TOTALS — debit: %, credit: %, lines: %',
    (
      SELECT SUM(COALESCE((l->'debit')::numeric,0))
      FROM jsonb_array_elements(p_lines) l
    ),
    (
      SELECT SUM(COALESCE((l->'credit')::numeric,0))
      FROM jsonb_array_elements(p_lines) l
    ),
    jsonb_array_length(p_lines);
  -- ============================================================================

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_id := (line->>'account_id')::UUID;
    IF account_id IS NULL THEN
      RAISE EXCEPTION 'Account ID is NULL in journal entry line. Description: %', line->>'description';
    END IF;
    
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (
      journal_id,
      account_id,
      COALESCE((line->'debit')::NUMERIC, 0),
      COALESCE((line->'credit')::NUMERIC, 0),
      line->>'description'
    );
  END LOOP;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID) IS 
'FIX: Uses safe JSONB extraction (->) instead of text extraction (->>) for debit/credit values to prevent NULL coercion to 0. RETAIL FIX: Posts journal entry with accountant authorization. If p_posted_by_accountant_id is NULL, uses business owner as system accountant. TEMPORARY DIAGNOSTIC: Includes PRE-INSERT JSONB totals capture - REMOVE AFTER ROOT CAUSE PROOF.';

-- Verify the diagnostic was added
SELECT
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%PRE-INSERT JSONB TOTALS%' THEN '✅ DIAGNOSTIC ADDED'
    ELSE '❌ DIAGNOSTIC NOT FOUND'
  END AS diagnostic_status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_journal_entry'
  AND p.pronargs = 14
ORDER BY p.oid DESC
LIMIT 1;
