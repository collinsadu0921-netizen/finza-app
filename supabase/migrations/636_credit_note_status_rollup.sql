-- Credit-note status rollup: use the NEW credit-note row instead of re-reading
-- the row inside the trigger (the statement snapshot cannot see the new status).
-- This makes draft -> applied update the invoice immediately, without waiting
-- for the invoice GET safety net.

CREATE OR REPLACE FUNCTION public.update_invoice_status_on_credit_note()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  invoice_total NUMERIC;
  payments_sum NUMERIC := 0;
  other_credits NUMERIC := 0;
  new_balance NUMERIC;
BEGIN
  IF NEW.status <> 'applied' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'applied' THEN
    RETURN NEW;
  END IF;

  SELECT total INTO invoice_total
  FROM public.invoices
  WHERE id = NEW.invoice_id
    AND deleted_at IS NULL;

  IF invoice_total IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO payments_sum
  FROM public.payments
  WHERE invoice_id = NEW.invoice_id
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(total), 0) INTO other_credits
  FROM public.credit_notes
  WHERE invoice_id = NEW.invoice_id
    AND status = 'applied'
    AND deleted_at IS NULL
    AND id <> NEW.id;

  new_balance := ROUND(invoice_total - payments_sum - other_credits - COALESCE(NEW.total, 0), 2);

  IF new_balance <= 0 THEN
    UPDATE public.invoices
    SET status = 'paid',
        paid_at = COALESCE(paid_at, NOW())
    WHERE id = NEW.invoice_id
      AND status NOT IN ('cancelled', 'void');
  ELSIF new_balance < invoice_total THEN
    UPDATE public.invoices
    SET status = 'partially_paid'
    WHERE id = NEW.invoice_id
      AND status NOT IN ('paid', 'cancelled', 'void');
  ELSE
    UPDATE public.invoices
    SET status = 'sent'
    WHERE id = NEW.invoice_id
      AND status NOT IN ('paid', 'cancelled', 'void');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_update_invoice_on_credit_note ON public.credit_notes;
CREATE TRIGGER trigger_update_invoice_on_credit_note
  AFTER INSERT OR UPDATE OF status ON public.credit_notes
  FOR EACH ROW
  WHEN (NEW.status = 'applied')
  EXECUTE FUNCTION public.update_invoice_status_on_credit_note();
