-- Expense monetary immutability (post-deploy hardening).
--
-- Apply this only after every app instance uses update_expense_with_repost.
-- The supported RPC runs as its SECURITY DEFINER owner and sets the
-- transaction-local flag. A direct PostgREST/authenticated update cannot be
-- the function owner, so setting the flag alone is not a bypass.

CREATE OR REPLACE FUNCTION public.prevent_posted_expense_monetary_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner text;
BEGIN
  SELECT pg_get_userbyid(p.proowner)
  INTO v_owner
  FROM pg_proc p
  WHERE p.oid = 'public.update_expense_with_repost(uuid,jsonb,uuid)'::regprocedure;

  IF current_setting('finza.expense_repost', true) = 'on'
     AND v_owner IS NOT NULL
     AND current_user = v_owner THEN
    RETURN NEW;
  END IF;

  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.nhil IS DISTINCT FROM OLD.nhil
     OR NEW.getfund IS DISTINCT FROM OLD.getfund
     OR NEW.covid IS DISTINCT FROM OLD.covid
     OR NEW.vat IS DISTINCT FROM OLD.vat
     OR NEW.total IS DISTINCT FROM OLD.total
     OR NEW.tax_lines IS DISTINCT FROM OLD.tax_lines
     OR NEW.tax_pricing_mode IS DISTINCT FROM OLD.tax_pricing_mode
     OR NEW.date IS DISTINCT FROM OLD.date
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.fx_rate IS DISTINCT FROM OLD.fx_rate
     OR NEW.home_currency_total IS DISTINCT FROM OLD.home_currency_total
  THEN
    RAISE EXCEPTION 'POSTED_EXPENSE_IMMUTABLE: use the supported expense edit/repost workflow to change a posted expense.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_prevent_posted_expense_monetary_change ON public.expenses;
CREATE TRIGGER trigger_prevent_posted_expense_monetary_change
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_posted_expense_monetary_change();
