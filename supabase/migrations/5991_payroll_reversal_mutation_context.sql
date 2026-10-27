-- ============================================================================
-- 5991_payroll_reversal_mutation_context.sql
--
-- P0 repair: make payroll reversal work with the 562 obligation-integrity
-- trigger, without weakening paid-amount protection.
--
-- Root cause:
--   * 557 reverse_payroll_run_atomic() updates salary_net payroll_obligations
--     status to 'reversed' before any mutation context is set.
--   * 562 payroll_obligations_enforce_authoritative_paid() only permits
--     salary_net status changes when the transaction-local context is
--     'payment_settle', so the reversal aborts with
--     PAYROLL_PAYMENT_OBLIGATION_MISMATCH.
--   * 562 also intended to inject finza_set_payroll_mutation_context('reverse')
--     before the payroll_runs status update, but that text patch did not apply
--     to the deployed function (CRLF/whitespace anchor mismatch). The run
--     trigger requires 'reverse' for approved/locked -> reversed.
--   * create_payroll_correction_draft_from_reversed() likewise lacks the
--     'correction_link' context required by the run trigger when it links the
--     correction draft back to the reversed run.
--
-- Fix:
--   * Refine the obligation trigger: paid amounts and payment metadata remain
--     protected by 'payment_settle'; STATUS changes are additionally allowed
--     under the reversal context, and only to 'reversed'.
--   * Inject the canonical 'reverse' context immediately before the obligation
--     update in reverse_payroll_run_atomic(). It remains active through the
--     run status update.
--   * Inject the 'correction_link' context immediately before the correction
--     draft call, which is internal-only and called only from this RPC.
--
-- No data changes. No trigger disabled. No new RPC overload. No CASCADE.
-- The correction is idempotent and verifies its own anchors/postconditions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Refine salary_net obligation protection.
--    - amount_paid / latest payment / payment account: payment_settle only.
--    - status: payment_settle, or reversal context with NEW.status='reversed'.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_obligations_enforce_authoritative_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx TEXT := COALESCE(public.finza_payroll_mutation_context(), '');
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.obligation_type IS DISTINCT FROM 'salary_net' THEN
    RETURN NEW;
  END IF;

  -- Paid amounts and payment attribution remain owned by the payment RPC.
  IF (
    NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
    OR NEW.latest_payment_date IS DISTINCT FROM OLD.latest_payment_date
    OR NEW.latest_payment_reference IS DISTINCT FROM OLD.latest_payment_reference
    OR NEW.payment_account_id IS DISTINCT FROM OLD.payment_account_id
  ) AND v_ctx IS DISTINCT FROM 'payment_settle' THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_OBLIGATION_MISMATCH',
      'salary_net obligation paid amounts must be updated by record_payroll_payment_atomic'
    );
  END IF;

  -- Status may be settled by the payment RPC, or reversed by the reversal RPC.
  -- The reversal context may only move the status to 'reversed'.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       v_ctx = 'payment_settle'
       OR (v_ctx = 'reverse' AND NEW.status = 'reversed')
     ) THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_OBLIGATION_MISMATCH',
      'salary_net obligation status must be changed by an approved payroll RPC'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2) Inject the missing mutation contexts into the deployed reversal RPC.
--    We patch the current definition rather than replacing it with a stale
--    copy, preserving any later fixes to the function body.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_def TEXT;
  v_ob_pos INT;
  v_rev_pos INT;
  v_corr_pos INT;
  v_ctx_pos INT;
