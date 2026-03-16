-- ============================================================================
-- Reconciliation resolve posting idempotency: advisory lock + re-check.
-- One reconciliation proposal (proposal_hash) → exactly one journal entry.
-- No ledger schema change; no post_journal_entry contract change.
-- ============================================================================
--
-- PLACEMENT:
--   Lock and idempotency check occur in new RPC post_reconciliation_journal_entry,
--   which is called by POST /api/accounting/reconciliation/resolve AFTER:
--     - Proposal validation (proposal_hash match, proposed_fix present)
--     - Authority approval checks (small delta / owner / two-person)
--   and BEFORE any call to post_journal_entry.
--
-- LOCK LOCATION:
--   After business_id and proposal_hash are validated, we take
--   pg_advisory_xact_lock(hashtext(business_id::text), hashtext(proposal_hash::text))
--   so concurrent requests for the same (business, proposal) serialize.
--
-- IDEMPOTENCY LOGIC:
--   Under the lock we SELECT id FROM journal_entries
--   WHERE reference_type = 'reconciliation' AND reference_id = <deterministic_ref_id>
--   LIMIT 1. If found we return that journal_entry id and the same reference_id
--   (no second post). Otherwise we call post_journal_entry(..., reference_id := deterministic_ref_id)
--   and return the new id and reference_id.
--
-- CONCURRENCY SCENARIO PROTECTION:
--   Two concurrent resolve requests with the same proposal_hash and scope_id
--   both pass approval in the app. The first acquires the advisory lock, posts,
--   and commits. The second waits on the lock, then under the lock sees the
--   existing JE (same reference_id), returns it without posting. Result: one JE
--   per proposal.
--
-- ============================================================================
-- Requires: uuid-ossp extension (261_enable_uuid_ossp.sql).

-- Deterministic reference_id from proposal_hash (same input → same UUID every time).
-- Namespace UUID used only for reconciliation reference_id derivation.
CREATE OR REPLACE FUNCTION reconciliation_reference_id_from_hash(p_proposal_hash TEXT)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT extensions.uuid_generate_v5(
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid,
  COALESCE(p_proposal_hash::text, '')
)
$$;

COMMENT ON FUNCTION reconciliation_reference_id_from_hash(TEXT) IS
'Deterministic UUID for reconciliation JEs from proposal_hash. One proposal_hash → one reference_id.';

-- Idempotent reconciliation posting: lock + re-check + post.
-- Call this from resolve route instead of post_journal_entry directly.
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

-- ============================================================================
-- DUPLICATE PROOF QUERIES (run after migration; expect 0 rows)
-- ============================================================================
-- SELECT reference_id, COUNT(*)
-- FROM journal_entries
-- WHERE reference_type = 'reconciliation'
-- GROUP BY reference_id
-- HAVING COUNT(*) > 1;
-- ============================================================================
