-- ============================================================================
-- Invoice customer approval workflow (ledger-neutral metadata)
-- ============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS customer_approval_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS customer_approval_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_approval_note TEXT,
  ADD COLUMN IF NOT EXISTS customer_approval_method TEXT,
  ADD COLUMN IF NOT EXISTS customer_approval_requested_by UUID,
  ADD COLUMN IF NOT EXISTS customer_approval_updated_by UUID;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_customer_approval_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_customer_approval_status_check
  CHECK (
    customer_approval_status IN (
      'not_requested',
      'pending_approval',
      'approved',
      'rejected'
    )
  );

CREATE INDEX IF NOT EXISTS idx_invoices_business_customer_approval_status
  ON public.invoices (business_id, customer_approval_status);

COMMENT ON COLUMN public.invoices.customer_approval_status IS
  'Customer approval workflow marker only; does not affect financial status or ledger.';

-- Optional approval filter for operational overdue invoice list pagination.
CREATE OR REPLACE FUNCTION public.get_operational_overdue_invoices_page(
  p_business_id UUID,
  p_limit INT,
  p_offset INT,
  p_customer_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_customer_approval_status TEXT DEFAULT NULL
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
  v_approval TEXT := NULLIF(TRIM(p_customer_approval_status), '');
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
      AND (v_approval IS NULL OR i.customer_approval_status = v_approval)
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

COMMENT ON FUNCTION public.get_operational_overdue_invoices_page(UUID, INT, INT, UUID, DATE, DATE, TEXT, TEXT) IS
  'Paginated overdue invoice IDs using operational outstanding; optional customer_approval_status filter.';

GRANT EXECUTE ON FUNCTION public.get_operational_overdue_invoices_page(
  UUID, INT, INT, UUID, DATE, DATE, TEXT, TEXT
) TO authenticated;
