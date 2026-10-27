-- ============================================================================
-- Migration 595: Ledger write authorization hardening
-- ============================================================================
-- Scope:
--   - Reject anonymous ledger writes.
--   - Reject authenticated writes to a business the caller cannot access.
--   - Reject direct INSERT into journal_entries / journal_entry_lines from
--     anon and authenticated roles.
--   - Keep all legitimate posting paths working:
--       * post_journal_entry() and its compatibility wrappers
--       * invoice, bill, payment, credit-note, expense and sale posting
--       * payroll and payroll payment functions
--       * VAT/WHT/CIT and service/lending functions
--       * asset purchase/depreciation/disposal functions
--       * service-role background jobs and public payment callbacks
--
-- This migration does not modify historical ledger rows and does not change
-- posting calculations, journal dates, amounts, accounts, or source metadata.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Shared ledger write authority guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_assert_ledger_write_authorized(
  p_business_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := COALESCE(
    NULLIF(BTRIM(auth.role()), ''),
    NULLIF(BTRIM(current_setting('request.jwt.claim.role', true)), ''),
    ''
  );
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_WRITE_UNAUTHORIZED: business_id is required'
      USING ERRCODE = '42501';
  END IF;

  -- Direct database sessions and trusted migrations/jobs.
  IF session_user IN ('postgres', 'supabase_admin') THEN
    RETURN;
  END IF;

  -- Next.js/service-role and trusted background callers.
  IF v_role = 'service_role' THEN
    RETURN;
  END IF;

  IF v_role = 'anon' OR v_uid IS NULL THEN
    RAISE EXCEPTION 'LEDGER_WRITE_UNAUTHORIZED: authentication is required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'LEDGER_WRITE_FORBIDDEN: no access to this business'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.finza_assert_ledger_write_authorized(UUID) IS
  'Ledger write guard. Allows trusted database/service-role callers and authenticated business members only.';

REVOKE ALL ON FUNCTION public.finza_assert_ledger_write_authorized(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finza_assert_ledger_write_authorized(UUID)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Central database guard on the two append-only ledger tables
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_enforce_ledger_insert_authorized()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_business_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    v_business_id := NEW.business_id;
  ELSIF TG_TABLE_NAME = 'journal_entry_lines' THEN
    SELECT je.business_id
    INTO v_business_id
    FROM public.journal_entries je
    WHERE je.id = NEW.journal_entry_id;
  ELSE
    RAISE EXCEPTION 'LEDGER_WRITE_UNAUTHORIZED: unsupported ledger table %', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.finza_assert_ledger_write_authorized(v_business_id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.finza_enforce_ledger_insert_authorized() IS
  'BEFORE INSERT guard for journal_entries and journal_entry_lines. Rejects anon, non-members, and cross-business ledger writes.';

REVOKE ALL ON FUNCTION public.finza_enforce_ledger_insert_authorized()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finza_enforce_ledger_insert_authorized()
  TO service_role;

DROP TRIGGER IF EXISTS trigger_finza_enforce_ledger_insert_authorized
  ON public.journal_entries;
CREATE TRIGGER trigger_finza_enforce_ledger_insert_authorized
  BEFORE INSERT ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.finza_enforce_ledger_insert_authorized();

DROP TRIGGER IF EXISTS trigger_finza_enforce_ledger_lines_insert_authorized
  ON public.journal_entry_lines;
CREATE TRIGGER trigger_finza_enforce_ledger_lines_insert_authorized
  BEFORE INSERT ON public.journal_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.finza_enforce_ledger_insert_authorized();

-- ----------------------------------------------------------------------------
-- 3) Asset posting functions must remain callable after direct table INSERT
--    is removed. Their bodies are unchanged; only execution identity and
--    search_path are hardened. The ledger trigger still enforces business
--    authority for the asset's business.
-- ----------------------------------------------------------------------------
ALTER FUNCTION public.post_asset_purchase_to_ledger(UUID, UUID) SECURITY DEFINER;
ALTER FUNCTION public.post_asset_purchase_to_ledger(UUID, UUID)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.post_depreciation_to_ledger(UUID) SECURITY DEFINER;
ALTER FUNCTION public.post_depreciation_to_ledger(UUID)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.post_asset_disposal_to_ledger(UUID, NUMERIC, UUID) SECURITY DEFINER;
ALTER FUNCTION public.post_asset_disposal_to_ledger(UUID, NUMERIC, UUID)
  SET search_path = public, pg_catalog;

REVOKE ALL ON FUNCTION public.post_asset_purchase_to_ledger(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_asset_purchase_to_ledger(UUID, UUID)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.post_depreciation_to_ledger(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_depreciation_to_ledger(UUID)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.post_asset_disposal_to_ledger(UUID, NUMERIC, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_asset_disposal_to_ledger(UUID, NUMERIC, UUID)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Remove anonymous execution from the core manual/RPC posting surface.
--    Authenticated remains executable for the existing application paths;
--    the table trigger enforces business membership.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT,
  UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT,
  UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, UUID
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT,
  UUID, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT,
  UUID, TEXT, TEXT, TEXT, UUID
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID
) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Direct ledger table writes are service-role only.
--    journal_entries / journal_entry_lines remain append-only for the
--    service role; authenticated/anon can no longer bypass posting RPCs.
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.journal_entries
  FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.journal_entry_lines
  FROM PUBLIC, anon, authenticated;

REVOKE SELECT ON public.journal_entries FROM PUBLIC, anon;
REVOKE SELECT ON public.journal_entry_lines FROM PUBLIC, anon;

GRANT SELECT ON public.journal_entries TO authenticated;
GRANT SELECT ON public.journal_entry_lines TO authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.journal_entries
  TO service_role;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.journal_entry_lines
  TO service_role;
