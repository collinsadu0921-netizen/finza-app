-- ============================================================================
-- Operational unpaid invoices scalar (service dashboard)
-- ============================================================================
-- outstanding = GREATEST(0, invoice.total - payments - applied credit notes)
-- Excludes draft/cancelled/deleted; only counts outstanding > 0.
-- Overdue subset: due_date < CURRENT_DATE AND outstanding > 0.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_operational_unpaid_invoices_total(
  p_business_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
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
  with_outstanding AS (
    SELECT
      i.id,
      i.due_date,
      GREATEST(
        0,
        COALESCE(i.total, 0) - COALESCE(pt.paid, 0) - COALESCE(ct.credits, 0)
      ) AS outstanding
    FROM invoices i
    LEFT JOIN payment_totals pt ON pt.invoice_id = i.id
    LEFT JOIN credit_totals ct ON ct.invoice_id = i.id
    WHERE i.business_id = p_business_id
      AND i.deleted_at IS NULL
      AND i.status NOT IN ('draft', 'cancelled')
  ),
  unpaid AS (
    SELECT id, due_date, outstanding
    FROM with_outstanding
    WHERE outstanding > 0
  ),
  overdue AS (
    SELECT id, outstanding
    FROM unpaid
    WHERE due_date IS NOT NULL
      AND due_date < CURRENT_DATE
  )
  SELECT jsonb_build_object(
    'unpaid_total', COALESCE((SELECT SUM(outstanding) FROM unpaid), 0),
    'unpaid_count', (SELECT COUNT(*)::INT FROM unpaid),
    'overdue_total', COALESCE((SELECT SUM(outstanding) FROM overdue), 0),
    'overdue_count', (SELECT COUNT(*)::INT FROM overdue)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_operational_unpaid_invoices_total(UUID) IS
  'Scalar operational unpaid invoice totals for dashboard: sum/count of outstanding balances and overdue subset (payments + applied credits).';

GRANT EXECUTE ON FUNCTION public.get_operational_unpaid_invoices_total(UUID) TO authenticated;
