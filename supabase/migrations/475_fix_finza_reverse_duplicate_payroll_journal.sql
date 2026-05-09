-- ============================================================================
-- Migration 475: Fix finza_reverse_duplicate_payroll_journal → post_journal_entry
-- ============================================================================
-- 473 called post_journal_entry positionally; Postgres resolved a shorter overload,
-- omitting p_posting_source / p_is_revenue_correction / p_reverses_entry_id alignment.
-- This migration replaces the helper with explicit named arguments (17-param API).
-- Does not modify migration 473 files on disk.
-- ============================================================================

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
  v_reversal_lines JSONB;
  v_new_id UUID;
  v_existing_rev UUID;
  v_business_id UUID;
BEGIN
  SELECT r.id
  INTO v_existing_rev
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

  IF v_orig.reference_type = 'payroll_payment' THEN
    RAISE EXCEPTION
      'finza_reverse_duplicate_payroll_journal does not reverse salary payment journals (reference_type = payroll_payment)';
  END IF;

  IF v_orig.reference_type <> 'payroll' THEN
    RAISE EXCEPTION 'finza_reverse_duplicate_payroll_journal only supports payroll approval journals (reference_type = payroll)';
  END IF;

  v_business_id := v_orig.business_id;

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
  INTO v_reversal_lines
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = p_journal_entry_id;

  IF v_reversal_lines IS NULL OR jsonb_array_length(v_reversal_lines) = 0 THEN
    RAISE EXCEPTION 'Journal entry has no lines: %', p_journal_entry_id;
  END IF;

  SELECT public.post_journal_entry(
    p_business_id := v_business_id,
    p_date := v_orig.date,
    p_description := 'Reversal: duplicate payroll approval journal',
    p_reference_type := 'reversal',
    p_reference_id := p_journal_entry_id,
    p_lines := v_reversal_lines,
    p_is_adjustment := TRUE,
    p_adjustment_reason := COALESCE(NULLIF(TRIM(p_reason), ''), 'Duplicate payroll approval journal reversal'),
    p_adjustment_ref := 'duplicate_payroll_journal',
    p_created_by := NULL::uuid,
    p_entry_type := NULL::text,
    p_backfill_reason := NULL::text,
    p_backfill_actor := NULL::text,
    p_posted_by_accountant_id := NULL::uuid,
    p_posting_source := 'system',
    p_is_revenue_correction := FALSE,
    p_reverses_entry_id := p_journal_entry_id
  )
  INTO v_new_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.finza_reverse_duplicate_payroll_journal(UUID, TEXT) IS
  'SECURITY DEFINER: posts reversal via post_journal_entry with full named 17-arg contract; idempotent if reversal exists; payroll approval only.';

REVOKE ALL ON FUNCTION public.finza_reverse_duplicate_payroll_journal(UUID, TEXT) FROM PUBLIC;
