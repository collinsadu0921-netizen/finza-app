-- ============================================================================
-- MIGRATION: Step 9.0 - Period Close UX Enhancements
-- ============================================================================
-- This migration adds period close request workflow and readiness checks.
-- Implements explicit close request → approval → lock flow.
--
-- Scope: Accounting Workspace ONLY
-- ============================================================================

-- ============================================================================
-- STEP 1: EXTEND accounting_periods TABLE
-- ============================================================================
-- Add "closing" status and close request tracking fields

-- Update status constraint to include 'closing'
ALTER TABLE accounting_periods
  DROP CONSTRAINT IF EXISTS accounting_periods_status_check;

ALTER TABLE accounting_periods
  ADD CONSTRAINT accounting_periods_status_check
  CHECK (status IN ('open', 'closing', 'soft_closed', 'locked'));

-- Add close request tracking fields
ALTER TABLE accounting_periods
  ADD COLUMN IF NOT EXISTS close_requested_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS close_requested_by UUID REFERENCES auth.users(id);

-- Add index for close request queries
CREATE INDEX IF NOT EXISTS idx_accounting_periods_close_requested 
  ON accounting_periods(close_requested_at) 
  WHERE close_requested_at IS NOT NULL;

-- Add comments
COMMENT ON COLUMN accounting_periods.status IS 
'Period lifecycle status: open → closing (requested) → soft_closed → locked. Closing indicates a close request is pending approval.';
COMMENT ON COLUMN accounting_periods.close_requested_at IS 
'Timestamp when close was requested. NULL if no active close request.';
COMMENT ON COLUMN accounting_periods.close_requested_by IS 
'User who requested the period close. NULL if no active close request.';

-- ============================================================================
-- STEP 2: EXTEND accounting_period_actions TABLE
-- ============================================================================
-- Add support for request_close, approve_close, reject_close actions

ALTER TABLE accounting_period_actions
  DROP CONSTRAINT IF EXISTS accounting_period_actions_action_check;

ALTER TABLE accounting_period_actions
  ADD CONSTRAINT accounting_period_actions_action_check
  CHECK (action IN ('soft_close', 'lock', 'reopen', 'request_close', 'approve_close', 'reject_close'));

-- Update comment
COMMENT ON TABLE accounting_period_actions IS
'Audit trail for accounting period actions (request_close, approve_close, reject_close, soft_close, lock, reopen) performed by authorized users.';

-- ============================================================================
-- STEP 3: CREATE READINESS CHECKS RESOLVER FUNCTION
-- ============================================================================
-- Single deterministic resolver used by UI and APIs

CREATE OR REPLACE FUNCTION check_period_close_readiness(
  p_business_id UUID,
  p_period_start DATE
)
RETURNS JSONB AS $$
DECLARE
  v_period RECORD;
  v_blockers JSONB[] := ARRAY[]::JSONB[];
  v_warnings JSONB[] := ARRAY[]::JSONB[];
  v_status TEXT;
  v_result JSONB;
  v_unposted_approved_drafts INTEGER;
  v_draft_count INTEGER;
  v_submitted_count INTEGER;
  v_active_close_request_count INTEGER;
  v_period_id UUID;
