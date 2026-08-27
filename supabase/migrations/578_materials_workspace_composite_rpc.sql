-- ============================================================================
-- 578: Service materials workspace — one composite read RPC
-- ============================================================================
-- Why:
--   GET /api/service/materials/workspace issues 5 PostgREST SELECTs after auth:
--     businesses, accounting_firm_users, inventory page+count, inventory
--     summary (full scan), last movements for the page.
--   Inventory/movement RLS re-evaluates finza_user_can_access_business and
--   finza_business_has_service_min_tier on every row. The summary path scans
--   the whole inventory, so that is per-row amplification on a 15% mixed-k6
--   route.
--
-- What changes:
--   One SECURITY DEFINER RPC returns the current HTTP payload:
--     rows + pagination + summary
--   Authorization is evaluated ONCE from persisted identity, then the
--   existing read semantics run without per-row RLS.
--
-- Authorization:
--   auth.uid() + public.finza_user_can_access_business(p_business_id)
--   AND public.finza_business_has_service_min_tier(p_business_id, 'professional')
--   Matches table RLS. Does NOT trust app.current_business_id or JWT role GUCs.
--   service_role without auth.uid() returns the empty payload (no bypass).
--
-- Unchanged:
--   HTTP JSON contract, search/status/stock/pagination, low-stock definition,
--   cost/selling price, summary totals, app-layer viewer tier / firm skip,
--   no stock posting, no inventory mutation.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_service_materials_workspace(
  p_business_id uuid,
  p_search text DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_stock text DEFAULT 'all',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid;
  v_authorized boolean;
  v_page integer;
  v_page_size integer;
  v_search text;
  v_status text;
  v_stock text;
  v_result jsonb;
BEGIN
  v_uid := auth.uid();
  v_page := GREATEST(1, COALESCE(p_page, 1));
  v_page_size := GREATEST(1, LEAST(COALESCE(p_page_size, 25), 100));
  v_search := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_status := lower(btrim(COALESCE(p_status, 'all')));
  v_stock := lower(btrim(COALESCE(p_stock, 'all')));

  v_authorized := COALESCE(
    v_uid IS NOT NULL
    AND public.finza_user_can_access_business(p_business_id)
    AND public.finza_business_has_service_min_tier(p_business_id, 'professional'),
    false
  );

  IF NOT v_authorized THEN
    RETURN jsonb_build_object(
      'rows', '[]'::jsonb,
      'pagination', jsonb_build_object(
        'page', v_page,
        'pageSize', v_page_size,
        'totalCount', 0,
        'totalPages', 1
      ),
      'summary', jsonb_build_object(
        'totalItems', 0,
        'activeItems', 0,
        'lowStockItems', 0,
        'totalValue', 0
      )
    );
  END IF;

  WITH inventory AS (
    SELECT
      i.id,
      i.name,
      i.sku,
      i.unit,
      i.quantity_on_hand,
      i.average_cost,
      i.default_cost_price,
      i.reorder_level,
      i.is_active,
      i.default_selling_price,
      (
        i.is_active
        AND i.reorder_level > 0
        AND i.quantity_on_hand <= i.reorder_level
      ) AS is_low_stock
    FROM public.service_material_inventory AS i
    WHERE i.business_id = p_business_id
  ),
  summary AS (
    SELECT
      COUNT(*)::integer AS total_items,
      COUNT(*) FILTER (WHERE is_active)::integer AS active_items,
      COUNT(*) FILTER (WHERE is_low_stock)::integer AS low_stock_items,
      COALESCE(SUM(quantity_on_hand * average_cost), 0) AS total_value
    FROM inventory
  ),
  filtered AS (
    SELECT *
    FROM inventory
    WHERE (
        v_search IS NULL
        OR name ILIKE '%' || v_search || '%'
        OR sku ILIKE '%' || v_search || '%'
      )
      AND (v_status IS DISTINCT FROM 'active' OR is_active IS TRUE)
      AND (v_status IS DISTINCT FROM 'inactive' OR is_active IS FALSE)
      AND (
        v_stock = 'all'
        OR (v_stock = 'low' AND is_low_stock)
        OR (v_stock IS DISTINCT FROM 'all' AND v_stock IS DISTINCT FROM 'low' AND NOT is_low_stock)
      )
  ),
  counted AS (
    SELECT COUNT(*)::integer AS filtered_count FROM filtered
  ),
  paged AS (
    SELECT f.*
    FROM filtered AS f
    ORDER BY f.name ASC
    LIMIT v_page_size
    OFFSET (v_page - 1) * v_page_size
  ),
  last_movements AS (
    SELECT DISTINCT ON (m.material_id)
      m.material_id,
      m.created_at,
      m.movement_type,
      m.reference_id
    FROM public.service_material_movements AS m
    WHERE m.business_id = p_business_id
      AND m.material_id IN (SELECT p.id FROM paged AS p)
    ORDER BY m.material_id, m.created_at DESC
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'unit', p.unit,
            'quantity_on_hand', p.quantity_on_hand,
            'cost_price', COALESCE(p.default_cost_price, p.average_cost, 0),
            'selling_price', p.default_selling_price,
            'reorder_level', p.reorder_level,
            'is_active', p.is_active,
            'last_movement_at', lm.created_at,
            'last_movement_type', lm.movement_type,
            'last_movement_reference_id', lm.reference_id
          )
          ORDER BY p.name ASC
        )
        FROM paged AS p
        LEFT JOIN last_movements AS lm
          ON lm.material_id = p.id
      ),
      '[]'::jsonb
    ),
    'pagination', jsonb_build_object(
      'page', v_page,
      'pageSize', v_page_size,
      'totalCount', c.filtered_count,
      'totalPages', GREATEST(1, CEIL(c.filtered_count::numeric / v_page_size))::integer
    ),
    'summary', jsonb_build_object(
      'totalItems', s.total_items,
      'activeItems', s.active_items,
      'lowStockItems', s.low_stock_items,
      'totalValue', s.total_value
    )
  )
  INTO v_result
  FROM summary AS s, counted AS c;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_service_materials_workspace(uuid, text, text, text, integer, integer) IS
  'Composite materials workspace payload (rows, pagination, summary). One-shot owner/member + professional-tier check, then a single inventory+movement read. Does not trust app.current_business_id or JWT role GUCs.';

ALTER FUNCTION public.get_service_materials_workspace(uuid, text, text, text, integer, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_service_materials_workspace(uuid, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_service_materials_workspace(uuid, text, text, text, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_service_materials_workspace(uuid, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_service_materials_workspace(uuid, text, text, text, integer, integer) TO service_role;
