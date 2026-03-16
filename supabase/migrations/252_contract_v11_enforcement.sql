-- ============================================================================
-- Migration 252: FINZA Immutable Accounting Contract v1.1 Enforcement
-- ============================================================================
-- Implements:
-- 1. sent_at immutability after ledger posting
-- 2. Business timezone column (normalization used by period resolution)
-- 3. Currency-scale aware rounding in post_journal_entry
-- 4. VAT migration safeguard (ledger_authority flag on vat_returns)
-- 5. Safe period_id backfill with uniqueness guard
-- ============================================================================

-- ============================================================================
-- PART 1 — SENT_AT IMMUTABILITY
-- Once an invoice has posted to the ledger, invoices.sent_at MUST NOT change.
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_invoice_sent_at_change_after_posting()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF OLD.sent_at IS NOT DISTINCT FROM NEW.sent_at THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM journal_entries je
    WHERE je.reference_type = 'invoice'
      AND je.reference_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'invoices.sent_at is immutable once invoice has ledger posting. Invoice id: %',
      OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_invoice_sent_at_change_after_posting ON invoices;
CREATE TRIGGER trigger_prevent_invoice_sent_at_change_after_posting
  BEFORE UPDATE OF sent_at ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION prevent_invoice_sent_at_change_after_posting();

COMMENT ON FUNCTION prevent_invoice_sent_at_change_after_posting() IS
  'Contract v1.1: Once an invoice has a journal entry (posted), sent_at MUST NOT change.';

-- ============================================================================
-- PART 2 — BUSINESS TIMEZONE (for period resolution normalization)
-- ============================================================================

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

COMMENT ON COLUMN businesses.timezone IS
  'Contract v1.1: IANA timezone (e.g. Africa/Accra, UTC). Used to normalize dates before period resolution so as_of_date and current-month fallback use business calendar.';

-- ============================================================================
-- PART 3 — CURRENCY-SCALE AWARE ROUNDING
-- Helper: return display/ledger scale for a currency code (0 for JPY, 3 for BHD/KWD, else 2).
-- ============================================================================

CREATE OR REPLACE FUNCTION get_currency_scale(p_currency_code TEXT)
RETURNS INT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN UPPER(TRIM(COALESCE(p_currency_code, ''))) IN ('JPY', 'KRW', 'VND', 'XOF', 'XAF') THEN 0
    WHEN UPPER(TRIM(COALESCE(p_currency_code, ''))) IN ('BHD', 'KWD', 'OMR', 'JOD') THEN 3
    ELSE 2
  END;
$$;

COMMENT ON FUNCTION get_currency_scale(TEXT) IS
  'Contract v1.1: Ledger rounding scale by currency. JPY/KRW/VND/XOF/XAF=0; BHD/KWD/OMR/JOD=3; else 2.';

-- We will apply rounding in post_journal_entry via a new migration step below that replaces
-- the INSERT into journal_entry_lines to use ROUND(..., scale). Scale comes from business.
-- (post_journal_entry is in 228_revenue_recognition_guards.sql; we replace it here.)

-- ============================================================================
-- PART 4 — VAT MIGRATION SAFEGUARD (ledger authority flagging only)
-- ============================================================================

ALTER TABLE vat_returns
  ADD COLUMN IF NOT EXISTS ledger_authority BOOLEAN NOT NULL DEFAULT FALSE;

-- Contract v2.0 VAT Ledger Authority Marker
COMMENT ON COLUMN vat_returns.ledger_authority IS
  'Contract v1.1/v2.0: When TRUE, this return is derived from ledger (authoritative). Set TRUE only when VAT return is generated from ledger data. Operational flows set FALSE. Historical returns remain FALSE. No data migration.';

-- ============================================================================
-- PART 5 — SAFE PERIOD_ID BACKFILL WITH UNIQUENESS GUARD
-- Assign period_id to journal_entries where period_id IS NULL.
-- Guard: for each (business_id, date) pick exactly one period (deterministic:
-- period that contains date, then ORDER BY period_start DESC LIMIT 1 to handle overlaps).
-- ============================================================================

