-- ============================================================================
-- Migration 583: Service workspace manual journal entries
-- ============================================================================
-- Scope: Service/Professional workspace only.
-- Adds a Service-only draft layer and SECURITY DEFINER ledger functions.
-- Does not change Accounting/Practice or Retail posting behavior.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Account postability (shared accounts column; only Service manual journals
--    enforce it in this migration)
-- ----------------------------------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_postable BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.accounts.is_postable IS
  'When false, the account cannot be used as a line account for Service manual journals. Existing posting paths are unchanged.';

CREATE OR REPLACE FUNCTION public.is_service_manual_control_account(
  p_code TEXT,
  p_is_system BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(p_is_system, FALSE)
    AND COALESCE(p_code, '') IN (
      '1100', -- Accounts Receivable
      '1200', -- Accounts Receivable (legacy)
      '2000', -- Accounts Payable
      '2100', -- VAT Payable
      '2110', -- NHIL Payable
      '2120', -- GETFund Payable
      '2130', -- COVID Levy Payable
      '2155', -- WHT Receivable
      '2200', -- Other Tax Liabilities
      '2210', -- PAYE Liability
      '2220', -- SSNIT Employee Contribution Payable
      '2230', -- PAYE Tax Payable
      '2231', -- SSNIT / Tier 1 Pension Payable
      '2232', -- Tier 2 Pension Payable
      '2240', -- Net Salaries Payable
      '2241'  -- Employee Deductions / Recoveries Payable
    );
$$;

COMMENT ON FUNCTION public.is_service_manual_control_account(TEXT, BOOLEAN) IS
  'Canonical control-account classifier for Service manual journals. Control accounts are not manually postable.';

CREATE OR REPLACE FUNCTION public.enforce_account_postability_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_service_manual_control_account(NEW.code, NEW.is_system) THEN
    NEW.is_postable := FALSE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_account_postability_flag ON public.accounts;
CREATE TRIGGER trigger_enforce_account_postability_flag
  BEFORE INSERT OR UPDATE OF code, is_system, is_postable
  ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_account_postability_flag();

UPDATE public.accounts
SET is_postable = FALSE
WHERE public.is_service_manual_control_account(code, is_system);

-- ----------------------------------------------------------------------------
-- 2) Ledger metadata: external reference + Service manual source types
-- ----------------------------------------------------------------------------
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS reference TEXT;

COMMENT ON COLUMN public.journal_entries.reference IS
  'Optional external document/reference supplied for a manual journal.';

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (
    source_type IS NULL
    OR source_type IN (
      'proposal',
      'adjustment',
      'manual_draft',
      'opening_balance',
      'service_intent',
      'service_manual',
      'service_manual_reversal'
    )
  );

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_posting_source_check;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_posting_source_check
  CHECK (posting_source IN ('system', 'accountant', 'service_manual'));

-- Allow service_manual source types through the existing proposal gate.
CREATE OR REPLACE FUNCTION public.validate_proposal_gating(
  p_source_type TEXT,
  p_source_id UUID,
  p_business_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  adjustment_record RECORD;
BEGIN
  IF p_source_type IN (
    'manual_draft',
    'opening_balance',
    'service_intent',
    'service_manual',
    'service_manual_reversal'
  ) THEN
    RETURN TRUE;
  END IF;

  IF (p_source_type IS NULL) != (p_source_id IS NULL) THEN
    RAISE EXCEPTION 'source_type and source_id must both be provided or both be NULL';
  END IF;

  IF p_source_type IS NOT NULL THEN
    IF p_source_type NOT IN ('proposal', 'adjustment') THEN
      RAISE EXCEPTION 'source_type must be ''proposal'' or ''adjustment'', got: %', p_source_type;
    END IF;

    IF p_source_type = 'adjustment' THEN
      SELECT * INTO adjustment_record
      FROM adjustment_journals
      WHERE id = p_source_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Adjustment journal not found: %. Journal entry must reference a valid adjustment journal.', p_source_id;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM journal_entries je
        WHERE je.id = adjustment_record.journal_entry_id
          AND je.business_id != p_business_id
      ) THEN
        RAISE EXCEPTION 'Adjustment journal does not belong to the same business as the journal entry';
      END IF;
    END IF;

    IF p_source_type = 'proposal' THEN
      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'posting_proposals'
      ) THEN
        IF NOT EXISTS (
          SELECT 1
          FROM posting_proposals
          WHERE id = p_source_id
            AND status = 'approved'
            AND business_id = p_business_id
        ) THEN
          RAISE EXCEPTION 'Posting proposal not found or not approved: %. Journal entry must reference an approved posting proposal.', p_source_id;
        END IF;
      ELSE
        RAISE WARNING 'posting_proposals table does not exist yet. Proposal validation will be enforced when table is created.';
      END IF;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- The existing accountant-only trigger must understand the new source. The
