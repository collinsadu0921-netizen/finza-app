-- ============================================================================
-- Migration 607: Keep provisional SSNIT snapshot fields immutable after draft
--
-- Migration 606 added run-level provisional SSNIT snapshot and acknowledgement
-- fields. The existing payroll-run immutability trigger's notes-only comparison
-- must include them so approved/locked/reversed runs cannot be mutated through
-- the notes escape hatch.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payroll_runs_enforce_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx TEXT := public.finza_payroll_mutation_context();
  v_notes_only BOOLEAN;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  v_notes_only := (
    NEW.business_id IS NOT DISTINCT FROM OLD.business_id
    AND NEW.payroll_month IS NOT DISTINCT FROM OLD.payroll_month
    AND NEW.pay_period_start IS NOT DISTINCT FROM OLD.pay_period_start
    AND NEW.pay_period_end IS NOT DISTINCT FROM OLD.pay_period_end
    AND NEW.payroll_frequency IS NOT DISTINCT FROM OLD.payroll_frequency
    AND NEW.run_type IS NOT DISTINCT FROM OLD.run_type
    AND NEW.calculation_engine_version IS NOT DISTINCT FROM OLD.calculation_engine_version
    AND NEW.calculation_jurisdiction IS NOT DISTINCT FROM OLD.calculation_jurisdiction
    AND NEW.statutory_period_basis IS NOT DISTINCT FROM OLD.statutory_period_basis
    AND NEW.paye_rate_version IS NOT DISTINCT FROM OLD.paye_rate_version
    AND NEW.pension_rate_version IS NOT DISTINCT FROM OLD.pension_rate_version
    AND NEW.pension_limits_provisional IS NOT DISTINCT FROM OLD.pension_limits_provisional
    AND NEW.pension_minimum_insurable_earnings IS NOT DISTINCT FROM OLD.pension_minimum_insurable_earnings
    AND NEW.pension_maximum_insurable_earnings IS NOT DISTINCT FROM OLD.pension_maximum_insurable_earnings
    AND NEW.pension_limits_effective_from IS NOT DISTINCT FROM OLD.pension_limits_effective_from
    AND NEW.provisional_ssnit_acknowledged_at IS NOT DISTINCT FROM OLD.provisional_ssnit_acknowledged_at
    AND NEW.provisional_ssnit_acknowledged_by IS NOT DISTINCT FROM OLD.provisional_ssnit_acknowledged_by
    AND NEW.total_basic_salary IS NOT DISTINCT FROM OLD.total_basic_salary
    AND NEW.total_allowances IS NOT DISTINCT FROM OLD.total_allowances
    AND NEW.total_gross_salary IS NOT DISTINCT FROM OLD.total_gross_salary
    AND NEW.total_ssnit_employee IS NOT DISTINCT FROM OLD.total_ssnit_employee
    AND NEW.total_ssnit_employer IS NOT DISTINCT FROM OLD.total_ssnit_employer
    AND NEW.total_paye IS NOT DISTINCT FROM OLD.total_paye
    AND NEW.total_deductions IS NOT DISTINCT FROM OLD.total_deductions
    AND NEW.total_net_salary IS NOT DISTINCT FROM OLD.total_net_salary
    AND NEW.journal_entry_id IS NOT DISTINCT FROM OLD.journal_entry_id
    AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
    AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
    AND NEW.reversed_at IS NOT DISTINCT FROM OLD.reversed_at
    AND NEW.reversed_by IS NOT DISTINCT FROM OLD.reversed_by
    AND NEW.reversal_journal_id IS NOT DISTINCT FROM OLD.reversal_journal_id
    AND NEW.reversal_reason IS NOT DISTINCT FROM OLD.reversal_reason
    AND NEW.correction_of_run_id IS NOT DISTINCT FROM OLD.correction_of_run_id
    AND NEW.corrected_by_run_id IS NOT DISTINCT FROM OLD.corrected_by_run_id
    AND NEW.corrects_payroll_run_id IS NOT DISTINCT FROM OLD.corrects_payroll_run_id
    AND NEW.staff_scope_fingerprint IS NOT DISTINCT FROM OLD.staff_scope_fingerprint
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
  );

  IF v_notes_only AND NEW.notes IS DISTINCT FROM OLD.notes THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'approved' AND v_ctx = 'approve' THEN
        RETURN NEW;
      END IF;
      IF NEW.status = 'draft' THEN
        RETURN NEW;
      END IF;
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_RUN_INVALID_STATUS_TRANSITION',
        format('Invalid payroll run status transition from %s to %s', OLD.status, NEW.status)
      );
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('approved', 'locked', 'reversed') THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'approved' AND NEW.status = 'locked' AND v_ctx = 'lock' THEN
        RETURN NEW;
      END IF;
      IF OLD.status IN ('approved', 'locked') AND NEW.status = 'reversed' AND v_ctx = 'reverse' THEN
        RETURN NEW;
      END IF;
      IF OLD.status = 'reversed' AND NEW.status = 'reversed' AND v_ctx = 'correction_link'
         AND NEW.corrected_by_run_id IS DISTINCT FROM OLD.corrected_by_run_id THEN
        RETURN NEW;
      END IF;
      IF OLD.status IN ('approved', 'locked') AND NEW.status = OLD.status AND v_ctx = 'approve' THEN
        RETURN NEW;
      END IF;
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_RUN_INVALID_STATUS_TRANSITION',
        format('Invalid payroll run status transition from %s to %s', OLD.status, NEW.status)
      );
    END IF;

    IF v_ctx = 'approve' AND OLD.status = 'draft' THEN
      RETURN NEW;
    END IF;
    IF v_ctx = 'lock' AND OLD.status = 'approved' AND NEW.status = 'locked' THEN
      RETURN NEW;
    END IF;
    IF v_ctx = 'reverse' AND NEW.status = 'reversed' THEN
      RETURN NEW;
    END IF;
    IF v_ctx = 'correction_link'
       AND OLD.status = 'reversed'
       AND NEW.corrected_by_run_id IS DISTINCT FROM OLD.corrected_by_run_id
       AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;

    IF v_notes_only THEN
      RETURN NEW;
    END IF;

    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_RUN_IMMUTABLE',
      format('Payroll run in status %s cannot be mutated outside controlled payroll RPCs', OLD.status)
    );
  END IF;

  RETURN NEW;
END;
$$;
