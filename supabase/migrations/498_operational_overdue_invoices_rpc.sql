-- ============================================================================
-- Paginated operational overdue invoices (invoice list API)
-- ============================================================================
-- Overdue = outstanding_amount > 0 AND due_date < today, where outstanding is
-- computed from payments + applied credit notes (operational AR, not ledger).
-- get_ar_balances_by_invoice is period-scoped ledger AR and is not suitable here.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_operational_overdue_invoices_page(
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
  WITH payment_totals AS (
    SELECT p.invoice_id, COALESCE(SUM(p.amount), 0)::NUMERIC AS paid
    FROM payments p
    WHERE p.business_id = p_business_id
      AND p.deleted_at IS NULL
      AND p.invoice_id IS NOT NULL
    GROUP BY p.invoice_id
  ),
  credit_totals AS (
    SELECT cn.invoice_id, COALESCE(SUM(cn.total), 0)::NUMERIC AS credits
    FROM credit_notes cn
    WHERE cn.business_id = p_business_id
      AND cn.status = 'applied'
      AND cn.deleted_at IS NULL
      AND cn.invoice_id IS NOT NULL
    GROUP BY cn.invoice_id
  ),
  overdue AS (
    SELECT i.id, i.issue_date
    FROM invoices i
    LEFT JOIN payment_totals pt ON pt.invoice_id = i.id
    LEFT JOIN credit_totals ct ON ct.invoice_id = i.id
    WHERE i.business_id = p_business_id
      AND i.deleted_at IS NULL
      AND i.status <> 'draft'
      AND i.due_date IS NOT NULL
      AND i.due_date < CURRENT_DATE
      AND GREATEST(
        0,
        COALESCE(i.total, 0) - COALESCE(pt.paid, 0) - COALESCE(ct.credits, 0)
      ) > 0
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

COMMENT ON FUNCTION get_operational_overdue_invoices_page IS
  'Returns paginated overdue invoice IDs using operational outstanding (payments + applied credits). JSON: { total_count, invoice_ids }.';

GRANT EXECUTE ON FUNCTION public.get_operational_overdue_invoices_page(
  UUID, INT, INT, UUID, DATE, DATE, TEXT
) TO authenticated;
