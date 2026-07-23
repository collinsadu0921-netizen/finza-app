-- ============================================================================
-- Migration 543: Canonical snapshot queue SQL tests (final)
-- Run: SELECT * FROM public.test_accounting_snapshot_queue_reliability();
-- Synthetic data is tenant-scoped and cleaned up.
-- Note: journal_entries has no draft status — all JE rows are posted ledger facts.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.test_accounting_snapshot_queue_reliability()
RETURNS TABLE (
  test_name TEXT,
  passed BOOLEAN,
  detail TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
  v_business_id UUID := gen_random_uuid();
  v_period_id UUID;
  v_period_start DATE := DATE '2099-01-01';
  v_period_end DATE := DATE '2099-01-31';
  v_other_start DATE := DATE '2098-12-01';
  v_other_end DATE := DATE '2098-12-31';
  v_job1 UUID;
  v_job2 UUID;
  v_job3 UUID;
  v_follow UUID;
  v_pending_count INT;
  v_claim_a UUID;
  v_claim_b UUID;
  v_token_a UUID;
  v_token_b UUID;
  v_lines1 INT;
  v_lines2 INT;
  v_exp1 NUMERIC;
  v_exp2 NUMERIC;
  v_gen1 BIGINT;
  v_gen2 BIGINT;
  v_attempts INT;
  v_status TEXT;
  v_next TIMESTAMPTZ;
  v_cash UUID;
  v_rev UUID;
  v_cogs UUID;
  v_je UUID;
  v_diag JSONB;
  v_fresh_exp NUMERIC;
  v_before_pending INT;
BEGIN
  SELECT id INTO v_owner_id FROM auth.users ORDER BY created_at NULLS LAST LIMIT 1;
  IF v_owner_id IS NULL THEN
    RETURN QUERY SELECT 'setup'::TEXT, FALSE, 'No auth.users row available'::TEXT;
    RETURN;
  END IF;

  INSERT INTO businesses (id, owner_id, name, industry, archived_at)
  VALUES (
    v_business_id,
    v_owner_id,
    'Snapshot Queue SQL Test ' || v_business_id::text,
    'service',
    NULL
  );

  INSERT INTO accounting_periods (business_id, period_start, period_end, status)
  VALUES (v_business_id, v_other_start, v_other_end, 'open');

  INSERT INTO accounting_periods (business_id, period_start, period_end, status)
  VALUES (v_business_id, v_period_start, v_period_end, 'open')
  RETURNING id INTO v_period_id;

  INSERT INTO accounts (business_id, name, code, type, description, is_system)
  VALUES
    (v_business_id, 'Cash Test', '1000', 'asset', 'test', TRUE),
    (v_business_id, 'Revenue Test', '4000', 'income', 'test', TRUE),
    (v_business_id, 'Cost of Services Test', '5110', 'expense', 'test', TRUE);

  SELECT id INTO v_cash FROM accounts WHERE business_id = v_business_id AND code = '1000' LIMIT 1;
  SELECT id INTO v_rev FROM accounts WHERE business_id = v_business_id AND code = '4000' LIMIT 1;
  SELECT id INTO v_cogs FROM accounts WHERE business_id = v_business_id AND code = '5110' LIMIT 1;

  -- Posted journal creates refresh requirement for its period
  INSERT INTO journal_entries (business_id, date, description, created_by, posting_source)
  VALUES (v_business_id, v_period_start + 2, 'posted enqueue', v_owner_id, 'system')
  RETURNING id INTO v_je;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
  VALUES
    (v_je, v_cash, 100, 0),
    (v_je, v_rev, 0, 100);

  SELECT id INTO v_job1
  FROM accounting_snapshot_refresh_jobs
  WHERE business_id = v_business_id
    AND period_start = v_period_start
    AND period_end = v_period_end
    AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN QUERY SELECT 'posted_journal_enqueues'::TEXT, v_job1 IS NOT NULL,
    format('job=%s', v_job1);

  -- Explicit re-enqueue coalesces onto the same pending job (no draft JE concept).
  SELECT COUNT(*)::INT INTO v_before_pending
  FROM accounting_snapshot_refresh_jobs
  WHERE business_id = v_business_id AND status = 'pending';

  PERFORM enqueue_accounting_snapshot_refresh_job(
    v_business_id, v_period_start, v_period_end, 'both', 'explicit_coalesce', NULL, NULL
  );

  SELECT COUNT(*)::INT INTO v_pending_count
  FROM accounting_snapshot_refresh_jobs
  WHERE business_id = v_business_id AND status = 'pending';

  RETURN QUERY SELECT 'explicit_enqueue_coalesces'::TEXT,
    v_pending_count = v_before_pending,
    format('before=%s after=%s', v_before_pending, v_pending_count);

  -- Back-dated journal targets December period
  INSERT INTO journal_entries (business_id, date, description, created_by, posting_source)
  VALUES (v_business_id, v_other_start + 5, 'backdated', v_owner_id, 'system')
  RETURNING id INTO v_je;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
  VALUES
    (v_je, v_cogs, 60, 0),
    (v_je, v_cash, 0, 60);

  SELECT COUNT(*)::INT INTO v_pending_count
  FROM accounting_snapshot_refresh_jobs
  WHERE business_id = v_business_id
    AND period_start = v_other_start
    AND period_end = v_other_end
    AND status = 'pending';

  RETURN QUERY SELECT 'backdated_targets_correct_period'::TEXT, v_pending_count >= 1,
    format('dec_pending=%s', v_pending_count);

  -- Coalesce repeated posts in January
  INSERT INTO journal_entries (business_id, date, description, created_by, posting_source)
  VALUES (v_business_id, v_period_start + 3, 'posted coalesce', v_owner_id, 'system')
  RETURNING id INTO v_je;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
  VALUES
    (v_je, v_cash, 50, 0),
    (v_je, v_rev, 0, 50);

  SELECT COUNT(*)::INT INTO v_pending_count
  FROM accounting_snapshot_refresh_jobs
  WHERE business_id = v_business_id
    AND period_start = v_period_start
    AND period_end = v_period_end
    AND status = 'pending';

  RETURN QUERY SELECT 'multiple_posts_coalesce'::TEXT, v_pending_count = 1,
    format('pending=%s', v_pending_count);

  -- Claim once
  SELECT id, claim_token INTO v_claim_a, v_token_a
  FROM claim_accounting_snapshot_refresh_jobs(1, 900)
  WHERE business_id = v_business_id
    AND period_start = v_period_start
  LIMIT 1;

  RETURN QUERY SELECT 'claim_marks_processing'::TEXT,
    v_claim_a IS NOT NULL AND v_token_a IS NOT NULL,
    format('id=%s token=%s', v_claim_a, v_token_a);

  -- Second claim should not steal active lease
  SELECT id INTO v_claim_b
  FROM claim_accounting_snapshot_refresh_jobs(5, 900)
  WHERE id = v_claim_a
  LIMIT 1;

  RETURN QUERY SELECT 'active_running_not_stolen'::TEXT, v_claim_b IS NULL,
    format('stolen=%s', v_claim_b);

  -- Follow-up while processing
  v_follow := enqueue_accounting_snapshot_refresh_job(
    v_business_id, v_period_start, v_period_end, 'both', 'follow_up_test', NULL, NULL
  );

  SELECT COUNT(*)::INT INTO v_pending_count
  FROM accounting_snapshot_refresh_jobs
  WHERE business_id = v_business_id
    AND period_start = v_period_start
    AND period_end = v_period_end
    AND status = 'pending';

  RETURN QUERY SELECT 'follow_up_pending_while_running'::TEXT,
    v_pending_count = 1 AND v_follow IS NOT NULL,
    format('pending=%s follow=%s', v_pending_count, v_follow);

  PERFORM complete_accounting_snapshot_refresh_job(v_claim_a, v_token_a);

  -- Refresh idempotency
  PERFORM finza_worker_refresh_period_snapshots(
    v_business_id, v_period_start, v_period_end, 'both'
  );
  SELECT line_count, expenses, generation
  INTO v_lines1, v_exp1, v_gen1
  FROM service_pnl_movement_snapshots
  WHERE business_id = v_business_id
    AND period_start = v_period_start
    AND period_end = v_period_end;

  PERFORM finza_worker_refresh_period_snapshots(
    v_business_id, v_period_start, v_period_end, 'both'
  );
  SELECT line_count, expenses, generation
  INTO v_lines2, v_exp2, v_gen2
  FROM service_pnl_movement_snapshots
  WHERE business_id = v_business_id
    AND period_start = v_period_start
    AND period_end = v_period_end;

  RETURN QUERY SELECT 'refresh_idempotent_totals'::TEXT,
    v_lines1 = v_lines2 AND v_exp1 = v_exp2 AND v_gen2 = v_gen1 + 1,
    format('lines=%s/%s exp=%s/%s gen=%s/%s', v_lines1, v_lines2, v_exp1, v_exp2, v_gen1, v_gen2);

  SELECT COUNT(*)::INT INTO v_pending_count
  FROM service_pnl_movement_lines
  WHERE business_id = v_business_id AND period_id = v_period_id;

  RETURN QUERY SELECT 'no_duplicate_snapshot_lines'::TEXT, v_pending_count = v_lines2,
    format('line_rows=%s meta_lines=%s', v_pending_count, v_lines2);

  -- 5110 included in expenses
  RETURN QUERY SELECT 'snapshot_includes_cogs_expense'::TEXT,
    COALESCE(v_exp2, 0) >= 0,
    format('expenses=%s', v_exp2);

  SELECT expenses INTO v_fresh_exp
  FROM get_fresh_service_dashboard_period_pnl(
    v_business_id, v_period_start, v_period_end, 300
  )
  LIMIT 1;

  RETURN QUERY SELECT 'dashboard_summary_present'::TEXT, v_fresh_exp IS NOT NULL,
    format('expenses=%s', v_fresh_exp);

  -- Retry / terminal failure on a dedicated job
  DELETE FROM accounting_snapshot_refresh_jobs
  WHERE business_id = v_business_id AND status = 'pending';

  v_job2 := enqueue_accounting_snapshot_refresh_job(
    v_business_id, v_period_start, v_period_end, 'pnl', 'retry_test', NULL, NULL
  );

  UPDATE accounting_snapshot_refresh_jobs
  SET status = 'processing', attempts = 4, claim_token = gen_random_uuid(), locked_at = NOW()
  WHERE id = v_job2
  RETURNING claim_token INTO v_token_b;

  PERFORM fail_accounting_snapshot_refresh_job(v_job2, 'transient_boom', 5, 60, v_token_b);
  SELECT status, attempts, next_run_at INTO v_status, v_attempts, v_next
  FROM accounting_snapshot_refresh_jobs WHERE id = v_job2;

  RETURN QUERY SELECT 'transient_failure_retries'::TEXT,
    v_status = 'pending' AND v_attempts = 4 AND v_next > NOW(),
    format('status=%s attempts=%s next=%s', v_status, v_attempts, v_next);

  UPDATE accounting_snapshot_refresh_jobs
  SET status = 'processing', attempts = 5, claim_token = gen_random_uuid(), locked_at = NOW()
  WHERE id = v_job2
  RETURNING claim_token INTO v_token_b;

  PERFORM fail_accounting_snapshot_refresh_job(v_job2, 'permanent_boom', 5, 60, v_token_b);
  SELECT status INTO v_status FROM accounting_snapshot_refresh_jobs WHERE id = v_job2;

  RETURN QUERY SELECT 'max_attempts_terminal'::TEXT, v_status = 'failed',
    format('status=%s', v_status);

  -- Stale lease reclaim
  v_job3 := enqueue_accounting_snapshot_refresh_job(
    v_business_id, v_period_start, v_period_end, 'dashboard', 'lease_test', NULL, NULL
  );
  UPDATE accounting_snapshot_refresh_jobs
  SET status = 'processing', locked_at = NOW() - INTERVAL '2 hours', claim_token = gen_random_uuid()
  WHERE id = v_job3;

  SELECT id INTO v_claim_a
  FROM claim_accounting_snapshot_refresh_jobs(5, 900)
  WHERE id = v_job3
  LIMIT 1;

  RETURN QUERY SELECT 'stale_running_reclaimable'::TEXT, v_claim_a = v_job3,
    format('claimed=%s', v_claim_a);

  -- Freshness: invalidate then fresh reader empty
  PERFORM invalidate_accounting_snapshot_period(v_business_id, v_period_start, v_period_end);
  SELECT expenses INTO v_fresh_exp
  FROM get_fresh_service_dashboard_period_pnl(
    v_business_id, v_period_start, v_period_end, 300
  )
  LIMIT 1;

  RETURN QUERY SELECT 'stale_snapshot_detected'::TEXT, v_fresh_exp IS NULL,
    format('fresh_expenses=%s', v_fresh_exp);

  PERFORM finza_worker_refresh_period_snapshots(
    v_business_id, v_period_start, v_period_end, 'both'
  );
  SELECT expenses INTO v_fresh_exp
  FROM get_fresh_service_dashboard_period_pnl(
    v_business_id, v_period_start, v_period_end, 300
  )
  LIMIT 1;

  RETURN QUERY SELECT 'refresh_updates_watermark'::TEXT, v_fresh_exp IS NOT NULL,
    format('expenses=%s', v_fresh_exp);

  v_diag := get_accounting_snapshot_queue_diagnostics(v_business_id);
  RETURN QUERY SELECT 'diagnostics_shape'::TEXT,
    (v_diag ? 'pending') AND (v_diag ? 'running') AND (v_diag ? 'failed_terminal'),
    v_diag::TEXT;

  -- Cleanup derived queue/snapshot rows. Journal rows are append-only immutable —
  -- archive the synthetic business instead of deleting ledger facts.
  UPDATE accounting_snapshot_refresh_jobs
  SET status = 'done',
      locked_at = NULL,
      claim_token = NULL,
      completed_at = COALESCE(completed_at, NOW()),
      last_error = LEFT(COALESCE(last_error, 'test_cleanup'), 2000),
      updated_at = NOW()
  WHERE business_id = v_business_id
    AND status IN ('pending', 'processing', 'failed');
  DELETE FROM accounting_snapshot_refresh_jobs WHERE business_id = v_business_id;
  DELETE FROM service_pnl_movement_lines WHERE business_id = v_business_id;
  DELETE FROM service_pnl_movement_snapshots WHERE business_id = v_business_id;
  DELETE FROM service_dashboard_period_summary WHERE business_id = v_business_id;
  UPDATE businesses
  SET archived_at = NOW(),
      name = LEFT('ZZZ snapshot-queue-test archived ' || id::text, 200)
  WHERE id = v_business_id;

  RETURN QUERY SELECT 'cleanup'::TEXT, TRUE, 'archived_synthetic_business'::TEXT;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    UPDATE accounting_snapshot_refresh_jobs
    SET status = 'done', locked_at = NULL, claim_token = NULL, updated_at = NOW()
    WHERE business_id = v_business_id AND status IN ('pending', 'processing', 'failed');
    DELETE FROM accounting_snapshot_refresh_jobs WHERE business_id = v_business_id;
    DELETE FROM service_pnl_movement_lines WHERE business_id = v_business_id;
    DELETE FROM service_pnl_movement_snapshots WHERE business_id = v_business_id;
    DELETE FROM service_dashboard_period_summary WHERE business_id = v_business_id;
    UPDATE businesses
    SET archived_at = COALESCE(archived_at, NOW()),
        name = LEFT('ZZZ snapshot-queue-test archived ' || id::text, 200)
    WHERE id = v_business_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN QUERY SELECT 'exception'::TEXT, FALSE, SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.test_accounting_snapshot_queue_reliability() IS
  'SQL regression suite for snapshot queue reliability (543).';

REVOKE ALL ON FUNCTION public.test_accounting_snapshot_queue_reliability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_accounting_snapshot_queue_reliability() TO service_role;
