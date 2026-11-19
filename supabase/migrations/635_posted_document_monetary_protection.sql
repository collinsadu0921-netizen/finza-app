-- Posted-document monetary protection.
--
-- Invoices and bills: monetary fields are immutable once the document leaves
-- draft. Status, paid_at and other non-monetary fields remain writable so the
-- invoice status safety net and payment/credit-note rollups still work.
--
-- Expenses: every expense posts on insert, so monetary edits must go through the
-- supported update_expense_with_repost RPC. That RPC sets a transaction-local
-- flag, updates the row and reverses/reposts the journal atomically. A direct
-- UPDATE outside that workflow is rejected.

CREATE OR REPLACE FUNCTION public.prevent_posted_invoice_monetary_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status = 'draft' AND OLD.sent_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.subtotal IS DISTINCT FROM OLD.subtotal
     OR NEW.nhil IS DISTINCT FROM OLD.nhil
     OR NEW.getfund IS DISTINCT FROM OLD.getfund
     OR NEW.covid IS DISTINCT FROM OLD.covid
     OR NEW.vat IS DISTINCT FROM OLD.vat
     OR NEW.total_tax IS DISTINCT FROM OLD.total_tax
     OR NEW.total IS DISTINCT FROM OLD.total
     OR NEW.tax_lines IS DISTINCT FROM OLD.tax_lines
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.fx_rate IS DISTINCT FROM OLD.fx_rate
     OR NEW.home_currency_total IS DISTINCT FROM OLD.home_currency_total
  THEN
    RAISE EXCEPTION 'POSTED_INVOICE_IMMUTABLE: monetary fields cannot be changed after issue. Use a credit note or the supported correction workflow.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_prevent_posted_invoice_monetary_change ON public.invoices;
CREATE TRIGGER trigger_prevent_posted_invoice_monetary_change
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_posted_invoice_monetary_change();

CREATE OR REPLACE FUNCTION public.prevent_posted_bill_monetary_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF NEW.subtotal IS DISTINCT FROM OLD.subtotal
     OR NEW.nhil IS DISTINCT FROM OLD.nhil
     OR NEW.getfund IS DISTINCT FROM OLD.getfund
     OR NEW.covid IS DISTINCT FROM OLD.covid
     OR NEW.vat IS DISTINCT FROM OLD.vat
     OR NEW.total_tax IS DISTINCT FROM OLD.total_tax
     OR NEW.total IS DISTINCT FROM OLD.total
     OR NEW.tax_lines IS DISTINCT FROM OLD.tax_lines
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.fx_rate IS DISTINCT FROM OLD.fx_rate
     OR NEW.home_currency_total IS DISTINCT FROM OLD.home_currency_total
     OR NEW.wht_amount IS DISTINCT FROM OLD.wht_amount
     OR NEW.wht_rate IS DISTINCT FROM OLD.wht_rate
     OR NEW.wht_rate_code IS DISTINCT FROM OLD.wht_rate_code
     OR NEW.cif_value IS DISTINCT FROM OLD.cif_value
     OR NEW.import_duty_amount IS DISTINCT FROM OLD.import_duty_amount
     OR NEW.ecowas_levy IS DISTINCT FROM OLD.ecowas_levy
     OR NEW.au_levy IS DISTINCT FROM OLD.au_levy
     OR NEW.exim_levy IS DISTINCT FROM OLD.exim_levy
     OR NEW.sil_levy IS DISTINCT FROM OLD.sil_levy
     OR NEW.examination_fee IS DISTINCT FROM OLD.examination_fee
     OR NEW.clearing_agent_fee IS DISTINCT FROM OLD.clearing_agent_fee
  THEN
    RAISE EXCEPTION 'POSTED_BILL_IMMUTABLE: monetary fields cannot be changed after posting. Use the supported bill correction workflow.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_prevent_posted_bill_monetary_change ON public.bills;
CREATE TRIGGER trigger_prevent_posted_bill_monetary_change
  BEFORE UPDATE ON public.bills
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_posted_bill_monetary_change();

