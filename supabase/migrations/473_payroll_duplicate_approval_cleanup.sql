-- ============================================================================
-- Migration 473: Global payroll approval journal duplicate report + cleanup + audit
-- ============================================================================
-- Problem: Concurrent/double approval could create multiple unreversed journal_entries
-- with reference_type = payroll and the same reference_id (payroll_run_id).
--
-- Active payroll journal definition:
--   A row is "superseded" if EXISTS (SELECT 1 FROM journal_entries r
--     WHERE r.reverses_entry_id = journal_entries.id).
--   Duplicate groups count only non-superseded journals.
--
-- Does NOT delete rows. Reverses duplicates via post_journal_entry (reversal).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_journal_duplicate_cleanup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  kept_journal_entry_id UUID REFERENCES public.journal_entries(id),
  reversed_journal_entry_id UUID REFERENCES public.journal_entries(id),
  action TEXT NOT NULL,
  reason TEXT,
  before_payload JSONB,
  after_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_dup_cleanup_log_business
  ON public.payroll_journal_duplicate_cleanup_log(business_id);
CREATE INDEX IF NOT EXISTS idx_payroll_dup_cleanup_log_run
  ON public.payroll_journal_duplicate_cleanup_log(payroll_run_id);

COMMENT ON TABLE public.payroll_journal_duplicate_cleanup_log IS
  'Audit trail for automated duplicate payroll approval journal cleanup (473).';

ALTER TABLE public.payroll_journal_duplicate_cleanup_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payroll_dup_cleanup_log: business members select"
  ON public.payroll_journal_duplicate_cleanup_log;
CREATE POLICY "payroll_dup_cleanup_log: business members select"
  ON public.payroll_journal_duplicate_cleanup_log FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

-- ---------------------------------------------------------------------------
-- Manual review queue (ambiguous groups that were not auto-cleaned)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_journal_duplicate_manual_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_dup_manual_review_business
  ON public.payroll_journal_duplicate_manual_review(business_id);

ALTER TABLE public.payroll_journal_duplicate_manual_review ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payroll_dup_manual_review: business members select"
  ON public.payroll_journal_duplicate_manual_review;
CREATE POLICY "payroll_dup_manual_review: business members select"
  ON public.payroll_journal_duplicate_manual_review FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

-- ---------------------------------------------------------------------------
-- Helper: journal is superseded by a reversal row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_journal_entry_is_superseded(p_journal_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.journal_entries r
    WHERE r.reverses_entry_id = p_journal_id
  );
$$;

COMMENT ON FUNCTION public.payroll_journal_entry_is_superseded(UUID) IS
  'True if another journal_entry exists with reverses_entry_id pointing at this entry.';

