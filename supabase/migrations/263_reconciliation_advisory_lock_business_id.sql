-- ============================================================================
-- Fix advisory lock key: use business_id (not scope_id) for reconciliation posting.
-- One-line change only: pg_advisory_xact_lock(hashtext(p_business_id::text), hashtext(p_proposal_hash)).
-- No other logic, signature, or return changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION post_reconciliation_journal_entry(
  p_business_id UUID,
  p_scope_id UUID,
  p_proposal_hash TEXT,
  p_date DATE,
  p_description TEXT,
  p_lines JSONB,
  p_created_by UUID DEFAULT NULL,
  p_posted_by_accountant_id UUID DEFAULT NULL,
  p_posting_source TEXT DEFAULT 'accountant'
)
RETURNS TABLE (journal_entry_id UUID, reference_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref_id UUID;
  existing_je_id UUID;
BEGIN
  IF p_proposal_hash IS NULL OR TRIM(p_proposal_hash) = '' THEN
    RAISE EXCEPTION 'proposal_hash is required for reconciliation posting.';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'business_id is required for reconciliation posting.';
  END IF;

  v_ref_id := reconciliation_reference_id_from_hash(p_proposal_hash);

  PERFORM pg_advisory_xact_lock(hashtext(p_business_id::text), hashtext(p_proposal_hash));

  SELECT id INTO existing_je_id
  FROM journal_entries
  WHERE reference_type = 'reconciliation'
    AND reference_id = v_ref_id
  LIMIT 1;

  IF existing_je_id IS NOT NULL THEN
    journal_entry_id := existing_je_id;
    reference_id := v_ref_id;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT post_journal_entry(
    p_business_id,
    p_date,
    p_description,
    'reconciliation'::TEXT,
    v_ref_id,
    p_lines,
    FALSE,
    NULL,
    NULL,
    p_created_by,
    NULL,
    NULL,
    NULL,
    p_posted_by_accountant_id,
    COALESCE(p_posting_source, 'accountant'),
    FALSE
  ) INTO existing_je_id;

  journal_entry_id := existing_je_id;
  reference_id := v_ref_id;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION post_reconciliation_journal_entry(UUID, UUID, TEXT, DATE, TEXT, JSONB, UUID, UUID, TEXT) IS
'Idempotent reconciliation JE posting. Advisory lock (business_id, proposal_hash) + re-check by deterministic reference_id. One proposal_hash → one JE. Call from resolve route only.';
