-- ============================================================================
-- Production migration 594: Fix VAT payment trigger error-permission failure
--
-- Adapted from tested staging migration
-- 588_fix_vat_payment_trigger_error_permissions.sql.
--
-- Migration 593's vat_returns guard called the internal
-- raise_vat_payment_error() helper from a non-SECURITY DEFINER trigger.
-- PostgreSQL therefore checked EXECUTE as the authenticated caller, which is
-- intentionally not granted. The trigger now raises its own exception inline;
-- the internal helper remains unexposed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_vat_paid_without_journal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'paid'
     AND NEW.payment_journal_entry_id IS NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'paid'
     )
  THEN
    RAISE EXCEPTION
      USING ERRCODE = 'P0001',
            MESSAGE = 'VAT_PAYMENT_JOURNAL_REQUIRED',
            DETAIL = jsonb_build_object(
              'message',
              'A VAT filing cannot be marked paid without a linked payment journal. Use the Record payment action.',
              'vat_return_id',
              NEW.id
            )::TEXT;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_vat_paid_without_journal() IS
  'Blocks transitions into paid without a linked VAT payment journal. Raises inline so authenticated updates do not need EXECUTE on the internal error helper.';

REVOKE ALL ON FUNCTION public.prevent_vat_paid_without_journal()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_vat_paid_without_journal()
  TO postgres;
