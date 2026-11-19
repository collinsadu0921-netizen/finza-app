-- Source-aware VAT tax-account extraction.
--
-- Debit/credit is not enough: a credit-note debit reduces output tax, while a
-- bill/expense debit is input tax; a reversal must reverse the original
-- classification; a VAT-return payment is a settlement, not input tax.
--
-- This function keeps the existing totals (period_debits/period_credits,
-- opening/closing) for compatibility and adds classified movements. The
-- application helper uses the classified fields when present.

CREATE OR REPLACE FUNCTION public.extract_tax_return_from_ledger(
  p_business_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  tax_account_codes TEXT[] := ARRAY['2100', '2110', '2120', '2130'];
  tax_names TEXT[] := ARRAY['VAT', 'NHIL', 'GETFund', 'COVID'];
  result JSONB := '[]'::JSONB;
  tax_code TEXT;
  tax_name TEXT;
  account_id_val UUID;
  account_code TEXT;
  opening_balance NUMERIC;
  period_debits NUMERIC;
  period_credits NUMERIC;
  closing_balance NUMERIC;
  output_debits NUMERIC;
  output_credits NUMERIC;
  input_debits NUMERIC;
  input_credits NUMERIC;
  settlement_debits NUMERIC;
  settlement_credits NUMERIC;
  unclassified_debits NUMERIC;
  unclassified_credits NUMERIC;
  tax_summary JSONB;
  idx INTEGER;
BEGIN
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Start date (%) must be before or equal to end date (%)', p_start_date, p_end_date;
  END IF;

  FOR idx IN 1..array_length(tax_account_codes, 1)
  LOOP
    account_code := tax_account_codes[idx];
    tax_name := tax_names[idx];

    IF account_code = '2130' AND p_start_date >= '2026-01-01'::DATE THEN
      CONTINUE;
    END IF;

    SELECT id INTO account_id_val
    FROM accounts
    WHERE business_id = p_business_id
      AND code = account_code
      AND deleted_at IS NULL
    LIMIT 1;

    IF account_id_val IS NULL THEN
      tax_summary := jsonb_build_object(
        'tax_code', tax_name,
        'account_code', account_code,
        'opening_balance', 0,
        'period_debits', 0,
        'period_credits', 0,
        'closing_balance', 0,
        'output_debits', 0,
        'output_credits', 0,
        'input_debits', 0,
        'input_credits', 0,
        'settlement_debits', 0,
        'settlement_credits', 0,
        'unclassified_debits', 0,
        'unclassified_credits', 0
      );
      result := result || jsonb_build_array(tax_summary);
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
    INTO opening_balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.business_id = p_business_id
      AND jel.account_id = account_id_val
      AND je.date < p_start_date;

    SELECT
      COALESCE(SUM(x.debit), 0),
      COALESCE(SUM(x.credit), 0),
      COALESCE(SUM(x.debit) FILTER (WHERE x.tax_class = 'output'), 0),
      COALESCE(SUM(x.credit) FILTER (WHERE x.tax_class = 'output'), 0),
      COALESCE(SUM(x.debit) FILTER (WHERE x.tax_class = 'input'), 0),
      COALESCE(SUM(x.credit) FILTER (WHERE x.tax_class = 'input'), 0),
      COALESCE(SUM(x.debit) FILTER (WHERE x.tax_class = 'settlement'), 0),
      COALESCE(SUM(x.credit) FILTER (WHERE x.tax_class = 'settlement'), 0),
      COALESCE(SUM(x.debit) FILTER (WHERE x.tax_class = 'unclassified'), 0),
      COALESCE(SUM(x.credit) FILTER (WHERE x.tax_class = 'unclassified'), 0)
    INTO
      period_debits, period_credits,
      output_debits, output_credits,
      input_debits, input_credits,
      settlement_debits, settlement_credits,
      unclassified_debits, unclassified_credits
    FROM (
      SELECT
        jel.debit,
        jel.credit,
        CASE
          WHEN je.reference_type IN (
            'invoice', 'sale', 'sale_return', 'sale_void', 'refund', 'credit_note'
          ) THEN 'output'
          WHEN je.reference_type IN (
            'bill', 'expense', 'expense_reversal', 'purchase', 'purchase_return', 'supplier_bill'
          ) THEN 'input'
          WHEN je.reference_type IN (
            'vat_return_payment', 'vat_payment', 'tax_payment'
          ) THEN 'settlement'
          WHEN je.reference_type = 'reversal' THEN
            CASE
              WHEN orig.reference_type IN (
                'invoice', 'sale', 'sale_return', 'sale_void', 'refund', 'credit_note'
              ) THEN 'output'
              WHEN orig.reference_type IN (
                'bill', 'expense', 'purchase', 'purchase_return', 'supplier_bill'
              ) THEN 'input'
              WHEN orig.reference_type IN (
                'vat_return_payment', 'vat_payment', 'tax_payment'
              ) THEN 'settlement'
              ELSE 'unclassified'
            END
          ELSE 'unclassified'
        END AS tax_class
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      LEFT JOIN journal_entries orig ON orig.id = je.reverses_entry_id
      WHERE je.business_id = p_business_id
        AND jel.account_id = account_id_val
        AND je.date >= p_start_date
        AND je.date <= p_end_date
    ) x;

    closing_balance := opening_balance + (period_credits - period_debits);

    tax_summary := jsonb_build_object(
      'tax_code', tax_name,
      'account_code', account_code,
      'opening_balance', ROUND(opening_balance, 2),
      'period_debits', ROUND(period_debits, 2),
      'period_credits', ROUND(period_credits, 2),
      'closing_balance', ROUND(closing_balance, 2),
      'output_debits', ROUND(output_debits, 2),
      'output_credits', ROUND(output_credits, 2),
      'input_debits', ROUND(input_debits, 2),
      'input_credits', ROUND(input_credits, 2),
      'settlement_debits', ROUND(settlement_debits, 2),
      'settlement_credits', ROUND(settlement_credits, 2),
      'unclassified_debits', ROUND(unclassified_debits, 2),
      'unclassified_credits', ROUND(unclassified_credits, 2)
    );

    result := result || jsonb_build_array(tax_summary);
  END LOOP;

  RETURN result;
END;
$function$;