DO $$
DECLARE
  v_updated BIGINT;
  v_orphan_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM accounting_periods a
    JOIN accounting_periods b
      ON a.business_id = b.business_id
      AND a.id <> b.id
      AND a.period_start <= b.period_end
      AND a.period_end >= b.period_start
  ) THEN
    RAISE EXCEPTION
      'Overlapping accounting periods detected. Backfill aborted to preserve accounting integrity.';
  END IF;

  -- Backfill: one period per row, deterministic. Disable immutability trigger for this migration-only backfill (same pattern as 189, 190).
  EXECUTE 'ALTER TABLE journal_entries DISABLE TRIGGER trigger_prevent_journal_entry_modification';

  WITH period_per_je AS (
    SELECT
      je.id AS je_id,
      (SELECT ap.id
       FROM accounting_periods ap
       WHERE ap.business_id = je.business_id
         AND je.date >= ap.period_start
         AND je.date <= ap.period_end
       ORDER BY ap.period_start DESC
       LIMIT 1) AS period_id
    FROM journal_entries je
    WHERE je.period_id IS NULL
  )
  UPDATE journal_entries je
  SET period_id = p.period_id
  FROM period_per_je p
  WHERE je.id = p.je_id AND p.period_id IS NOT NULL;

  EXECUTE 'ALTER TABLE journal_entries ENABLE TRIGGER trigger_prevent_journal_entry_modification';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Contract v1.1 backfill: updated % journal_entries with period_id.', v_updated;

  -- Uniqueness guard: no row should match more than one period (we picked one per row above).
  -- Sanity check: count journal_entries still null period_id where a period exists (should be 0 if all dates fall in some period)
  SELECT COUNT(*) INTO v_orphan_count
  FROM journal_entries je
  WHERE je.period_id IS NULL
    AND EXISTS (
      SELECT 1 FROM accounting_periods ap
      WHERE ap.business_id = je.business_id
        AND je.date >= ap.period_start
        AND je.date <= ap.period_end
    );
  IF v_orphan_count > 0 THEN
    RAISE NOTICE 'Contract v1.1: % journal_entries have date within a period but period_id still NULL (possible race). Re-run migration or manual backfill.', v_orphan_count;
  END IF;
END $$;

-- ============================================================================
-- PART 3 (continued) — APPLY ROUNDING + PERIOD_ID IN post_journal_entry
-- Preserves all 228 validations; adds: period_id resolution, currency-scale rounding.
-- ============================================================================

CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB,
  p_is_adjustment BOOLEAN DEFAULT FALSE,
  p_adjustment_reason TEXT DEFAULT NULL,
  p_adjustment_ref TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL,
  p_posted_by_accountant_id UUID DEFAULT NULL,
  p_posting_source TEXT DEFAULT NULL,
  p_is_revenue_correction BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  journal_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
  system_accountant_id UUID;
  revenue_account_id UUID;
  has_revenue_line BOOLEAN := FALSE;
  invoice_status TEXT;
  v_scale INT := 2;
  v_currency TEXT;
  v_timezone TEXT;
  v_normalized_date DATE;
  v_period_id UUID;
