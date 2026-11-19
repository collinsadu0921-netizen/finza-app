-- Payment status synchronization and atomic payment-reversal state.
--
-- 1. Invoice status must recalculate when a payment is soft-deleted. The old
--    trigger only fired while `new.deleted_at IS NULL`, so payment reversal left
--    the invoice at partially_paid until someone opened it.
-- 2. When a reversal journal for a payment is posted, the payment row and the
--    invoice status update in the same transaction, preventing a ledger/payment
--    split if the route fails between the two statements.

CREATE OR REPLACE FUNCTION public.sync_payment_reversal_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_original_type TEXT;
  v_payment_id UUID;
BEGIN
  IF NEW.reference_type IS DISTINCT FROM 'reversal' OR NEW.reverses_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT reference_type, reference_id
  INTO v_original_type, v_payment_id
  FROM public.journal_entries
  WHERE id = NEW.reverses_entry_id;

  IF v_original_type = 'payment' AND v_payment_id IS NOT NULL THEN
    UPDATE public.payments
    SET deleted_at = COALESCE(deleted_at, NOW()),
        updated_at = NOW()
    WHERE id = v_payment_id
      AND deleted_at IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_sync_payment_reversal_state ON public.journal_entries;
CREATE TRIGGER trigger_sync_payment_reversal_state
  AFTER INSERT ON public.journal_entries
  FOR EACH ROW
  WHEN (NEW.reference_type = 'reversal')
  EXECUTE FUNCTION public.sync_payment_reversal_state();

DROP TRIGGER IF EXISTS trigger_update_invoice_status ON public.payments;
CREATE TRIGGER trigger_update_invoice_status
  AFTER INSERT OR UPDATE OF deleted_at, amount, invoice_id ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_invoice_status_with_credits();
