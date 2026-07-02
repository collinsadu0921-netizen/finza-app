-- ============================================================================
-- Workday_50 operational list hot paths (510)
-- ============================================================================
-- Fixes full-business payment/credit aggregation on overdue list, bills list
-- double-query + SELECT *, and unbounded payroll runs list.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Supporting indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payments_business_invoice
  ON public.payments (business_id, invoice_id)
  WHERE deleted_at IS NULL
    AND invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_invoice_id
  ON public.payments (invoice_id)
  WHERE deleted_at IS NULL
    AND invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_business_status_due_date
  ON public.invoices (business_id, status, due_date DESC)
  WHERE deleted_at IS NULL
    AND due_date IS NOT NULL
    AND status <> 'draft';

CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id
  ON public.bill_payments (bill_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_runs_business_month_desc
  ON public.payroll_runs (business_id, payroll_month DESC)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_payments_business_invoice IS
  'Operational overdue: per-invoice payment lookup scoped by business.';

COMMENT ON INDEX idx_payments_invoice_id IS
  'Operational overdue: lateral payment sum by invoice_id.';

COMMENT ON INDEX idx_invoices_business_status_due_date IS
  'Operational overdue: past-due candidate scan by business.';

COMMENT ON INDEX idx_bill_payments_bill_id IS
  'Bills list: aggregate paid amounts for page bill IDs.';

COMMENT ON INDEX idx_payroll_runs_business_month_desc IS
  'Payroll runs list: business-scoped month sort with limit.';

-- ---------------------------------------------------------------------------
-- 2. Overdue invoices — per-invoice lateral outstanding (no full-business agg)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_operational_overdue_invoices_page(
  p_business_id UUID,
  p_limit INT,
  p_offset INT,
  p_customer_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_search TEXT := NULLIF(TRIM(p_search), '');
  v_result JSONB;
BEGIN
  WITH candidates AS (
    SELECT
      i.id,
      i.total,
      i.issue_date
    FROM invoices i
    WHERE i.business_id = p_business_id
      AND i.deleted_at IS NULL
      AND i.status <> 'draft'
      AND i.due_date IS NOT NULL
      AND i.due_date < CURRENT_DATE
      AND (p_customer_id IS NULL OR i.customer_id = p_customer_id)
      AND (p_start_date IS NULL OR i.issue_date >= p_start_date)
      AND (p_end_date IS NULL OR i.issue_date <= p_end_date)
      AND (
        v_search IS NULL
        OR i.invoice_number ILIKE '%' || v_search || '%'
        OR COALESCE(i.notes, '') ILIKE '%' || v_search || '%'
        OR EXISTS (
          SELECT 1
          FROM customers c
          WHERE c.id = i.customer_id
            AND c.business_id = p_business_id
            AND c.deleted_at IS NULL
            AND c.name ILIKE '%' || v_search || '%'
        )
      )
  ),
  with_outstanding AS (
    SELECT
      c.id,
      c.issue_date,
      GREATEST(
        0,
        COALESCE(c.total, 0)
          - COALESCE((
              SELECT SUM(p.amount)
              FROM payments p
              WHERE p.invoice_id = c.id
                AND p.business_id = p_business_id
                AND p.deleted_at IS NULL
            ), 0)
          - COALESCE((
              SELECT SUM(cn.total)
              FROM credit_notes cn
              WHERE cn.invoice_id = c.id
                AND cn.business_id = p_business_id
                AND cn.status = 'applied'
                AND cn.deleted_at IS NULL
            ), 0)
      ) AS outstanding
    FROM candidates c
  ),
  overdue AS (
    SELECT wo.id, wo.issue_date
    FROM with_outstanding wo
    WHERE wo.outstanding > 0
  ),
  paged AS (
    SELECT id
    FROM overdue
    ORDER BY issue_date DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT COUNT(*)::BIGINT FROM overdue),
    'invoice_ids', COALESCE(
      (SELECT jsonb_agg(id) FROM (SELECT id FROM paged) sub),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_operational_overdue_invoices_page(UUID, INT, INT, UUID, DATE, DATE, TEXT) IS
  'Paginated overdue invoice IDs using per-invoice payment/credit lookups (no full-business aggregation).';

-- ---------------------------------------------------------------------------
-- 3. Bills list — single SQL page with paid/balance aggregates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_bills_list_page(
  p_business_id UUID,
  p_limit INT,
  p_offset INT,
  p_supplier_name TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset INT := GREATEST(0, COALESCE(p_offset, 0));
  v_supplier TEXT := NULLIF(TRIM(p_supplier_name), '');
  v_status TEXT := NULLIF(TRIM(p_status), '');
  v_search TEXT := NULLIF(TRIM(p_search), '');
  v_result JSONB;
BEGIN
  WITH filtered AS (
    SELECT b.*
    FROM bills b
    WHERE b.business_id = p_business_id
      AND b.deleted_at IS NULL
      AND (v_supplier IS NULL OR b.supplier_name ILIKE '%' || v_supplier || '%')
      AND (v_status IS NULL OR b.status = v_status)
      AND (p_start_date IS NULL OR b.issue_date >= p_start_date)
      AND (p_end_date IS NULL OR b.issue_date <= p_end_date)
      AND (
        v_search IS NULL
        OR b.bill_number ILIKE '%' || v_search || '%'
        OR b.supplier_name ILIKE '%' || v_search || '%'
      )
  ),
  with_balances AS (
    SELECT
      f.id,
      f.supplier_name,
      f.supplier_phone,
      f.supplier_email,
      f.bill_number,
      f.issue_date,
      f.due_date,
      f.status,
      f.subtotal,
      f.nhil,
      f.getfund,
      f.covid,
      f.vat,
      f.total_tax,
      f.total,
      f.notes,
      f.attachment_path,
      f.paid_at,
      f.created_at,
      f.updated_at,
      f.currency_code,
      f.currency_symbol,
      f.fx_rate,
      f.home_currency_code,
      f.wht_applicable,
      f.wht_amount,
      f.bill_type,
      COALESCE(bp.paid, 0)::NUMERIC AS total_paid,
      GREATEST(
        0,
        COALESCE(f.total, 0)
          - CASE
              WHEN COALESCE(f.wht_applicable, FALSE) AND COALESCE(f.wht_amount, 0) > 0
                THEN f.wht_amount
              ELSE 0
            END
          - COALESCE(bp.paid, 0)
      )::NUMERIC AS balance
    FROM filtered f
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(p.amount), 0) AS paid
      FROM bill_payments p
      WHERE p.bill_id = f.id
        AND p.deleted_at IS NULL
    ) bp ON TRUE
  ),
  paged AS (
    SELECT *
    FROM with_balances
    ORDER BY issue_date DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT COUNT(*)::BIGINT FROM filtered),
    'bills', COALESCE(
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.issue_date DESC) FROM paged p),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_bills_list_page(UUID, INT, INT, TEXT, TEXT, DATE, DATE, TEXT) IS
  'Paginated bills list with per-page payment aggregates (replaces SELECT * + second query).';

GRANT EXECUTE ON FUNCTION public.get_operational_overdue_invoices_page(
  UUID, INT, INT, UUID, DATE, DATE, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_bills_list_page(
  UUID, INT, INT, TEXT, TEXT, DATE, DATE, TEXT
) TO authenticated;