-- ---------------------------------------------------------------------------
-- Report view: one row per payroll approval journal in a duplicate (active) group
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_payroll_duplicate_approval_journals_report AS
WITH active_payroll_journals AS (
  SELECT je.*
  FROM public.journal_entries je
  WHERE je.reference_type = 'payroll'
    AND je.reference_id IS NOT NULL
    AND NOT public.payroll_journal_entry_is_superseded(je.id)
),
dup_groups AS (
  SELECT apj.business_id, apj.reference_id AS payroll_run_id
  FROM active_payroll_journals apj
  GROUP BY apj.business_id, apj.reference_id
  HAVING COUNT(*) > 1
),
line_agg AS (
  SELECT
    jel.journal_entry_id,
    SUM(jel.debit) AS debit_total,
    SUM(jel.credit) AS credit_total,
    SUM(CASE WHEN a.code = '5600' THEN jel.debit ELSE 0 END) AS dr_5600,
    SUM(CASE WHEN a.code = '5610' THEN jel.debit ELSE 0 END) AS dr_5610,
    SUM(CASE WHEN a.code = '2230' THEN jel.credit ELSE 0 END) AS cr_2230,
    SUM(CASE WHEN a.code = '2231' THEN jel.credit ELSE 0 END) AS cr_2231,
    SUM(CASE WHEN a.code = '2232' THEN jel.credit ELSE 0 END) AS cr_2232,
    SUM(CASE WHEN a.code = '2240' THEN jel.credit ELSE 0 END) AS cr_2240,
    SUM(CASE WHEN a.code = '2241' THEN jel.credit ELSE 0 END) AS cr_2241_credit,
    SUM(CASE WHEN a.code = '2241' THEN jel.debit ELSE 0 END) AS dr_2241,
    SUM(CASE WHEN a.code = '1110' THEN jel.credit ELSE 0 END) AS cr_1110
  FROM public.journal_entry_lines jel
  INNER JOIN public.accounts a ON a.id = jel.account_id
  GROUP BY jel.journal_entry_id
)
SELECT
  dg.business_id,
  dg.payroll_run_id,
  pr.payroll_month,
  pr.status AS payroll_run_status,
  pr.journal_entry_id AS payroll_run_linked_journal_id,
  je.id AS journal_entry_id,
  je.created_at AS journal_created_at,
  je.description AS journal_description,
  la.debit_total,
  la.credit_total,
  (ABS(COALESCE(la.debit_total, 0) - COALESCE(la.credit_total, 0)) <= 0.02) AS balanced,
  (COALESCE(la.dr_5600, 0) > 0.01) AS has_gross_payroll_expense_5600,
  (COALESCE(la.dr_5610, 0) > 0.01) AS has_employer_pension_expense_5610,
  (COALESCE(la.cr_2230, 0) > 0.01 OR EXISTS (
    SELECT 1 FROM public.journal_entry_lines jel2
    INNER JOIN public.accounts a2 ON a2.id = jel2.account_id
    WHERE jel2.journal_entry_id = je.id AND a2.code = '2230'
  )) AS has_paye_line_2230,
  (COALESCE(la.cr_2231, 0) > 0.01) AS has_pension_line_2231,
  (COALESCE(la.cr_2232, 0) > 0.01) AS has_tier2_line_2232,
  (COALESCE(la.cr_2240, 0) > 0.01) AS has_net_salary_line_2240,
  (COALESCE(la.cr_2241_credit, 0) > 0.01) AS has_employee_deductions_line_2241_credit,
  (
    COALESCE(la.dr_2241, 0) > 0.01
    AND COALESCE(la.cr_1110, 0) > 0.01
    AND ABS(COALESCE(la.dr_2241, 0) - COALESCE(la.cr_1110, 0)) <= 0.02
  ) AS has_salary_advance_clearing_dr2241_cr1110,
  (pr.journal_entry_id = je.id) AS is_currently_linked_to_payroll_run,
  (
    SELECT COALESCE(SUM(sar.amount), 0)
    FROM public.salary_advance_repayments sar
    WHERE sar.payroll_run_id = dg.payroll_run_id
      AND sar.business_id = dg.business_id
      AND sar.status IN ('pending', 'posted')
  ) AS salary_advance_repayment_total_for_run
FROM dup_groups dg
INNER JOIN active_payroll_journals je
  ON je.business_id = dg.business_id
 AND je.reference_id = dg.payroll_run_id
INNER JOIN public.payroll_runs pr
  ON pr.id = dg.payroll_run_id
 AND pr.business_id = dg.business_id
LEFT JOIN line_agg la ON la.journal_entry_id = je.id;

COMMENT ON VIEW public.v_payroll_duplicate_approval_journals_report IS
  'Rows for each active payroll journal where more than one unreversed payroll journal exists for the same run.';

-- ---------------------------------------------------------------------------
-- Reverse one journal (idempotent): uses post_journal_entry reversal contract
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_reverse_duplicate_payroll_journal(
  p_journal_entry_id UUID,
  p_reason TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orig RECORD;
  v_lines JSONB;
  v_new_id UUID;
  v_existing_rev UUID;
BEGIN
  SELECT id INTO v_existing_rev
  FROM public.journal_entries r
  WHERE r.reverses_entry_id = p_journal_entry_id
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_existing_rev IS NOT NULL THEN
    RETURN v_existing_rev;
  END IF;

  SELECT je.id, je.business_id, je.date, je.reference_type
  INTO v_orig
  FROM public.journal_entries je
  WHERE je.id = p_journal_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found: %', p_journal_entry_id;
  END IF;

  IF v_orig.reference_type <> 'payroll' THEN
    RAISE EXCEPTION 'finza_reverse_duplicate_payroll_journal only supports payroll journals';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'account_id', jel.account_id,
        'debit', jel.credit,
        'credit', jel.debit,
        'description', COALESCE(jel.description, '')
      )
      ORDER BY jel.id
    ),
    '[]'::jsonb
  )
  INTO v_lines
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = p_journal_entry_id;

  IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Journal entry has no lines: %', p_journal_entry_id;
  END IF;

  SELECT public.post_journal_entry(
    v_orig.business_id,
    v_orig.date,
    'Reversal: duplicate payroll approval journal',
    'reversal',
    p_journal_entry_id,
    v_lines,
    TRUE,
    COALESCE(NULLIF(TRIM(p_reason), ''), 'Duplicate payroll approval cleanup'),
    'payroll_duplicate_cleanup',
    NULL,
    NULL,
    NULL,
    NULL,
    'system',
    FALSE,
    p_journal_entry_id
  )
  INTO v_new_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.finza_reverse_duplicate_payroll_journal(UUID, TEXT) IS
  'SECURITY DEFINER: posts balancing reversal via post_journal_entry; idempotent if reversal exists.';