BEGIN
  IF p_posting_source IS NULL THEN
    RAISE EXCEPTION 'posting_source is required and must be explicitly set to ''system'' or ''accountant''';
  END IF;
  IF p_posting_source NOT IN ('system', 'accountant') THEN
    RAISE EXCEPTION 'posting_source must be ''system'' or ''accountant''. Found: %', p_posting_source;
  END IF;

  IF p_is_adjustment = TRUE THEN
    IF p_adjustment_reason IS NULL OR TRIM(p_adjustment_reason) = '' THEN
      RAISE EXCEPTION 'Adjustment entries require a non-empty adjustment_reason';
    END IF;
    IF p_reference_type != 'adjustment' THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_type = ''adjustment''. Found: %', p_reference_type;
    END IF;
    IF p_reference_id IS NOT NULL AND COALESCE(p_is_revenue_correction, FALSE) = FALSE THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_id = NULL unless explicitly a revenue correction (is_revenue_correction = true).';
    END IF;
  ELSE
    IF p_adjustment_reason IS NOT NULL OR p_adjustment_ref IS NOT NULL THEN
      RAISE EXCEPTION 'Non-adjustment entries cannot have adjustment_reason or adjustment_ref';
    END IF;
  END IF;

  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

  revenue_account_id := get_account_by_code(p_business_id, '4000');
  IF revenue_account_id IS NOT NULL THEN
    FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      IF (line->>'account_id')::UUID = revenue_account_id THEN
        has_revenue_line := TRUE;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF has_revenue_line THEN
    IF p_reference_type = 'payment' THEN
      RAISE EXCEPTION 'Revenue is recognized only on invoice issuance. Payments cannot post revenue.';
    END IF;
    IF p_reference_type = 'invoice' THEN
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Revenue journal entries must reference an issued invoice (reference_id required).';
      END IF;
      SELECT status INTO invoice_status FROM invoices WHERE id = p_reference_id AND business_id = p_business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Revenue journal entries must reference an issued invoice. Invoice not found: %', p_reference_id;
      END IF;
      IF invoice_status = 'draft' THEN
        RAISE EXCEPTION 'Draft invoices cannot post revenue. Issue the invoice first.';
      END IF;
    ELSIF p_reference_type IN ('adjustment', 'reconciliation') THEN
      IF COALESCE(p_is_revenue_correction, FALSE) = FALSE THEN
        RAISE EXCEPTION 'Reconciliation/adjustment entries cannot post revenue unless explicitly flagged as revenue correction (is_revenue_correction = true).';
      END IF;
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Revenue correction entries must reference an issued invoice (reference_id required).';
      END IF;
      SELECT status INTO invoice_status FROM invoices WHERE id = p_reference_id AND business_id = p_business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Revenue correction must reference an issued invoice. Invoice not found: %', p_reference_id;
      END IF;
      IF invoice_status = 'draft' THEN
        RAISE EXCEPTION 'Revenue correction must reference an issued invoice. Draft invoice: %', p_reference_id;
      END IF;
    ELSE
      RAISE EXCEPTION 'Revenue journal lines are only allowed for invoice issuance (reference_type = invoice) or explicitly flagged revenue corrections (reference_type = adjustment/reconciliation, is_revenue_correction = true).';
    END IF;
  END IF;

  -- Contract v1.1: currency scale and timezone before balance check and period lookup
  SELECT COALESCE(default_currency, 'USD')
  INTO v_currency
  FROM businesses
  WHERE id = p_business_id;
  v_scale := get_currency_scale(v_currency);

  SELECT timezone INTO v_timezone
  FROM businesses
  WHERE id = p_business_id;
  v_normalized_date := (p_date::timestamp AT TIME ZONE COALESCE(v_timezone, 'UTC'))::date;

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit +
      ROUND(COALESCE((line->>'debit')::NUMERIC, 0), v_scale);
    total_credit := total_credit +
      ROUND(COALESCE((line->>'credit')::NUMERIC, 0), v_scale);
  END LOOP;
  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  IF p_posting_source = 'system' AND p_posted_by_accountant_id IS NULL THEN
    SELECT owner_id INTO system_accountant_id FROM businesses WHERE id = p_business_id;
    IF system_accountant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post journal entry: Business owner not found for business %. System accountant required for automatic posting.', p_business_id;
    END IF;
  END IF;

  -- Contract v1.1: period assignment (using normalized date)
  SELECT id INTO v_period_id
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND v_normalized_date >= period_start
    AND v_normalized_date <= period_end
  ORDER BY period_start DESC
  LIMIT 1;
  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No accounting period found for business % and date %. Posting is not allowed.', p_business_id, v_normalized_date
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM assert_accounting_period_is_open(p_business_id, v_normalized_date);

  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    created_by,
    is_adjustment,
    adjustment_reason,
    adjustment_ref,
    entry_type,
    backfill_reason,
    backfill_actor,
    posted_by_accountant_id,
    posting_source,
    period_id
  )
  VALUES (
    p_business_id,
    v_normalized_date,
    p_description,
    p_reference_type,
    p_reference_id,
    COALESCE(p_created_by, system_accountant_id, p_posted_by_accountant_id),
    p_is_adjustment,
    p_adjustment_reason,
    p_adjustment_ref,
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    COALESCE(p_posted_by_accountant_id, system_accountant_id),
    p_posting_source,
    v_period_id
  )
  RETURNING id INTO journal_id;

  INSERT INTO journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  )
  SELECT
    journal_id,
    (jl->>'account_id')::UUID,
    ROUND(COALESCE((jl->>'debit')::NUMERIC, 0)::NUMERIC, v_scale),
    ROUND(COALESCE((jl->>'credit')::NUMERIC, 0)::NUMERIC, v_scale),
    jl->>'description'
  FROM jsonb_array_elements(p_lines) AS jl;

  RETURN journal_id;
END;
$$;

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) IS
  'Posts journal entry. Contract v1.1: period_id set, debit/credit rounded to business currency scale. Enforces revenue recognition.';
