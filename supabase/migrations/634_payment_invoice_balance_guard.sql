-- Database-authoritative invoice payment capacity.
--
-- The route-level remaining-balance check is only a friendly pre-check; two
-- concurrent requests can both pass it. This trigger locks the invoice row and
-- recomputes capacity from authoritative payments + applied credit notes in the
-- same transaction. WHT remains part of the gross payment amount; customer
-- credit payments use the same capacity rule.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_business_idempotency_key_uidx
  ON public.payments (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_payment_invoice_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_invoice_total NUMERIC;
  v_invoice_status TEXT;
  v_paid NUMERIC := 0;
  v_credits NUMERIC := 0;
  v_remaining NUMERIC;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.invoice_id IS NULL OR NEW.amount IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT total, status
  INTO v_invoice_total, v_invoice_status
  FROM public.invoices
  WHERE id = NEW.invoice_id
    AND business_id = NEW.business_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'PAYMENT_INVOICE_NOT_FOUND: the invoice does not belong to this business'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_invoice_status = 'draft' THEN
    RAISE EXCEPTION
      'PAYMENT_INVOICE_DRAFT: cannot record a payment against a draft invoice'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.payments
  WHERE invoice_id = NEW.invoice_id
    AND deleted_at IS NULL
    AND id <> NEW.id;

  SELECT COALESCE(SUM(total), 0) INTO v_credits
  FROM public.credit_notes
  WHERE invoice_id = NEW.invoice_id
    AND status = 'applied'
    AND deleted_at IS NULL;

  v_remaining := ROUND(COALESCE(v_invoice_total, 0) - v_paid - v_credits, 2);

  IF ROUND(NEW.amount, 2) > v_remaining + 0.01 THEN
    RAISE EXCEPTION
      'PAYMENT_EXCEEDS_INVOICE_BALANCE: payment % exceeds remaining balance %',
      ROUND(NEW.amount, 2), v_remaining
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'invoice_id', NEW.invoice_id,
              'invoice_total', ROUND(COALESCE(v_invoice_total, 0), 2),
              'payments', ROUND(v_paid, 2),
              'applied_credits', ROUND(v_credits, 2),
              'remaining', v_remaining,
              'requested', ROUND(NEW.amount, 2)
            )::TEXT;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_payment_invoice_balance ON public.payments;
CREATE TRIGGER trg_enforce_payment_invoice_balance
  BEFORE INSERT OR UPDATE OF amount, invoice_id, deleted_at ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_payment_invoice_balance();
