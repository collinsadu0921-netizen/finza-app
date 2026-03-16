-- Include payment and credit_note JEs in per-invoice AR balance.
-- Reconciliation and period close expect ledger AR = invoice - payments - applied credits.
-- Previously get_ar_balances_by_invoice only summed JEs with reference_type = 'invoice',
-- so payment and credit_note AR movements were missing and reconciliation failed.
-- No schema changes; only replace the RPC body.

CREATE OR REPLACE FUNCTION get_ar_balances_by_invoice(
  p_business_id UUID,
  p_period_id UUID,
  p_invoice_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL
)
RETURNS TABLE(invoice_id UUID, balance NUMERIC)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_period_start DATE;
  v_period_end   DATE;
  v_ar_account_id UUID;
  v_ar_code TEXT;
BEGIN
  SELECT ap.period_start, ap.period_end
  INTO v_period_start, v_period_end
  FROM accounting_periods ap
  WHERE ap.id = p_period_id
    AND ap.business_id = p_business_id;

  IF v_period_start IS NULL OR v_period_end IS NULL THEN
    RETURN;
  END IF;

  SELECT m.account_code INTO v_ar_code
  FROM chart_of_accounts_control_map m
  WHERE m.business_id = p_business_id
    AND m.control_key = 'AR'
  LIMIT 1;

  IF v_ar_code IS NOT NULL THEN
    SELECT a.id INTO v_ar_account_id
    FROM accounts a
    WHERE a.business_id = p_business_id
      AND a.code = v_ar_code
      AND a.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_ar_account_id IS NULL THEN
    SELECT a.id INTO v_ar_account_id
    FROM accounts a
    WHERE a.business_id = p_business_id
      AND a.code IN ('1100', '1200')
      AND a.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_ar_account_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH je_with_invoice AS (
    SELECT
      je.id AS journal_entry_id,
      CASE je.reference_type
        WHEN 'invoice' THEN je.reference_id
        WHEN 'payment' THEN (SELECT p.invoice_id FROM payments p WHERE p.id = je.reference_id AND p.deleted_at IS NULL LIMIT 1)
        WHEN 'credit_note' THEN (SELECT cn.invoice_id FROM credit_notes cn WHERE cn.id = je.reference_id AND cn.status = 'applied' AND cn.deleted_at IS NULL LIMIT 1)
        ELSE NULL
      END AS inv_id
    FROM journal_entries je
    WHERE je.business_id = p_business_id
      AND je.reference_type IN ('invoice', 'payment', 'credit_note')
      AND je.date >= v_period_start
      AND je.date <= v_period_end
  ),
  filtered AS (
    SELECT pe.journal_entry_id, pe.inv_id
    FROM je_with_invoice pe
    WHERE pe.inv_id IS NOT NULL
      AND (p_invoice_id IS NULL OR pe.inv_id = p_invoice_id)
      AND (p_customer_id IS NULL OR EXISTS (
        SELECT 1 FROM invoices i
        WHERE i.id = pe.inv_id
          AND i.business_id = p_business_id
          AND i.customer_id = p_customer_id
      ))
  ),
  line_totals AS (
    SELECT
      f.inv_id,
      SUM(COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)) AS bal
    FROM filtered f
    JOIN journal_entry_lines jel
      ON jel.journal_entry_id = f.journal_entry_id
      AND jel.account_id = v_ar_account_id
    GROUP BY f.inv_id
  )
  SELECT
    lt.inv_id AS invoice_id,
    lt.bal AS balance
  FROM line_totals lt;
END;
$$;

COMMENT ON FUNCTION get_ar_balances_by_invoice IS
'Returns per-invoice AR ledger balances for a period. Includes invoice, payment, and credit_note JEs so balance = invoice AR - payment AR - credit_note AR. Period-native. Optional filters: p_invoice_id, p_customer_id.';