-- service_manual branch checks Service business membership + role directly.
CREATE OR REPLACE FUNCTION public.validate_accountant_posting(
  p_posted_by_accountant_id UUID,
  p_business_id UUID,
  p_posting_source TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  is_accountant BOOLEAN;
BEGIN
  IF p_posting_source = 'service_manual' THEN
    IF p_posted_by_accountant_id IS NULL THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_UNAUTHORIZED: posting user is required';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = p_business_id
        AND b.archived_at IS NULL
        AND b.owner_id = p_posted_by_accountant_id
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = p_business_id
        AND bu.user_id = p_posted_by_accountant_id
        AND bu.role IN ('admin', 'accountant')
        AND COALESCE(bu.accountant_readonly, FALSE) = FALSE
    ) THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_FORBIDDEN: user cannot post manual journals for this business';
    END IF;

    RETURN TRUE;
  END IF;

  IF p_posting_source = 'accountant' THEN
    IF p_posted_by_accountant_id IS NULL THEN
      RAISE EXCEPTION 'posted_by_accountant_id is required for accountant postings. Only accountants can post ledger entries manually.';
    END IF;

    is_accountant := public.is_user_accountant(p_posted_by_accountant_id, p_business_id);

    IF NOT is_accountant THEN
      RAISE EXCEPTION 'User % does not have accountant role for business %. Only accountants can post ledger entries manually.',
        p_posted_by_accountant_id, p_business_id;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.validate_accountant_posting(UUID, UUID, TEXT) IS
  'Validates posting authority. service_manual requires a Service owner/admin/accountant; accountant behavior is unchanged.';

-- ----------------------------------------------------------------------------
-- 3) Service-only draft table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_manual_journal_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL,
  reference TEXT,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_debit NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_credit NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'reversed')),
  idempotency_key TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_by UUID REFERENCES auth.users(id),
  posted_at TIMESTAMPTZ,
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  reversal_journal_entry_id UUID REFERENCES public.journal_entries(id),
  CONSTRAINT service_manual_journal_lines_array_check CHECK (jsonb_typeof(lines) = 'array'),
  CONSTRAINT service_manual_journal_min_lines_check CHECK (jsonb_array_length(lines) >= 2),
  CONSTRAINT service_manual_journal_totals_check CHECK (total_debit >= 0 AND total_credit >= 0),
  CONSTRAINT service_manual_journal_balanced_check CHECK (ABS(total_debit - total_credit) < 0.005),
  CONSTRAINT service_manual_journal_description_check CHECK (length(BTRIM(description)) > 0),
  CONSTRAINT service_manual_journal_reference_check CHECK (reference IS NULL OR length(reference) <= 200),
  CONSTRAINT service_manual_journal_idempotency_check CHECK (length(BTRIM(idempotency_key)) BETWEEN 1 AND 128)
);

CREATE UNIQUE INDEX IF NOT EXISTS service_manual_journal_drafts_idempotency_uidx
  ON public.service_manual_journal_drafts (business_id, idempotency_key);

CREATE INDEX IF NOT EXISTS service_manual_journal_drafts_business_status_idx
  ON public.service_manual_journal_drafts (business_id, status, entry_date DESC);

