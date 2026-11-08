-- ============================================================================
-- Migration 621: Tax transaction authorization, overlap concurrency and
-- database integrity hardening
-- ============================================================================
-- Scope:
--   * Shared accounting-write authorization guard for VAT payment and WHT
--     remittance database paths (F-05).
--   * Per-business advisory lock + active-status overlap checks so concurrent
--     VAT return creation and legacy overlapping rows cannot both be
--     submitted/paid (F-03, F-06).
--   * Calendar-month validation, immutable business ownership and payment
--     journal ownership/reference validation (F-17).
--
-- Existing rows are not rewritten. Triggers only constrain new transitions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Shared accounting write authorization
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_assert_accounting_write_authorized(
  p_business_id UUID,
  p_min_tier TEXT DEFAULT 'professional'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_readonly BOOLEAN;
BEGIN
  -- Trusted service-role/background execution is allowed. Anonymous direct
  -- execution is not.
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION
      'ACCOUNTING_WRITE_UNAUTHORIZED: authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF p_business_id IS NULL THEN
    RAISE EXCEPTION
      'ACCOUNTING_WRITE_INVALID_BUSINESS: business_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION
      'ACCOUNTING_WRITE_FORBIDDEN: no access to this business'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.finza_business_can_write_service_records(p_business_id) THEN
    RAISE EXCEPTION
      'ACCOUNTING_WRITE_SUBSCRIPTION_READ_ONLY: financial writes are locked for this business'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.finza_business_has_service_min_tier(p_business_id, p_min_tier) THEN
    RAISE EXCEPTION
      'ACCOUNTING_WRITE_TIER_REQUIRED: the % plan or higher is required',
      p_min_tier
      USING ERRCODE = '42501';
  END IF;

  -- Business owner is the top authority and is never accountant_readonly.
  IF EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.id = p_business_id
      AND b.owner_id = v_uid
  ) THEN
    RETURN;
  END IF;

  SELECT bu.role, COALESCE(bu.accountant_readonly, FALSE)
  INTO v_role, v_readonly
  FROM public.business_users bu
  WHERE bu.business_id = p_business_id
    AND bu.user_id = v_uid
  LIMIT 1;

  IF v_role NOT IN ('admin', 'accountant') THEN
    RAISE EXCEPTION
      'ACCOUNTING_WRITE_PERMISSION_DENIED: owner, admin or accountant authority is required'
      USING ERRCODE = '42501';
  END IF;

  IF v_readonly THEN
    RAISE EXCEPTION
      'ACCOUNTING_WRITE_READ_ONLY: accountant access is read-only'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.finza_user_has_permission(p_business_id, 'accounting.view') THEN
    RAISE EXCEPTION
      'ACCOUNTING_WRITE_PERMISSION_DENIED: accounting authority is required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.finza_assert_accounting_write_authorized(UUID, TEXT) IS
  'Shared tax-posting write guard: service_role bypass, authenticated business access, subscription write entitlement, minimum tier, owner/admin/accountant non-readonly and accounting.view.';

REVOKE ALL ON FUNCTION public.finza_assert_accounting_write_authorized(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finza_assert_accounting_write_authorized(UUID, TEXT)
  TO authenticated, service_role, postgres;

-- ----------------------------------------------------------------------------
-- 2) VAT payment authorization at the database boundary
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_vat_payment_write_authorized()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.status = 'paid'
     AND OLD.status IS DISTINCT FROM 'paid' THEN
    PERFORM public.finza_assert_accounting_write_authorized(
      NEW.business_id,
      'professional'
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_vat_payment_write_authorized()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_vat_payment_write_authorized()
  TO postgres;

DROP TRIGGER IF EXISTS trg_vat_payment_write_authorized ON public.vat_returns;
CREATE TRIGGER trg_vat_payment_write_authorized
  BEFORE UPDATE OF status ON public.vat_returns
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_vat_payment_write_authorized();

-- ----------------------------------------------------------------------------
-- 3) WHT remittance authorization at the database boundary
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_wht_remittance_write_authorized()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM public.finza_assert_accounting_write_authorized(
    NEW.business_id,
    'professional'
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_wht_remittance_write_authorized()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_wht_remittance_write_authorized()
  TO postgres;

DROP TRIGGER IF EXISTS trg_wht_remittance_write_authorized ON public.wht_remittances;
CREATE TRIGGER trg_wht_remittance_write_authorized
  BEFORE INSERT ON public.wht_remittances
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_wht_remittance_write_authorized();

-- ----------------------------------------------------------------------------
-- 4) Overlap trigger: advisory lock, calendar validation, status overlap
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_vat_return_period_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_is_active BOOLEAN;
  v_was_active BOOLEAN;