BEGIN
  -- Get period
  SELECT * INTO v_period
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND period_start = p_period_start
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'BLOCKED',
      'blockers', jsonb_build_array(
        jsonb_build_object(
          'code', 'PERIOD_NOT_FOUND',
          'title', 'Period not found',
          'detail', format('No period found for business %s and period start %s', p_business_id, p_period_start),
          'deepLink', NULL
        )
      ),
      'warnings', jsonb_build_array(),
      'computed_at', NOW(),
      'period_id', NULL,
      'business_id', p_business_id,
      'firm_id', NULL,
      'snapshot_hash', NULL
    );
  END IF;

  v_period_id := v_period.id;

  -- BLOCKER: Period already locked
  IF v_period.status = 'locked' THEN
    v_blockers := array_append(v_blockers, jsonb_build_object(
      'code', 'PERIOD_LOCKED',
      'title', 'Period is already locked',
      'detail', 'This period has been locked and cannot be closed again.',
      'deepLink', NULL
    ));
  END IF;

  -- BLOCKER: Duplicate active close request
  SELECT COUNT(*) INTO v_active_close_request_count
  FROM accounting_period_actions
  WHERE business_id = p_business_id
    AND period_start = p_period_start
    AND action = 'request_close'
    AND performed_at > (
      SELECT COALESCE(MAX(performed_at), '1970-01-01'::TIMESTAMP WITH TIME ZONE)
      FROM accounting_period_actions
      WHERE business_id = p_business_id
        AND period_start = p_period_start
        AND action IN ('approve_close', 'reject_close')
    );

  IF v_active_close_request_count > 0 AND v_period.status = 'closing' THEN
    v_blockers := array_append(v_blockers, jsonb_build_object(
      'code', 'DUPLICATE_CLOSE_REQUEST',
      'title', 'Active close request exists',
      'detail', 'A close request is already pending for this period.',
      'deepLink', NULL
    ));
  END IF;

  -- BLOCKER: Unposted approved manual journal drafts in period
  -- Check if there are approved drafts that haven't been posted
  SELECT COUNT(*) INTO v_unposted_approved_drafts
  FROM manual_journal_drafts mjd
  WHERE mjd.client_business_id = p_business_id
    AND mjd.period_id = v_period_id
    AND mjd.status = 'approved'
    AND mjd.journal_entry_id IS NULL;

  IF v_unposted_approved_drafts > 0 THEN
    v_blockers := array_append(v_blockers, jsonb_build_object(
      'code', 'UNPOSTED_APPROVED_DRAFTS',
      'title', format('%s unposted approved draft(s)', v_unposted_approved_drafts),
      'detail', format('There are %s approved manual journal draft(s) that have not been posted to the ledger. Post or reject them before closing.', v_unposted_approved_drafts),
      'deepLink', format('/accounting/drafts?period_id=%s&status=approved', v_period_id)
    ));
  END IF;

  -- WARNING: Drafts exist (not blocking, but should be acknowledged)
  SELECT COUNT(*) INTO v_draft_count
  FROM manual_journal_drafts mjd
  WHERE mjd.client_business_id = p_business_id
    AND mjd.period_id = v_period_id
    AND mjd.status = 'draft';

  IF v_draft_count > 0 THEN
    v_warnings := array_append(v_warnings, jsonb_build_object(
      'code', 'DRAFTS_EXIST',
      'title', format('%s draft(s) exist', v_draft_count),
      'detail', format('There are %s draft manual journal entry(ies) in this period. Consider reviewing them before closing.', v_draft_count),
      'deepLink', format('/accounting/drafts?period_id=%s&status=draft', v_period_id)
    ));
  END IF;

  -- WARNING: Submitted journals exist
  SELECT COUNT(*) INTO v_submitted_count
  FROM manual_journal_drafts mjd
  WHERE mjd.client_business_id = p_business_id
    AND mjd.period_id = v_period_id
    AND mjd.status = 'submitted';

  IF v_submitted_count > 0 THEN
    v_warnings := array_append(v_warnings, jsonb_build_object(
      'code', 'SUBMITTED_JOURNALS_EXIST',
      'title', format('%s submitted journal(s) pending approval', v_submitted_count),
      'detail', format('There are %s submitted manual journal entry(ies) awaiting approval in this period.', v_submitted_count),
      'deepLink', format('/accounting/drafts?period_id=%s&status=submitted', v_period_id)
    ));
  END IF;

  -- Determine final status
  IF array_length(v_blockers, 1) > 0 THEN
    v_status := 'BLOCKED';
  ELSIF array_length(v_warnings, 1) > 0 THEN
    v_status := 'READY_WITH_WARNINGS';
  ELSE
    v_status := 'READY';
  END IF;

  -- Build result with proper JSONB aggregation
  v_result := jsonb_build_object(
    'status', v_status,
    'blockers', COALESCE(
      (SELECT jsonb_agg(blocker) FROM unnest(v_blockers) blocker),
      '[]'::jsonb
    ),
    'warnings', COALESCE(
      (SELECT jsonb_agg(warning) FROM unnest(v_warnings) warning),
      '[]'::jsonb
    ),
    'computed_at', NOW(),
    'period_id', v_period_id,
    'business_id', p_business_id,
    'firm_id', NULL,
    'snapshot_hash', md5(format('%s|%s|%s', p_business_id, p_period_start, NOW()::TEXT))
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_period_close_readiness(UUID, DATE) IS
'Deterministic resolver for period close readiness checks. Returns blockers (must fix), warnings (acknowledge), and readiness status. Used by UI and APIs.';

-- ============================================================================
-- STEP 4: HELPER FUNCTION TO GET PERIOD CLOSE REQUEST INFO
-- ============================================================================

CREATE OR REPLACE FUNCTION get_period_close_request_info(
  p_business_id UUID,
  p_period_start DATE
)
RETURNS TABLE (
  has_active_request BOOLEAN,
  requested_at TIMESTAMP WITH TIME ZONE,
  requested_by UUID,
  requested_by_email TEXT,
  requested_by_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ap.close_requested_at IS NOT NULL AS has_active_request,
    ap.close_requested_at,
    ap.close_requested_by,
    COALESCE(u.email, '')::TEXT AS requested_by_email,
    COALESCE(u.full_name, '')::TEXT AS requested_by_name
  FROM accounting_periods ap
  LEFT JOIN users u ON u.id = ap.close_requested_by
  WHERE ap.business_id = p_business_id
    AND ap.period_start = p_period_start
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_period_close_request_info(UUID, DATE) IS
'Returns information about active close request for a period, including who requested it and when.';
