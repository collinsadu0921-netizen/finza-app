-- ============================================================================
-- MIGRATION: Fix search_path for post_manual_journal_draft_to_ledger (pgcrypto)
-- ============================================================================
-- Only change: SET search_path = public, extensions, pg_catalog
-- so digest() from pgcrypto is visible. No body, auth, idempotency, or period logic changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION post_manual_journal_draft_to_ledger(
  p_draft_id UUID,
  p_posted_by UUID
)
RETURNS UUID AS $$
DECLARE
  draft_record RECORD;
  period_record RECORD;
  engagement_record RECORD;
  existing_entry_id UUID;
  v_journal_entry_id UUID;
  input_hash_val TEXT;
  canonical_lines JSONB;
  line_record JSONB;
BEGIN
  -- ========================================================================
  -- STEP 1: LOCK DRAFT ROW (FOR UPDATE)
  -- ========================================================================
  SELECT * INTO draft_record
  FROM manual_journal_drafts
  WHERE id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft not found: %', p_draft_id;
  END IF;

  -- ========================================================================
  -- STEP 2: IDEMPOTENCY CHECK - If already posted, return existing
  -- ========================================================================
  IF draft_record.journal_entry_id IS NOT NULL THEN
    SELECT id INTO existing_entry_id
    FROM journal_entries
    WHERE id = draft_record.journal_entry_id;

    IF existing_entry_id IS NOT NULL THEN
      RETURN existing_entry_id;
    END IF;
  END IF;

  -- ========================================================================
  -- STEP 3: RE-VALIDATE DRAFT STATE
  -- ========================================================================
  IF draft_record.status != 'approved' THEN
    RAISE EXCEPTION 'Draft must be approved before posting. Current status: %', draft_record.status;
  END IF;

  -- ========================================================================
  -- STEP 4: VALIDATE PERIOD STATE
  -- ========================================================================
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE id = draft_record.period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period not found: %', draft_record.period_id;
  END IF;

  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Cannot post to locked period: %', draft_record.period_id;
  END IF;

  -- ========================================================================
  -- STEP 4b: AUTHORIZATION — Owner-mode vs Firm-mode
  -- ========================================================================
  IF draft_record.accounting_firm_id IS NULL THEN
    -- ---------- Owner-mode ----------
    IF p_posted_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized posting user';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM businesses
      WHERE id = draft_record.client_business_id
        AND owner_id = p_posted_by
    ) THEN
      RAISE EXCEPTION 'User not authorized to post for this business';
    END IF;

  ELSE
    -- ---------- Firm-mode (unchanged) ----------
    SELECT * INTO engagement_record
    FROM firm_client_engagements
    WHERE accounting_firm_id = draft_record.accounting_firm_id
      AND client_business_id = draft_record.client_business_id
      AND status = 'active'
      AND effective_from <= CURRENT_DATE
      AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
    ORDER BY effective_from DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No active engagement found for firm % and client %',
        draft_record.accounting_firm_id, draft_record.client_business_id;
    END IF;

    IF engagement_record.access_level != 'approve' THEN
      RAISE EXCEPTION 'Engagement access level must be "approve" to post. Current: %',
        engagement_record.access_level;
    END IF;
  END IF;

  -- ========================================================================
  -- STEP 6: COMPUTE INPUT HASH (if not already set)
  -- ========================================================================
  IF draft_record.input_hash IS NULL THEN
    canonical_lines := jsonb_build_array();
    FOR line_record IN SELECT * FROM jsonb_array_elements(draft_record.lines)
    LOOP
      canonical_lines := canonical_lines || jsonb_build_object(
        'account_id', line_record->>'account_id',
        'debit', ROUND((line_record->>'debit')::NUMERIC, 2)::TEXT,
        'credit', ROUND((line_record->>'credit')::NUMERIC, 2)::TEXT,
        'memo', COALESCE(TRIM(line_record->>'memo'), '')
      );
    END LOOP;

    -- Owner-mode: accounting_firm_id is NULL → use '' for deterministic hash
    input_hash_val := encode(
      digest(
        format(
          '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
          draft_record.id,
          COALESCE(draft_record.accounting_firm_id::TEXT, ''),
          draft_record.client_business_id,
          draft_record.period_id,
          draft_record.entry_date::TEXT,
          draft_record.description,
          canonical_lines::TEXT,
          ROUND(draft_record.total_debit, 2)::TEXT,
          ROUND(draft_record.total_credit, 2)::TEXT,
          COALESCE(draft_record.approved_by::TEXT, '')
        ),
        'sha256'
      ),
      'hex'
    );
  ELSE
    input_hash_val := draft_record.input_hash;
  END IF;

  -- ========================================================================
  -- STEP 7: IDEMPOTENCY CHECK - Check if ledger entry exists with same hash
  -- ========================================================================
  SELECT id INTO existing_entry_id
  FROM journal_entries
  WHERE source_type = 'manual_draft'
    AND input_hash = input_hash_val
  LIMIT 1;

  IF existing_entry_id IS NOT NULL THEN
    UPDATE manual_journal_drafts
    SET
      journal_entry_id = existing_entry_id,
      posted_at = NOW(),
      posted_by = p_posted_by
    WHERE id = p_draft_id;

    RETURN existing_entry_id;
  END IF;

  -- ========================================================================
  -- STEP 8: CREATE LEDGER ENTRY + LINES (accounting_firm_id may be NULL)
  -- ========================================================================
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    source_type,
    source_id,
    source_draft_id,
    input_hash,
    accounting_firm_id,
    period_id,
    created_by,
    posted_by
  ) VALUES (
    draft_record.client_business_id,
    draft_record.entry_date,
    draft_record.description,
    'manual',
    draft_record.id,
    'manual_draft',
    draft_record.id,
    draft_record.id,
    input_hash_val,
    draft_record.accounting_firm_id,
    draft_record.period_id,
    draft_record.created_by,
    p_posted_by
  )
  RETURNING id INTO v_journal_entry_id;

  FOR line_record IN SELECT * FROM jsonb_array_elements(draft_record.lines)
  LOOP
    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      description
    ) VALUES (
      v_journal_entry_id,
      (line_record->>'account_id')::UUID,
      COALESCE((line_record->>'debit')::NUMERIC, 0),
      COALESCE((line_record->>'credit')::NUMERIC, 0),
      line_record->>'memo'
    );
  END LOOP;

  -- ========================================================================
  -- STEP 9: UPDATE DRAFT (LINK TO LEDGER ENTRY)
  -- ========================================================================
  UPDATE manual_journal_drafts
  SET
    journal_entry_id = v_journal_entry_id,
    posted_at = NOW(),
    posted_by = p_posted_by,
    input_hash = input_hash_val
  WHERE id = p_draft_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog;

COMMENT ON FUNCTION post_manual_journal_draft_to_ledger(UUID, UUID) IS
'Idempotent post manual journal draft to ledger. Supports owner-mode (accounting_firm_id IS NULL) and firm-mode. Returns existing entry if already posted.';
