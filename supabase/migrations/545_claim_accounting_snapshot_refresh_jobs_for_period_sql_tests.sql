-- ============================================================================
-- Migration 545: SQL tests for scoped snapshot claim (544)
-- Run: SELECT * FROM public.test_claim_accounting_snapshot_refresh_jobs_for_period();
-- ============================================================================

CREATE OR REPLACE FUNCTION public.test_claim_accounting_snapshot_refresh_jobs_for_period()
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
  v_biz_a UUID := gen_random_uuid();
  v_biz_b UUID := gen_random_uuid();
  v_period_start DATE := DATE '2097-01-01';
  v_period_end DATE := DATE '2097-01-31';
  v_other_start DATE := DATE '2097-02-01';
  v_other_end DATE := DATE '2097-02-28';
  v_job_a UUID;
  v_job_a2 UUID;
  v_job_b UUID;
  v_job_other_period UUID;
  v_job_pnl UUID;
  v_claim_id UUID;
  v_claim_token UUID;
  v_claim_id2 UUID;
  v_claim_token2 UUID;
  v_global_id UUID;
  v_status TEXT;
  v_job_type TEXT;
  v_attempts INT;
  v_next TIMESTAMPTZ;
  v_ok BOOLEAN;
  v_count INT;
BEGIN
  SELECT id INTO v_owner_id FROM auth.users ORDER BY created_at NULLS LAST LIMIT 1;
  IF v_owner_id IS NULL THEN
    RETURN QUERY SELECT 'setup'::TEXT, FALSE, 'No auth.users row available'::TEXT;
    RETURN;
  END IF;

  INSERT INTO businesses (id, owner_id, name, industry, archived_at)
  VALUES
    (v_biz_a, v_owner_id, 'Scoped Claim A ' || v_biz_a::text, 'service', NULL),
    (v_biz_b, v_owner_id, 'Scoped Claim B ' || v_biz_b::text, 'service', NULL);

  INSERT INTO accounting_periods (business_id, period_start, period_end, status)
  VALUES
    (v_biz_a, v_period_start, v_period_end, 'open'),
    (v_biz_a, v_other_start, v_other_end, 'open'),
    (v_biz_b, v_period_start, v_period_end, 'open');

  v_job_a := enqueue_accounting_snapshot_refresh_job(
    v_biz_a, v_period_start, v_period_end, 'both', 'scoped_test_a', NULL, NULL
  );
  v_job_b := enqueue_accounting_snapshot_refresh_job(
    v_biz_b, v_period_start, v_period_end, 'both', 'scoped_test_b', NULL, NULL
  );
  v_job_other_period := enqueue_accounting_snapshot_refresh_job(
    v_biz_a, v_other_start, v_other_end, 'both', 'scoped_test_other_period', NULL, NULL
  );

  -- 1. Scoped claim returns only requested business
  SELECT id, claim_token INTO v_claim_id, v_claim_token
  FROM claim_accounting_snapshot_refresh_jobs_for_period(
    v_biz_a, v_period_start, v_period_end, 10, 900
  )
  LIMIT 1;

  RETURN QUERY SELECT 'scoped_claim_only_requested_business'::TEXT,
    v_claim_id = v_job_a AND v_claim_token IS NOT NULL,
    format('claimed=%s expected=%s', v_claim_id, v_job_a);

  SELECT COUNT(*)::INT INTO v_count
  FROM accounting_snapshot_refresh_jobs
  WHERE id = v_job_b AND status = 'pending';

  RETURN QUERY SELECT 'other_tenant_untouched_after_scoped_claim'::TEXT,
    v_count = 1,
    format('biz_b_pending=%s', v_count);

  -- Reset A for further tests: complete then re-enqueue
  PERFORM complete_accounting_snapshot_refresh_job(v_claim_id, v_claim_token);
  v_job_a := enqueue_accounting_snapshot_refresh_job(
    v_biz_a, v_period_start, v_period_end, 'both', 'scoped_test_a2', NULL, NULL
  );

  -- 2. Scoped claim returns only requested period
  SELECT id INTO v_claim_id
  FROM claim_accounting_snapshot_refresh_jobs_for_period(
    v_biz_a, v_period_start, v_period_end, 10, 900
  )
  LIMIT 1;

  SELECT COUNT(*)::INT INTO v_count
  FROM accounting_snapshot_refresh_jobs
  WHERE id = v_job_other_period AND status = 'pending';

  RETURN QUERY SELECT 'scoped_claim_only_requested_period'::TEXT,
    v_claim_id = v_job_a AND v_count = 1,
    format('claimed=%s other_period_pending=%s', v_claim_id, v_count);

  SELECT claim_token INTO v_claim_token
  FROM accounting_snapshot_refresh_jobs WHERE id = v_claim_id;

  -- 3. Scoped and global cannot both claim the same job.
  -- Defer other pending fixtures so global claim(limit=1) cannot steal them
  -- while we prove the active scoped lease is not reclaimable.
  UPDATE accounting_snapshot_refresh_jobs
  SET next_run_at = NOW() + INTERVAL '1 day'
  WHERE business_id IN (v_biz_a, v_biz_b)
    AND id IS DISTINCT FROM v_claim_id
    AND status = 'pending';

  SELECT id INTO v_global_id
  FROM claim_accounting_snapshot_refresh_jobs(1, 900)
  WHERE id = v_claim_id
  LIMIT 1;

  RETURN QUERY SELECT 'scoped_and_global_cannot_double_claim'::TEXT,
    v_global_id IS NULL,
    format('global_stole=%s', v_global_id);

  UPDATE accounting_snapshot_refresh_jobs
  SET next_run_at = NOW() - INTERVAL '1 second'
  WHERE business_id IN (v_biz_a, v_biz_b)
    AND status = 'pending';

  -- 4. Claim token required for completion
  v_ok := complete_accounting_snapshot_refresh_job(v_claim_id, NULL);
  SELECT status INTO v_status FROM accounting_snapshot_refresh_jobs WHERE id = v_claim_id;
  RETURN QUERY SELECT 'complete_requires_claim_token'::TEXT,
    v_ok IS DISTINCT FROM TRUE AND v_status = 'processing',
    format('ok=%s status=%s', v_ok, v_status);

  v_ok := complete_accounting_snapshot_refresh_job(v_claim_id, gen_random_uuid());
  SELECT status INTO v_status FROM accounting_snapshot_refresh_jobs WHERE id = v_claim_id;
  RETURN QUERY SELECT 'complete_rejects_wrong_token'::TEXT,
    v_ok IS DISTINCT FROM TRUE AND v_status = 'processing',
    format('ok=%s status=%s', v_ok, v_status);

  v_ok := complete_accounting_snapshot_refresh_job(v_claim_id, v_claim_token);
  SELECT status INTO v_status FROM accounting_snapshot_refresh_jobs WHERE id = v_claim_id;
  RETURN QUERY SELECT 'complete_with_token_succeeds'::TEXT,
    v_ok IS TRUE AND v_status = 'done',
    format('ok=%s status=%s', v_ok, v_status);

  -- 5. Lease expiry permits safe reclaim
  v_job_a2 := enqueue_accounting_snapshot_refresh_job(
    v_biz_a, v_period_start, v_period_end, 'both', 'lease_reclaim', NULL, NULL
  );
  UPDATE accounting_snapshot_refresh_jobs
  SET status = 'processing',
      locked_at = NOW() - INTERVAL '2 hours',
      claim_token = gen_random_uuid(),
      attempts = 1
  WHERE id = v_job_a2;

  SELECT id, claim_token INTO v_claim_id, v_claim_token
  FROM claim_accounting_snapshot_refresh_jobs_for_period(
    v_biz_a, v_period_start, v_period_end, 5, 900
  )
  WHERE id = v_job_a2
  LIMIT 1;

  RETURN QUERY SELECT 'lease_expiry_permits_reclaim'::TEXT,
    v_claim_id = v_job_a2 AND v_claim_token IS NOT NULL,
    format('claimed=%s', v_claim_id);

  -- 6. Retry/backoff rules remain intact
  PERFORM fail_accounting_snapshot_refresh_job(v_claim_id, 'transient', 5, 60, v_claim_token);
  SELECT status, attempts, next_run_at INTO v_status, v_attempts, v_next
  FROM accounting_snapshot_refresh_jobs WHERE id = v_job_a2;

  RETURN QUERY SELECT 'retry_backoff_intact'::TEXT,
    v_status = 'pending' AND v_next > NOW(),
    format('status=%s attempts=%s next=%s', v_status, v_attempts, v_next);

  -- Make only this job immediately claimable so global claim(limit=1) does not
  -- steal unrelated tenant/period fixtures still pending in this suite.
  UPDATE accounting_snapshot_refresh_jobs
  SET next_run_at = NOW() + INTERVAL '1 day'
  WHERE business_id IN (v_biz_a, v_biz_b)
    AND id IS DISTINCT FROM v_job_a2
    AND status = 'pending';

  UPDATE accounting_snapshot_refresh_jobs
  SET next_run_at = NOW() - INTERVAL '1 second'
  WHERE id = v_job_a2;

  -- 7. Failed immediate processing remains recoverable by global worker
  SELECT id INTO v_global_id
  FROM claim_accounting_snapshot_refresh_jobs(1, 900)
  WHERE id = v_job_a2
  LIMIT 1;

  RETURN QUERY SELECT 'global_worker_can_recover_after_fail'::TEXT,
    v_global_id = v_job_a2,
    format('global_claimed=%s', v_global_id);

  SELECT claim_token INTO v_claim_token
  FROM accounting_snapshot_refresh_jobs WHERE id = v_global_id;
  PERFORM complete_accounting_snapshot_refresh_job(v_global_id, v_claim_token);

  -- Restore other fixtures to claimable pending for later assertions
  UPDATE accounting_snapshot_refresh_jobs
  SET next_run_at = NOW() - INTERVAL '1 second'
  WHERE business_id IN (v_biz_a, v_biz_b)
    AND status = 'pending';

  -- 8. Two journals / enqueues in same period coalesce safely
  v_job_a := enqueue_accounting_snapshot_refresh_job(
    v_biz_a, v_period_start, v_period_end, 'both', 'coalesce_1', NULL, NULL
  );
  v_job_a2 := enqueue_accounting_snapshot_refresh_job(
    v_biz_a, v_period_start, v_period_end, 'both', 'coalesce_2', NULL, NULL
  );
  SELECT COUNT(*)::INT INTO v_count
  FROM accounting_snapshot_refresh_jobs
  WHERE business_id = v_biz_a
    AND period_start = v_period_start
    AND period_end = v_period_end
    AND job_type = 'both'
    AND status = 'pending';

  RETURN QUERY SELECT 'same_period_coalesce_safe'::TEXT,
    v_count = 1 AND v_job_a = v_job_a2,
    format('pending=%s id1=%s id2=%s', v_count, v_job_a, v_job_a2);

  -- 9. Journal/enqueue while processing creates or preserves follow-up
  SELECT id, claim_token INTO v_claim_id, v_claim_token
  FROM claim_accounting_snapshot_refresh_jobs_for_period(
    v_biz_a, v_period_start, v_period_end, 1, 900
  )
  LIMIT 1;

  v_job_a2 := enqueue_accounting_snapshot_refresh_job(
    v_biz_a, v_period_start, v_period_end, 'both', 'follow_up_while_processing', NULL, NULL
  );

  SELECT COUNT(*)::INT INTO v_count
  FROM accounting_snapshot_refresh_jobs
  WHERE business_id = v_biz_a
    AND period_start = v_period_start
    AND period_end = v_period_end
    AND job_type = 'both'
    AND status = 'pending';

  RETURN QUERY SELECT 'follow_up_while_processing'::TEXT,
    v_count = 1 AND v_job_a2 IS NOT NULL,
    format('pending=%s follow=%s', v_count, v_job_a2);

  PERFORM complete_accounting_snapshot_refresh_job(v_claim_id, v_claim_token);

  -- Follow-up still claimable by scoped worker
  SELECT id INTO v_claim_id2
  FROM claim_accounting_snapshot_refresh_jobs_for_period(
    v_biz_a, v_period_start, v_period_end, 1, 900
  )
  LIMIT 1;

  RETURN QUERY SELECT 'follow_up_claimable_after_complete'::TEXT,
    v_claim_id2 = v_job_a2,
    format('claimed=%s expected=%s', v_claim_id2, v_job_a2);

  SELECT claim_token INTO v_claim_token2
  FROM accounting_snapshot_refresh_jobs WHERE id = v_claim_id2;
  PERFORM complete_accounting_snapshot_refresh_job(v_claim_id2, v_claim_token2);

  -- 10. Cross-tenant jobs remain untouched (claim empty for wrong biz)
  SELECT COUNT(*)::INT INTO v_count
  FROM claim_accounting_snapshot_refresh_jobs_for_period(
    v_biz_a, v_period_start, v_period_end, 10, 900
  )
  WHERE business_id <> v_biz_a;

  SELECT status INTO v_status FROM accounting_snapshot_refresh_jobs WHERE id = v_job_b;

  RETURN QUERY SELECT 'cross_tenant_jobs_untouched'::TEXT,
    v_count = 0 AND v_status = 'pending',
    format('wrong_tenant_claims=%s biz_b_status=%s', v_count, v_status);

  -- job_type preserved: pnl-only claim returns pnl job_type
  v_job_pnl := enqueue_accounting_snapshot_refresh_job(
    v_biz_a, v_period_start, v_period_end, 'pnl', 'pnl_only', NULL, NULL
  );
  SELECT id, job_type, claim_token INTO v_claim_id, v_job_type, v_claim_token
  FROM claim_accounting_snapshot_refresh_jobs_for_period(
    v_biz_a, v_period_start, v_period_end, 5, 900
  )
  WHERE id = v_job_pnl
  LIMIT 1;

  RETURN QUERY SELECT 'job_type_pnl_preserved'::TEXT,
    v_claim_id = v_job_pnl AND v_job_type = 'pnl',
    format('id=%s type=%s', v_claim_id, v_job_type);

  IF v_claim_id IS NOT NULL THEN
    PERFORM complete_accounting_snapshot_refresh_job(v_claim_id, v_claim_token);
  END IF;

  -- Empty scoped claim exits with zero rows when nothing pending
  SELECT COUNT(*)::INT INTO v_count
  FROM claim_accounting_snapshot_refresh_jobs_for_period(
    v_biz_a, v_period_start, v_period_end, 5, 900
  );

  RETURN QUERY SELECT 'empty_scoped_claim_returns_zero'::TEXT,
    v_count = 0,
    format('claimed=%s', v_count);

  -- Cleanup
  UPDATE accounting_snapshot_refresh_jobs
  SET status = 'done', locked_at = NULL, claim_token = NULL, updated_at = NOW(),
      completed_at = COALESCE(completed_at, NOW())
  WHERE business_id IN (v_biz_a, v_biz_b)
    AND status IN ('pending', 'processing', 'failed');
  DELETE FROM accounting_snapshot_refresh_jobs WHERE business_id IN (v_biz_a, v_biz_b);
  UPDATE businesses
  SET archived_at = NOW(),
      name = LEFT('ZZZ scoped-claim-test archived ' || id::text, 200)
  WHERE id IN (v_biz_a, v_biz_b);

  RETURN QUERY SELECT 'cleanup'::TEXT, TRUE, 'archived_synthetic_businesses'::TEXT;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    UPDATE accounting_snapshot_refresh_jobs
    SET status = 'done', locked_at = NULL, claim_token = NULL, updated_at = NOW()
    WHERE business_id IN (v_biz_a, v_biz_b)
      AND status IN ('pending', 'processing', 'failed');
    DELETE FROM accounting_snapshot_refresh_jobs WHERE business_id IN (v_biz_a, v_biz_b);
    UPDATE businesses
    SET archived_at = COALESCE(archived_at, NOW()),
        name = LEFT('ZZZ scoped-claim-test archived ' || id::text, 200)
    WHERE id IN (v_biz_a, v_biz_b);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN QUERY SELECT 'exception'::TEXT, FALSE, SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.test_claim_accounting_snapshot_refresh_jobs_for_period() IS
  'SQL regression suite for scoped snapshot claim (545).';

REVOKE ALL ON FUNCTION public.test_claim_accounting_snapshot_refresh_jobs_for_period() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_claim_accounting_snapshot_refresh_jobs_for_period() TO service_role;