BEGIN
  -- Ownership is immutable; a return cannot be moved between businesses.
  IF TG_OP = 'UPDATE'
     AND NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION
      'VAT_RETURN_BUSINESS_IMMUTABLE: a VAT return cannot be moved to another business'
      USING ERRCODE = 'P0001';
  END IF;

  -- Calendar-month validation applies to inserts and period changes.
  IF TG_OP = 'INSERT'
     OR NEW.period_start_date IS DISTINCT FROM OLD.period_start_date
     OR NEW.period_end_date IS DISTINCT FROM OLD.period_end_date THEN
    IF NEW.period_start_date IS NULL
       OR NEW.period_end_date IS NULL
       OR NEW.period_start_date > NEW.period_end_date
       OR EXTRACT(DAY FROM NEW.period_start_date) <> 1
       OR NEW.period_end_date <> (
         (date_trunc('month', NEW.period_start_date) + INTERVAL '1 month - 1 day')::date
       ) THEN
      RAISE EXCEPTION
        'VAT_RETURN_PERIOD_INVALID: VAT return periods must be full calendar months'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Serialize overlap decisions per business. This closes the concurrent
  -- insert race: the second transaction waits, then sees the first commit.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.business_id::text || ':vat_return_overlap', 0)
  );

  v_is_active := COALESCE(NEW.status, 'draft') IN ('draft', 'submitted', 'paid')
                 AND NEW.deleted_at IS NULL;

  IF TG_OP = 'UPDATE' THEN
    v_was_active := COALESCE(OLD.status, 'draft') IN ('draft', 'submitted', 'paid')
                    AND OLD.deleted_at IS NULL;

    -- Unrelated edits (notes, payment metadata, status unchanged) do not
    -- re-open historical overlaps.
    IF NEW.period_start_date IS NOT DISTINCT FROM OLD.period_start_date
       AND NEW.period_end_date IS NOT DISTINCT FROM OLD.period_end_date
       AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
       AND COALESCE(NEW.status, 'draft') = COALESCE(OLD.status, 'draft') THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NOT v_is_active THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vat_returns v
    WHERE v.business_id = NEW.business_id
      AND v.id <> NEW.id
      AND v.deleted_at IS NULL
      AND COALESCE(v.status, 'draft') IN ('draft', 'submitted', 'paid')
      AND NEW.period_start_date <= v.period_end_date
      AND v.period_start_date <= NEW.period_end_date
  ) THEN
    RAISE EXCEPTION
      'VAT_RETURN_PERIOD_OVERLAP: VAT return period % to % overlaps an existing active return for this business',
      NEW.period_start_date, NEW.period_end_date
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_vat_return_period_overlap() IS
  'Serializes VAT overlap decisions per business, rejects non-calendar periods and prevents any active return from overlapping another. Existing historical rows are not rewritten.';

DROP TRIGGER IF EXISTS trg_vat_returns_period_overlap ON public.vat_returns;
CREATE TRIGGER trg_vat_returns_period_overlap
  BEFORE INSERT OR UPDATE ON public.vat_returns
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_vat_return_period_overlap();

-- ----------------------------------------------------------------------------
-- 5) Paid return must link to a real VAT payment journal for the same return
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_vat_paid_without_journal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.status = 'paid'
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'paid'
     ) THEN
    IF NEW.payment_journal_entry_id IS NULL THEN
      RAISE EXCEPTION
        'VAT_PAYMENT_JOURNAL_REQUIRED: a VAT filing cannot be marked paid without a linked payment journal'
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.journal_entries je
      WHERE je.id = NEW.payment_journal_entry_id
        AND je.business_id = NEW.business_id
        AND je.reference_type = 'vat_return_payment'
        AND je.reference_id = NEW.id
    ) THEN
      RAISE EXCEPTION
        'VAT_PAYMENT_JOURNAL_INVALID: the linked journal is not a VAT payment journal for this filing and business'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_vat_paid_without_journal()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_vat_paid_without_journal()
  TO postgres;

DROP TRIGGER IF EXISTS trg_prevent_vat_paid_without_journal ON public.vat_returns;
CREATE TRIGGER trg_prevent_vat_paid_without_journal
  BEFORE INSERT OR UPDATE ON public.vat_returns
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_vat_paid_without_journal();