CREATE OR REPLACE FUNCTION public.build_expense_tax_lines(
  p_date date,
  p_nhil numeric,
  p_getfund numeric,
  p_covid numeric,
  p_vat numeric
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  WITH pre AS (
    SELECT COALESCE(p_date < DATE '2026-01-01', false) AS is_pre
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', s.code,
    'name', s.name,
    'rate', s.rate,
    'amount', ROUND(s.amount, 2),
    'ledger_account_code', s.account,
    'ledger_side', 'debit',
    'is_creditable_input', s.creditable,
    'absorbed_to_cost', s.absorbed
  ) ORDER BY s.ord), '[]'::jsonb)
  FROM (
    SELECT 1 AS ord, 'NHIL'::text AS code, 'NHIL'::text AS name, 0.025 AS rate,
      COALESCE(p_nhil, 0) AS amount,
      CASE WHEN pre.is_pre THEN '5100' ELSE '2110' END AS account,
      NOT pre.is_pre AS creditable, pre.is_pre AS absorbed
    FROM pre
    WHERE COALESCE(p_nhil, 0) > 0
    UNION ALL
    SELECT 2, 'GETFUND', 'GETFund', 0.025, COALESCE(p_getfund, 0),
      CASE WHEN pre.is_pre THEN '5100' ELSE '2120' END,
      NOT pre.is_pre, pre.is_pre
    FROM pre
    WHERE COALESCE(p_getfund, 0) > 0
    UNION ALL
    SELECT 3, 'COVID', 'COVID Levy', 0.01, COALESCE(p_covid, 0),
      CASE WHEN pre.is_pre THEN '5100' ELSE '2100' END,
      false, pre.is_pre
    FROM pre
    WHERE COALESCE(p_covid, 0) > 0
    UNION ALL
    SELECT 4, 'VAT', 'VAT', 0.15, COALESCE(p_vat, 0),
      '2100', true, false
    FROM pre
    WHERE COALESCE(p_vat, 0) > 0
  ) s;
$function$;