REVOKE ALL ON FUNCTION public.finza_reverse_duplicate_payroll_journal(UUID, TEXT) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Cleanup procedure (invoked once at end of migration)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_cleanup_payroll_duplicate_approval_journals()
RETURNS TABLE (
  duplicate_groups_found INT,
  auto_cleaned_reversals INT,
  manual_review_inserted INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_groups INT := 0;
  v_reversed INT := 0;
  v_manual INT := 0;
  r_group RECORD;
  v_run RECORD;
  v_journal_ids UUID[];
  v_j UUID;
  v_kept UUID;
  v_sum_dr NUMERIC;
  v_sum_cr NUMERIC;
  v_balanced BOOLEAN;
  v_dev NUMERIC;
  v_best_dev NUMERIC;
  v_best_ids UUID[];
  v_dr_5600 NUMERIC;
  v_dr_5610 NUMERIC;
  v_cr_2230 NUMERIC;
  v_cr_2231 NUMERIC;
  v_cr_2232 NUMERIC;
  v_cr_2240 NUMERIC;
  v_cr_2241 NUMERIC;
  v_dr_2241 NUMERIC;
  v_cr_1110 NUMERIC;
  v_adv_expect NUMERIC;
  v_pension_expect NUMERIC;
  v_has_clearing BOOLEAN;
  v_rev UUID;
  v_distinct_footprints INT;
  v_group_failed BOOLEAN;
BEGIN
  FOR r_group IN
    SELECT apj.business_id, apj.reference_id AS payroll_run_id
    FROM (
      SELECT je.business_id, je.reference_id
      FROM public.journal_entries je
      WHERE je.reference_type = 'payroll'
        AND je.reference_id IS NOT NULL
        AND NOT public.payroll_journal_entry_is_superseded(je.id)
    ) apj
    GROUP BY apj.business_id, apj.reference_id
    HAVING COUNT(*) > 1
  LOOP
    v_groups := v_groups + 1;

    SELECT *
    INTO v_run
    FROM public.payroll_runs pr
    WHERE pr.id = r_group.payroll_run_id
      AND pr.business_id = r_group.business_id;

    IF NOT FOUND THEN
      INSERT INTO public.payroll_journal_duplicate_manual_review (
        business_id, payroll_run_id, reason, detail
      ) VALUES (
        r_group.business_id,
        r_group.payroll_run_id,
        'payroll_run_missing',
        jsonb_build_object('note', 'payroll_run row not found for duplicate group')
      );
      v_manual := v_manual + 1;
      CONTINUE;
    END IF;

    SELECT ARRAY_AGG(je.id ORDER BY je.created_at)
    INTO v_journal_ids
    FROM public.journal_entries je
    WHERE je.business_id = r_group.business_id
      AND je.reference_type = 'payroll'
      AND je.reference_id = r_group.payroll_run_id
      AND NOT public.payroll_journal_entry_is_superseded(je.id);

    v_adv_expect := (
      SELECT COALESCE(SUM(sar.amount), 0)
      FROM public.salary_advance_repayments sar
      WHERE sar.payroll_run_id = r_group.payroll_run_id
        AND sar.business_id = r_group.business_id
        AND sar.status IN ('pending', 'posted')
    );

    v_pension_expect :=
      ROUND(COALESCE(v_run.total_ssnit_employee, 0) + COALESCE(v_run.total_ssnit_employer, 0), 2);

    v_kept := NULL;
    v_best_dev := NULL;
    v_best_ids := ARRAY[]::UUID[];

    FOREACH v_j IN ARRAY v_journal_ids
    LOOP
      SELECT
        SUM(jel.debit),
        SUM(jel.credit)
      INTO v_sum_dr, v_sum_cr
      FROM public.journal_entry_lines jel
      WHERE jel.journal_entry_id = v_j;

      v_balanced := ABS(COALESCE(v_sum_dr, 0) - COALESCE(v_sum_cr, 0)) <= 0.02;

      SELECT
        SUM(CASE WHEN a.code = '5600' THEN jel.debit ELSE 0 END),
        SUM(CASE WHEN a.code = '5610' THEN jel.debit ELSE 0 END),
        SUM(CASE WHEN a.code = '2230' THEN jel.credit ELSE 0 END),
        SUM(CASE WHEN a.code = '2231' THEN jel.credit ELSE 0 END),
        SUM(CASE WHEN a.code = '2232' THEN jel.credit ELSE 0 END),
        SUM(CASE WHEN a.code = '2240' THEN jel.credit ELSE 0 END),
        SUM(CASE WHEN a.code = '2241' THEN jel.credit ELSE 0 END),
        SUM(CASE WHEN a.code = '2241' THEN jel.debit ELSE 0 END),
        SUM(CASE WHEN a.code = '1110' THEN jel.credit ELSE 0 END)
      INTO v_dr_5600, v_dr_5610, v_cr_2230, v_cr_2231, v_cr_2232, v_cr_2240, v_cr_2241, v_dr_2241, v_cr_1110
      FROM public.journal_entry_lines jel
      INNER JOIN public.accounts a ON a.id = jel.account_id
      WHERE jel.journal_entry_id = v_j;

      v_has_clearing :=
        COALESCE(v_dr_2241, 0) > 0.01
        AND COALESCE(v_cr_1110, 0) > 0.01
        AND ABS(COALESCE(v_dr_2241, 0) - COALESCE(v_cr_1110, 0)) <= 0.02;

      IF NOT v_balanced THEN
        v_dev := 1000000;
      ELSE
        v_dev :=
          ABS(COALESCE(v_dr_5600, 0) - COALESCE(v_run.total_gross_salary, 0))
          + ABS(COALESCE(v_dr_5610, 0) - COALESCE(v_run.total_ssnit_employer, 0))
          + ABS(COALESCE(v_cr_2230, 0) - COALESCE(v_run.total_paye, 0))
          + ABS(COALESCE(v_cr_2240, 0) - COALESCE(v_run.total_net_salary, 0))
          + ABS(COALESCE(v_cr_2241, 0) - COALESCE(v_run.total_deductions, 0));

        IF v_pension_expect > 0.01 THEN
          v_dev := v_dev + ABS(
            COALESCE(v_cr_2231, 0) + COALESCE(v_cr_2232, 0) - v_pension_expect
          );
        END IF;

        IF v_adv_expect > 0.01 AND NOT v_has_clearing THEN
          v_dev := v_dev + LEAST(500000::NUMERIC, 500 + COALESCE(v_adv_expect, 0));
        END IF;
      END IF;

      IF v_best_dev IS NULL OR v_dev < v_best_dev - 0.0001 THEN
        v_best_dev := v_dev;
        v_best_ids := ARRAY[v_j];
      ELSIF ABS(v_dev - v_best_dev) <= 0.0001 THEN
        v_best_ids := array_append(v_best_ids, v_j);
      END IF;
    END LOOP;

    IF v_best_dev IS NULL OR v_best_dev > 0.15 THEN
      INSERT INTO public.payroll_journal_duplicate_manual_review (
        business_id, payroll_run_id, reason, detail
      ) VALUES (
        r_group.business_id,
        r_group.payroll_run_id,
        'amount_mismatch_or_unbalanced_or_missing_lines',
        jsonb_build_object(
          'best_deviation', v_best_dev,
          'candidate_ids', v_journal_ids,
          'journal_entry_id_on_run', v_run.journal_entry_id,
          'run_status', v_run.status
        )
      );
      v_manual := v_manual + 1;
      CONTINUE;
    END IF;

    IF array_length(v_best_ids, 1) > 1 THEN
      SELECT COUNT(*) INTO v_distinct_footprints
      FROM (
        SELECT DISTINCT
          ROUND(SUM(jel.debit)::NUMERIC, 2) AS sdr,
          ROUND(SUM(jel.credit)::NUMERIC, 2) AS scr
        FROM public.journal_entry_lines jel
        WHERE jel.journal_entry_id = ANY (v_best_ids)
        GROUP BY jel.journal_entry_id
      ) d;

      IF v_distinct_footprints > 1 THEN
        INSERT INTO public.payroll_journal_duplicate_manual_review (
          business_id, payroll_run_id, reason, detail
        ) VALUES (
          r_group.business_id,
          r_group.payroll_run_id,
          'multiple_possible_winners',
          jsonb_build_object('tied_ids', v_best_ids, 'best_deviation', v_best_dev)
        );
        v_manual := v_manual + 1;
        CONTINUE;
      END IF;
    END IF;

    v_kept := NULL;
    IF v_run.journal_entry_id IS NOT NULL
      AND v_run.journal_entry_id = ANY (v_best_ids)
      AND EXISTS (
        SELECT 1
        FROM public.journal_entries je
        WHERE je.id = v_run.journal_entry_id
          AND NOT public.payroll_journal_entry_is_superseded(je.id)
      )
    THEN
      v_kept := v_run.journal_entry_id;
    ELSE
      SELECT je.id INTO v_kept
      FROM public.journal_entries je
      WHERE je.id = ANY (v_best_ids)
      ORDER BY je.created_at ASC
      LIMIT 1;
    END IF;

    IF v_kept IS NULL THEN
      INSERT INTO public.payroll_journal_duplicate_manual_review (
        business_id, payroll_run_id, reason, detail
      ) VALUES (
        r_group.business_id,
        r_group.payroll_run_id,
        'could_not_select_winner',
        jsonb_build_object('best_ids', v_best_ids)
      );
      v_manual := v_manual + 1;
      CONTINUE;
    END IF;

    IF v_adv_expect > 0.01 THEN
      SELECT
        COALESCE(SUM(CASE WHEN a.code = '2241' THEN jel.debit ELSE 0 END), 0) > 0.01
        AND COALESCE(SUM(CASE WHEN a.code = '1110' THEN jel.credit ELSE 0 END), 0) > 0.01
      INTO v_has_clearing
      FROM public.journal_entry_lines jel
      INNER JOIN public.accounts a ON a.id = jel.account_id
      WHERE jel.journal_entry_id = v_kept;

      IF NOT v_has_clearing THEN
        INSERT INTO public.payroll_journal_duplicate_manual_review (
          business_id, payroll_run_id, reason, detail
        ) VALUES (
          r_group.business_id,
          r_group.payroll_run_id,
          'salary_advance_mismatch',
          jsonb_build_object(
            'kept_journal', v_kept,
            'advance_expected', v_adv_expect
          )
        );
        v_manual := v_manual + 1;
        CONTINUE;
      END IF;
    END IF;

    IF v_run.status NOT IN ('approved', 'locked') THEN
      INSERT INTO public.payroll_journal_duplicate_manual_review (
        business_id, payroll_run_id, reason, detail
      ) VALUES (
        r_group.business_id,
        r_group.payroll_run_id,
        'payroll_run_not_approved_or_locked',
        jsonb_build_object('status', v_run.status, 'would_keep', v_kept)
      );
      v_manual := v_manual + 1;
      CONTINUE;
    END IF;

    v_group_failed := false;

    FOREACH v_j IN ARRAY v_journal_ids
    LOOP
      IF v_j = v_kept THEN
        CONTINUE;
      END IF;

      BEGIN
        SELECT public.finza_reverse_duplicate_payroll_journal(
          v_j,
          'Automated duplicate payroll approval cleanup (migration 473)'
        ) INTO v_rev;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.payroll_journal_duplicate_manual_review (
          business_id, payroll_run_id, reason, detail
        ) VALUES (
          r_group.business_id,
          r_group.payroll_run_id,
          'reversal_failed',
          jsonb_build_object(
            'journal_id', v_j,
            'error', SQLERRM
          )
        );
        v_manual := v_manual + 1;
        v_group_failed := true;
        EXIT;
      END;

      v_reversed := v_reversed + 1;

      INSERT INTO public.payroll_journal_duplicate_cleanup_log (
        business_id,
        payroll_run_id,
        kept_journal_entry_id,
        reversed_journal_entry_id,
        action,
        reason,
        before_payload,
        after_payload
      ) VALUES (
        r_group.business_id,
        r_group.payroll_run_id,
        v_kept,
        v_j,
        'reversed_duplicate',
        'duplicate payroll approval journal reversed',
        jsonb_build_object('reversal_journal_id', v_rev),
        jsonb_build_object('original_journal_id', v_j)
      );
    END LOOP;

    IF v_group_failed THEN
      CONTINUE;
    END IF;

    UPDATE public.salary_advance_repayments sar
    SET journal_entry_id = v_kept
    WHERE sar.payroll_run_id = r_group.payroll_run_id
      AND sar.business_id = r_group.business_id
      AND sar.journal_entry_id IS NOT NULL
      AND sar.journal_entry_id <> v_kept
      AND sar.journal_entry_id = ANY (v_journal_ids);

    UPDATE public.payroll_runs pr
    SET journal_entry_id = v_kept
    WHERE pr.id = r_group.payroll_run_id
      AND pr.business_id = r_group.business_id
      AND (pr.journal_entry_id IS DISTINCT FROM v_kept);

    INSERT INTO public.payroll_journal_duplicate_cleanup_log (
      business_id,
      payroll_run_id,
      kept_journal_entry_id,
      reversed_journal_entry_id,
      action,
      reason,
      before_payload,
      after_payload
    ) VALUES (
      r_group.business_id,
      r_group.payroll_run_id,
      v_kept,
      NULL,
      'selected_kept_journal',
      'lowest_deviation_vs_payroll_run_totals',
      jsonb_build_object('candidates', v_journal_ids),
      jsonb_build_object('kept', v_kept)
    );
  END LOOP;

  duplicate_groups_found := v_groups;
  auto_cleaned_reversals := v_reversed;
  manual_review_inserted := v_manual;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.finza_cleanup_payroll_duplicate_approval_journals() IS
  'One-shot SECURITY DEFINER cleanup; prefer deviation-from-payroll_run totals; reverses losers via post_journal_entry.';

REVOKE ALL ON FUNCTION public.finza_cleanup_payroll_duplicate_approval_journals() FROM PUBLIC;

-- Run cleanup once (safe when no duplicates)
DO $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM public.finza_cleanup_payroll_duplicate_approval_journals();
  RAISE NOTICE 'payroll duplicate cleanup: groups=%, reversed=%, manual=%',
    r.duplicate_groups_found, r.auto_cleaned_reversals, r.manual_review_inserted;
END;
$$;

-- Part G — verification SQL (use in SQL editor; active = not superseded by a reversal row)
-- 1) Duplicate active payroll approval journals:
-- SELECT je.business_id, je.reference_id AS payroll_run_id, COUNT(*) AS n
-- FROM public.journal_entries je
-- WHERE je.reference_type = 'payroll'
--   AND NOT EXISTS (SELECT 1 FROM public.journal_entries r WHERE r.reverses_entry_id = je.id)
-- GROUP BY je.business_id, je.reference_id
-- HAVING COUNT(*) > 1;
--
-- 2) Approved/locked runs without a valid linked payroll journal:
-- SELECT pr.id, pr.business_id, pr.payroll_month, pr.status, pr.journal_entry_id
-- FROM public.payroll_runs pr
-- LEFT JOIN public.journal_entries je ON je.id = pr.journal_entry_id
-- WHERE pr.status IN ('approved', 'locked')
--   AND (
--     pr.journal_entry_id IS NULL OR je.id IS NULL OR je.reference_type <> 'payroll'
--     OR je.reference_id <> pr.id
--     OR EXISTS (SELECT 1 FROM public.journal_entries r WHERE r.reverses_entry_id = je.id)
--   );
--
-- 3) Cleanup log summary:
-- SELECT action, COUNT(*) FROM public.payroll_journal_duplicate_cleanup_log GROUP BY action;