CREATE INDEX IF NOT EXISTS service_manual_journal_drafts_journal_entry_idx
  ON public.service_manual_journal_drafts (journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_manual_journal_drafts_reversal_idx
  ON public.service_manual_journal_drafts (reversal_journal_entry_id)
  WHERE reversal_journal_entry_id IS NOT NULL;

DROP TRIGGER IF EXISTS service_manual_journal_drafts_updated_at
  ON public.service_manual_journal_drafts;
CREATE TRIGGER service_manual_journal_drafts_updated_at
  BEFORE UPDATE ON public.service_manual_journal_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- One Service manual ledger entry per draft, and one reversal per original.
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_service_manual_source_uidx
  ON public.journal_entries (source_id)
  WHERE source_type = 'service_manual' AND source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_service_manual_reversal_uidx
  ON public.journal_entries (reverses_entry_id)
  WHERE source_type = 'service_manual_reversal' AND reverses_entry_id IS NOT NULL;

ALTER TABLE public.service_manual_journal_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service manual journal readers" ON public.service_manual_journal_drafts;
CREATE POLICY "Service manual journal readers"
  ON public.service_manual_journal_drafts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = service_manual_journal_drafts.business_id
        AND b.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = service_manual_journal_drafts.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('admin', 'accountant')
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.service_manual_journal_drafts FROM anon, authenticated;
GRANT SELECT ON public.service_manual_journal_drafts TO authenticated;

COMMENT ON TABLE public.service_manual_journal_drafts IS
  'Service workspace manual journal drafts. Writes are only through SECURITY DEFINER RPCs; posted drafts are immutable.';

COMMENT ON COLUMN public.service_manual_journal_drafts.lines IS
  'JSONB array of {account_id, debit, credit, memo}. Validated by create/post RPCs.';

-- ----------------------------------------------------------------------------
-- 4) Service authority helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.service_manual_journal_actor_role(
  p_business_id UUID,
  p_user_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_owner UUID;
  v_industry TEXT;
  v_archived TIMESTAMPTZ;
  v_role TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_UNAUTHORIZED: authentication required';
  END IF;

  SELECT b.owner_id, lower(COALESCE(b.industry, '')), b.archived_at
  INTO v_owner, v_industry, v_archived
  FROM public.businesses b
  WHERE b.id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_BUSINESS_NOT_FOUND: business not found';
  END IF;

  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_BUSINESS_ARCHIVED: business is archived';
  END IF;

  IF v_industry NOT IN ('service', 'professional') THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_NOT_SERVICE: manual journals are available only in the Service workspace';
  END IF;

  IF v_owner = p_user_id THEN
    RETURN 'owner';
  END IF;

  SELECT bu.role INTO v_role
  FROM public.business_users bu
  WHERE bu.business_id = p_business_id
    AND bu.user_id = p_user_id
    AND bu.role IN ('admin', 'accountant')
    AND COALESCE(bu.accountant_readonly, FALSE) = FALSE
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_FORBIDDEN: user cannot create or post manual journals for this business';
  END IF;

  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.service_manual_journal_assert_open_period(
  p_business_id UUID,
  p_entry_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_period_id UUID;
  v_status TEXT;
BEGIN
  SELECT ap.id, ap.status
  INTO v_period_id, v_status
  FROM public.accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND p_entry_date >= ap.period_start
    AND p_entry_date <= ap.period_end
  ORDER BY ap.period_start DESC
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_PERIOD_NOT_FOUND: no accounting period covers %', p_entry_date;
  END IF;

  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_PERIOD_NOT_OPEN: accounting period is %', v_status;
  END IF;

  RETURN v_period_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.service_manual_journal_validate_lines(
  p_business_id UUID,
  p_lines JSONB
)
RETURNS TABLE (
  total_debit NUMERIC,
  total_credit NUMERIC,
  normalized_lines JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_line JSONB;
  v_account RECORD;
  v_account_id UUID;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_memo TEXT;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_normalized JSONB := '[]'::jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_LINES_INVALID: lines must be an array';
  END IF;

  IF jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_LINES_INVALID: at least two lines are required';
  END IF;

  IF jsonb_array_length(p_lines) > 100 THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_LINES_INVALID: at most 100 lines are allowed';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(v_line) <> 'object' OR NOT (v_line ? 'account_id') THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_LINES_INVALID: each line requires account_id';
    END IF;

    BEGIN
      v_account_id := (v_line->>'account_id')::UUID;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_ACCOUNT_INVALID: account_id must be a UUID';
    END;

    BEGIN
      v_debit := COALESCE(NULLIF(BTRIM(COALESCE(v_line->>'debit', '')), '')::NUMERIC, 0);
      v_credit := COALESCE(NULLIF(BTRIM(COALESCE(v_line->>'credit', '')), '')::NUMERIC, 0);
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_AMOUNT_INVALID: debit and credit must be numeric';
    END;

    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_AMOUNT_INVALID: negative amounts are not allowed';
    END IF;

    IF v_debit = 0 AND v_credit = 0 THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_AMOUNT_INVALID: each line must have a positive debit or credit';
    END IF;

    IF v_debit > 0 AND v_credit > 0 THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_AMOUNT_INVALID: a line cannot have both debit and credit';
    END IF;

    IF v_debit > 1000000000000 OR v_credit > 1000000000000 THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_AMOUNT_INVALID: amount is too large';
    END IF;

    v_debit := ROUND(v_debit, 2);
    v_credit := ROUND(v_credit, 2);

    SELECT a.id, a.code, a.business_id, a.deleted_at, a.is_postable, a.is_system
    INTO v_account
    FROM public.accounts a
    WHERE a.id = v_account_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_ACCOUNT_INVALID: account not found';
    END IF;

    IF v_account.business_id <> p_business_id THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_ACCOUNT_INVALID: account does not belong to this business';
    END IF;

    IF v_account.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_ACCOUNT_INACTIVE: account is inactive';
    END IF;

    IF v_account.is_postable IS NOT TRUE
       OR public.is_service_manual_control_account(v_account.code, v_account.is_system) THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_ACCOUNT_NOT_POSTABLE: account is a control or non-postable account';
    END IF;

    v_memo := NULLIF(BTRIM(COALESCE(v_line->>'memo', '')), '');
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
    v_normalized := v_normalized || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_account_id,
        'debit', v_debit,
        'credit', v_credit,
        'memo', v_memo
      )
    );
  END LOOP;

  IF ROUND(v_total_debit, 2) <> ROUND(v_total_credit, 2) THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_UNBALANCED: total debits % do not equal total credits %',
      ROUND(v_total_debit, 2), ROUND(v_total_credit, 2);
  END IF;

  RETURN QUERY SELECT ROUND(v_total_debit, 2), ROUND(v_total_credit, 2), v_normalized;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5) Create draft
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_service_manual_journal_draft(
  p_business_id UUID,
  p_entry_date DATE,
  p_description TEXT,
  p_reference TEXT,
  p_lines JSONB,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing_id UUID;
  v_period_id UUID;
  v_validated RECORD;
  v_draft_id UUID;
BEGIN
  PERFORM public.service_manual_journal_actor_role(p_business_id, v_user_id);

  IF NOT public.finza_business_can_write_service_records(p_business_id) THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_SUBSCRIPTION_READ_ONLY: financial writes are locked for this business';
  END IF;

  IF NOT public.finza_business_has_service_min_tier(p_business_id, 'business') THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_TIER_REQUIRED: the Business plan or higher is required';
  END IF;

  IF p_entry_date IS NULL THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_DATE_REQUIRED: entry date is required';
  END IF;

  IF p_description IS NULL OR length(BTRIM(p_description)) = 0 OR length(BTRIM(p_description)) > 500 THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_DESCRIPTION_INVALID: description is required and must be 500 characters or fewer';
  END IF;

  IF p_reference IS NOT NULL AND length(BTRIM(p_reference)) > 200 THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_REFERENCE_INVALID: reference must be 200 characters or fewer';
  END IF;

  IF p_idempotency_key IS NULL
     OR length(BTRIM(p_idempotency_key)) < 1
     OR length(BTRIM(p_idempotency_key)) > 128 THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_IDEMPOTENCY_REQUIRED: a 1-128 character idempotency key is required';
  END IF;

  v_period_id := public.service_manual_journal_assert_open_period(p_business_id, p_entry_date);

  SELECT * INTO v_validated
  FROM public.service_manual_journal_validate_lines(p_business_id, p_lines);

  SELECT d.id INTO v_existing_id
  FROM public.service_manual_journal_drafts d
  WHERE d.business_id = p_business_id
    AND d.idempotency_key = BTRIM(p_idempotency_key);

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  INSERT INTO public.service_manual_journal_drafts (
    business_id,
    entry_date,
    description,
    reference,
    lines,
    total_debit,
    total_credit,
    status,
    idempotency_key,
    created_by
  ) VALUES (
    p_business_id,
    p_entry_date,
    BTRIM(p_description),
    NULLIF(BTRIM(COALESCE(p_reference, '')), ''),
    v_validated.normalized_lines,
    v_validated.total_debit,
    v_validated.total_credit,
    'draft',
    BTRIM(p_idempotency_key),
    v_user_id
  )
  RETURNING id INTO v_draft_id;

  -- v_period_id is validated here and re-validated at post time.
  RETURN v_draft_id;
EXCEPTION WHEN unique_violation THEN
  SELECT d.id INTO v_existing_id
  FROM public.service_manual_journal_drafts d
  WHERE d.business_id = p_business_id
    AND d.idempotency_key = BTRIM(p_idempotency_key)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;
  RAISE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6) Post draft to ledger (idempotent)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_service_manual_journal_draft(
  p_draft_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_draft RECORD;
  v_currency TEXT;
  v_period_id UUID;
  v_validated RECORD;
  v_journal_entry_id UUID;
BEGIN
  SELECT * INTO v_draft
  FROM public.service_manual_journal_drafts
  WHERE id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_DRAFT_NOT_FOUND: draft not found';
  END IF;

  PERFORM public.service_manual_journal_actor_role(v_draft.business_id, v_user_id);

  IF v_draft.status = 'reversed' THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_ALREADY_REVERSED: a reversed draft cannot be posted again';
  END IF;

  -- Retry-safe: an already posted draft returns its ledger entry even if the
  -- subscription state changed after the first successful post.
  IF v_draft.journal_entry_id IS NOT NULL THEN
    RETURN v_draft.journal_entry_id;
  END IF;

  IF NOT public.finza_business_can_write_service_records(v_draft.business_id) THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_SUBSCRIPTION_READ_ONLY: financial writes are locked for this business';
  END IF;

  IF NOT public.finza_business_has_service_min_tier(v_draft.business_id, 'business') THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_TIER_REQUIRED: the Business plan or higher is required';
  END IF;

  IF v_draft.status <> 'draft' THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_NOT_DRAFT: only draft entries can be posted';
  END IF;

  v_period_id := public.service_manual_journal_assert_open_period(v_draft.business_id, v_draft.entry_date);

  SELECT * INTO v_validated
  FROM public.service_manual_journal_validate_lines(v_draft.business_id, v_draft.lines);

  IF v_validated.total_debit <> v_draft.total_debit
     OR v_validated.total_credit <> v_draft.total_credit THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_DRAFT_TOTALS_INVALID: draft totals do not match its lines';
  END IF;

  SELECT b.default_currency INTO v_currency
  FROM public.businesses b
  WHERE b.id = v_draft.business_id;

  IF v_currency IS NULL OR BTRIM(v_currency) = '' THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_CURRENCY_REQUIRED: set the business default currency before posting';
  END IF;

  INSERT INTO public.journal_entries (
    business_id,
    date,
    description,
    reference,
    reference_type,
    reference_id,
    source_type,
    source_id,
    period_id,
    currency,
    fx_rate,
    created_by,
    posted_by,
    posted_by_accountant_id,
    posting_source,
    is_adjustment
  ) VALUES (
    v_draft.business_id,
    v_draft.entry_date,
    v_draft.description,
    v_draft.reference,
    'manual',
    v_draft.id,
    'service_manual',
    v_draft.id,
    v_period_id,
    v_currency,
    1,
    v_draft.created_by,
    v_user_id,
    v_user_id,
    'service_manual',
    FALSE
  )
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  )
  SELECT
    v_journal_entry_id,
    (line->>'account_id')::UUID,
    COALESCE((line->>'debit')::NUMERIC, 0),
    COALESCE((line->>'credit')::NUMERIC, 0),
    NULLIF(line->>'memo', '')
  FROM jsonb_array_elements(v_validated.normalized_lines) AS line;

  UPDATE public.service_manual_journal_drafts
  SET
    status = 'posted',
    journal_entry_id = v_journal_entry_id,
    posted_by = v_user_id,
    posted_at = NOW(),
    updated_at = NOW()
  WHERE id = v_draft.id;

  RETURN v_journal_entry_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7) Reverse a posted Service manual entry (idempotent)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_service_manual_journal(
  p_journal_entry_id UUID,
  p_reversal_date DATE,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_original RECORD;
  v_existing_reversal UUID;
  v_period_id UUID;
  v_reversal_id UUID;
  v_line_count INTEGER;
BEGIN
  SELECT * INTO v_original
  FROM public.journal_entries
  WHERE id = p_journal_entry_id
    AND source_type = 'service_manual'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_JOURNAL_NOT_FOUND: posted manual journal not found';
  END IF;

  PERFORM public.service_manual_journal_actor_role(v_original.business_id, v_user_id);

  IF NOT public.finza_business_can_write_service_records(v_original.business_id) THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_SUBSCRIPTION_READ_ONLY: financial writes are locked for this business';
  END IF;

  IF NOT public.finza_business_has_service_min_tier(v_original.business_id, 'business') THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_TIER_REQUIRED: the Business plan or higher is required';
  END IF;

  SELECT id INTO v_existing_reversal
  FROM public.journal_entries
  WHERE reverses_entry_id = p_journal_entry_id
  LIMIT 1;

  IF v_existing_reversal IS NOT NULL THEN
    RETURN v_existing_reversal;
  END IF;

  IF p_reason IS NULL OR length(BTRIM(p_reason)) < 10 OR length(BTRIM(p_reason)) > 500 THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_REASON_INVALID: reversal reason must be between 10 and 500 characters';
  END IF;

  IF p_reversal_date IS NULL OR p_reversal_date < v_original.date THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_REVERSAL_DATE_INVALID: reversal date must be on or after the original entry date';
  END IF;

  v_period_id := public.service_manual_journal_assert_open_period(v_original.business_id, p_reversal_date);

  SELECT count(*) INTO v_line_count
  FROM public.journal_entry_lines
  WHERE journal_entry_id = v_original.id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_JOURNAL_INVALID: original journal has insufficient lines';
  END IF;

  INSERT INTO public.journal_entries (
    business_id,
    date,
    description,
    reference,
    reference_type,
    reference_id,
    reverses_entry_id,
    source_type,
    source_id,
    period_id,
    currency,
    fx_rate,
    created_by,
    posted_by,
    posted_by_accountant_id,
    posting_source,
    is_adjustment,
    adjustment_reason
  ) VALUES (
    v_original.business_id,
    p_reversal_date,
    'Reversal of manual journal ' || left(v_original.id::text, 8) || ': ' || BTRIM(p_reason),
    v_original.reference,
    'reversal',
    v_original.id,
    v_original.id,
    'service_manual_reversal',
    v_original.id,
    v_period_id,
    v_original.currency,
    v_original.fx_rate,
    v_user_id,
    v_user_id,
    v_user_id,
    'service_manual',
    TRUE,
    BTRIM(p_reason)
  )
  RETURNING id INTO v_reversal_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  )
  SELECT
    v_reversal_id,
    line.account_id,
    line.credit,
    line.debit,
    COALESCE(NULLIF(line.description, ''), 'Reversal')
  FROM public.journal_entry_lines line
  WHERE line.journal_entry_id = v_original.id;

  UPDATE public.service_manual_journal_drafts
  SET
    status = 'reversed',
    reversal_journal_entry_id = v_reversal_id,
    updated_at = NOW()
  WHERE journal_entry_id = v_original.id;

  RETURN v_reversal_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8) Function privileges: no PUBLIC execution; authenticated only
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_service_manual_control_account(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_service_manual_control_account(TEXT, BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.service_manual_journal_actor_role(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_manual_journal_assert_open_period(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_manual_journal_validate_lines(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_service_manual_journal_draft(UUID, DATE, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_service_manual_journal_draft(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_service_manual_journal(UUID, DATE, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_service_manual_journal_draft(UUID, DATE, TEXT, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_service_manual_journal_draft(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_service_manual_journal(UUID, DATE, TEXT) TO authenticated;

REVOKE ALL ON TABLE public.service_manual_journal_drafts FROM anon;
GRANT SELECT ON TABLE public.service_manual_journal_drafts TO authenticated;

COMMENT ON FUNCTION public.create_service_manual_journal_draft(UUID, DATE, TEXT, TEXT, JSONB, TEXT) IS
  'Service-only. Creates an idempotent manual journal draft after membership, role, account, balance and open-period validation.';

COMMENT ON FUNCTION public.post_service_manual_journal_draft(UUID) IS
  'Service-only, idempotent. Posts a draft to journal_entries/lines as source_type=service_manual after revalidation.';

COMMENT ON FUNCTION public.reverse_service_manual_journal(UUID, DATE, TEXT) IS
  'Service-only, idempotent. Posts a linked reversal of a service_manual journal in an open period; preserves the original.';
