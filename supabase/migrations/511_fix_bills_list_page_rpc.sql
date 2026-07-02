-- ============================================================================
-- Fix get_bills_list_page runtime errors (511)
-- ============================================================================
-- 510 bills list returned 500 under load: jsonb_agg(to_jsonb(p)) on CTE rows
-- and bill_payments alias "p" are fragile in plpgsql. Use row_to_json + f.*
-- so response shape matches prior SELECT * list (all bill columns + totals).
-- ============================================================================

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
      f.*,
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
      SELECT COALESCE(SUM(pay.amount), 0) AS paid
      FROM bill_payments pay
      WHERE pay.bill_id = f.id
        AND pay.deleted_at IS NULL
    ) bp ON TRUE
  ),
  paged AS (
    SELECT wb.*
    FROM with_balances wb
    ORDER BY wb.issue_date DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT COUNT(*)::BIGINT FROM filtered),
    'bills', COALESCE(
      (
        SELECT jsonb_agg(row_to_json(pg)::jsonb ORDER BY pg.issue_date DESC)
        FROM paged pg
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_bills_list_page(UUID, INT, INT, TEXT, TEXT, DATE, DATE, TEXT) IS
  'Paginated bills list with per-page payment aggregates. 511: row_to_json + f.* for stable JSON.';

GRANT EXECUTE ON FUNCTION public.get_bills_list_page(
  UUID, INT, INT, TEXT, TEXT, DATE, DATE, TEXT
) TO authenticated;