CREATE OR REPLACE FUNCTION public.update_expense_with_repost(
  p_expense_id uuid,
  p_patch jsonb,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_business_id uuid;
  v_expense public.expenses%ROWTYPE;
  v_current_je uuid;
  v_reversal_lines jsonb;
  v_je_date date;
  v_role text;
  v_custom jsonb;
  v_readonly boolean;
  v_revoked boolean;
BEGIN
  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found: %', p_expense_id USING ERRCODE = 'P0001';
  END IF;

  v_business_id := v_expense.business_id;

  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'EXPENSE_EDIT_FORBIDDEN: actor mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT bu.role, COALESCE(bu.accountant_readonly, false), COALESCE(bu.custom_permissions, '{}'::jsonb)
  INTO v_role, v_readonly, v_custom
  FROM public.business_users bu
  WHERE bu.business_id = v_business_id
    AND bu.user_id = p_user_id
  LIMIT 1;

  IF v_role IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = v_business_id AND b.owner_id = p_user_id
    ) THEN
      v_role := 'owner';
    ELSE
      RAISE EXCEPTION 'EXPENSE_EDIT_FORBIDDEN: no access to this business' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Expense edits post to the ledger, so the caller must be able to post:
  -- owner, admin or non-readonly accountant. Manager/employee/cashier rights
  -- to create expenses do not grant journal-posting authority. An explicit
  -- expenses.create revocation still wins.
  IF v_role <> 'owner' THEN
    IF v_role NOT IN ('admin', 'accountant') THEN
      RAISE EXCEPTION 'EXPENSE_EDIT_FORBIDDEN: owner, admin or accountant authority is required to edit a posted expense'
        USING ERRCODE = '42501';
    END IF;
    IF v_role = 'accountant' AND v_readonly THEN
      RAISE EXCEPTION 'EXPENSE_EDIT_FORBIDDEN: accountant access is read-only' USING ERRCODE = '42501';
    END IF;
    v_revoked := COALESCE(v_custom->'revoked', '[]'::jsonb) ? 'expenses.create';
    IF v_revoked THEN
      RAISE EXCEPTION 'EXPENSE_EDIT_FORBIDDEN: expenses.create permission has been revoked' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM set_config('finza.expense_repost', 'on', true);

  UPDATE public.expenses
  SET
    supplier = COALESCE(p_patch->>'supplier', supplier),
    category_id = CASE WHEN p_patch ? 'category_id' THEN NULLIF(p_patch->>'category_id','')::uuid ELSE category_id END,
    amount = COALESCE((p_patch->>'amount')::numeric, amount),
    nhil = COALESCE((p_patch->>'nhil')::numeric, nhil),
    getfund = COALESCE((p_patch->>'getfund')::numeric, getfund),
    covid = COALESCE((p_patch->>'covid')::numeric, covid),
    vat = COALESCE((p_patch->>'vat')::numeric, vat),
    total = COALESCE((p_patch->>'total')::numeric, total),
    tax_pricing_mode = COALESCE(p_patch->>'tax_pricing_mode', tax_pricing_mode),
    tax_lines = CASE
      WHEN p_patch ? 'tax_lines' THEN p_patch->'tax_lines'
      WHEN tax_lines IS NULL THEN public.build_expense_tax_lines(
        COALESCE((p_patch->>'date')::date, date),
        COALESCE((p_patch->>'nhil')::numeric, nhil),
        COALESCE((p_patch->>'getfund')::numeric, getfund),
        COALESCE((p_patch->>'covid')::numeric, covid),
        COALESCE((p_patch->>'vat')::numeric, vat)
      )
      ELSE tax_lines
    END,
    date = COALESCE((p_patch->>'date')::date, date),
    notes = CASE WHEN p_patch ? 'notes' THEN NULLIF(p_patch->>'notes','') ELSE notes END,
    receipt_path = CASE WHEN p_patch ? 'receipt_path' THEN NULLIF(p_patch->>'receipt_path','') ELSE receipt_path END,
    currency_code = CASE WHEN p_patch ? 'currency_code' THEN NULLIF(p_patch->>'currency_code','') ELSE currency_code END,
    currency_symbol = CASE WHEN p_patch ? 'currency_symbol' THEN NULLIF(p_patch->>'currency_symbol','') ELSE currency_symbol END,
    fx_rate = CASE WHEN p_patch ? 'fx_rate' THEN NULLIF(p_patch->>'fx_rate','')::numeric ELSE fx_rate END,
    home_currency_code = CASE WHEN p_patch ? 'home_currency_code' THEN NULLIF(p_patch->>'home_currency_code','') ELSE home_currency_code END,
    home_currency_total = CASE WHEN p_patch ? 'home_currency_total' THEN NULLIF(p_patch->>'home_currency_total','')::numeric ELSE home_currency_total END,
    vat_classification = CASE WHEN p_patch ? 'vat_classification' THEN NULLIF(p_patch->>'vat_classification','') ELSE vat_classification END,
    updated_at = NOW()
  WHERE id = p_expense_id;

  -- Reverse the prior live expense journal and post the updated row. Both
  -- statements are in this transaction; a period/account failure rolls back the
  -- expense update too. The inline reversal deliberately bypasses the
  -- repost_expense_to_ledger 1-second idempotency heuristic so an immediate
  -- edit after creation still reposts.
  SELECT je.id, je.date
  INTO v_current_je, v_je_date
  FROM public.journal_entries je
  WHERE je.reference_type = 'expense'
    AND je.reference_id = p_expense_id
    AND NOT EXISTS (
      SELECT 1 FROM public.journal_entries r WHERE r.reverses_entry_id = je.id
    )
  LIMIT 1;

  IF v_current_je IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'account_id', jel.account_id,
        'debit', jel.credit,
        'credit', jel.debit,
        'description', COALESCE(jel.description, '') || ' (reversal)'
      )
    ), '[]'::jsonb)
    INTO v_reversal_lines
    FROM public.journal_entry_lines jel
    WHERE jel.journal_entry_id = v_current_je;

    PERFORM public.post_journal_entry(
      v_business_id,
      v_je_date,
      'Expense edit reversal (expense ' || p_expense_id::text || ')',
      'expense_reversal',
      p_expense_id,
      v_reversal_lines,
      false,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'system', false, v_current_je
    );
  END IF;

  PERFORM public.post_expense_to_ledger(p_expense_id);

  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id;
  RETURN to_jsonb(v_expense);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_expense_with_repost(uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_expense_with_repost(uuid, jsonb, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.build_expense_tax_lines(date, numeric, numeric, numeric, numeric) FROM PUBLIC;