BEGIN
  SELECT pg_get_functiondef(
    'public.reverse_payroll_run_atomic(uuid,uuid,date,text,boolean)'::regprocedure
  ) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION '5991 precondition failed: reverse_payroll_run_atomic is missing';
  END IF;

  v_ob_pos := POSITION('UPDATE public.payroll_obligations' IN v_def);
  IF v_ob_pos = 0 THEN
    RAISE EXCEPTION '5991 precondition failed: reversal obligation update anchor not found';
  END IF;

  -- Ensure 'reverse' is set BEFORE the obligation update. It may already be
  -- present later in the body (e.g. before the run update) but that is too late
  -- for the obligation trigger.
  v_rev_pos := POSITION('finza_set_payroll_mutation_context(''reverse'')' IN v_def);
  IF v_rev_pos = 0 OR v_rev_pos > v_ob_pos THEN
    v_def := replace(
      v_def,
      'UPDATE public.payroll_obligations',
      'PERFORM public.finza_set_payroll_mutation_context(''reverse'');' || chr(10) ||
      '  UPDATE public.payroll_obligations'
    );
  END IF;

  -- Ensure 'correction_link' is set before the correction draft call.
  v_corr_pos := POSITION('v_correction_run_id :=' IN v_def);
  IF v_corr_pos = 0 THEN
    RAISE EXCEPTION '5991 precondition failed: correction draft anchor not found';
  END IF;

  v_ctx_pos := POSITION('finza_set_payroll_mutation_context(''correction_link'')' IN v_def);
  IF v_ctx_pos = 0 OR v_ctx_pos > v_corr_pos THEN
    v_def := replace(
      v_def,
      'v_correction_run_id :=',
      'PERFORM public.finza_set_payroll_mutation_context(''correction_link'');' || chr(10) ||
      '      v_correction_run_id :='
    );
  END IF;

  -- Verify both injections landed before executing the replacement.
  IF POSITION('finza_set_payroll_mutation_context(''reverse'')' IN v_def) = 0
     OR POSITION('finza_set_payroll_mutation_context(''reverse'')' IN v_def)
        > POSITION('UPDATE public.payroll_obligations' IN v_def) THEN
    RAISE EXCEPTION '5991: failed to inject reverse context before obligation update';
  END IF;

  IF POSITION('finza_set_payroll_mutation_context(''correction_link'')' IN v_def) = 0
     OR POSITION('finza_set_payroll_mutation_context(''correction_link'')' IN v_def)
        > POSITION('v_correction_run_id :=' IN v_def) THEN
    RAISE EXCEPTION '5991: failed to inject correction_link context';
  END IF;

  EXECUTE v_def;
END $$;

-- ----------------------------------------------------------------------------
-- 3) Postconditions: trigger function, contexts, security, grants, trigger.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_rev_def TEXT;
  v_trg_def TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.reverse_payroll_run_atomic(uuid,uuid,date,text,boolean)'::regprocedure
  ) INTO v_rev_def;

  IF POSITION('finza_set_payroll_mutation_context(''reverse'')' IN v_rev_def) = 0 THEN
    RAISE EXCEPTION '5991 postcondition failed: reverse context missing';
  END IF;
  IF POSITION('finza_set_payroll_mutation_context(''correction_link'')' IN v_rev_def) = 0 THEN
    RAISE EXCEPTION '5991 postcondition failed: correction_link context missing';
  END IF;

  SELECT pg_get_functiondef(
    'public.payroll_obligations_enforce_authoritative_paid()'::regprocedure
  ) INTO v_trg_def;

  IF POSITION('v_ctx = ''reverse''' IN v_trg_def) = 0 THEN
    RAISE EXCEPTION '5991 postcondition failed: obligation trigger does not allow reverse context';
  END IF;
  IF POSITION('must be updated by record_payroll_payment_atomic' IN v_trg_def) = 0 THEN
    RAISE EXCEPTION '5991 postcondition failed: paid-amount protection message missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'public.reverse_payroll_run_atomic(uuid,uuid,date,text,boolean)'::regprocedure
      AND p.prosecdef
      AND 'search_path=public' = ANY (p.proconfig)
  ) THEN
    RAISE EXCEPTION '5991 postcondition failed: reversal RPC security posture changed';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.reverse_payroll_run_atomic(uuid,uuid,date,text,boolean)'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION '5991 postcondition failed: authenticated EXECUTE grant lost';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_payroll_obligations_enforce_authoritative_paid'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '5991 postcondition failed: obligation integrity trigger missing';
  END IF;

  RAISE NOTICE '5991: payroll reversal mutation contexts installed';
END $$;
