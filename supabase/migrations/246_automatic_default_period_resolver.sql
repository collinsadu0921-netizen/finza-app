-- Migration: Automatic Default Period Resolver
-- Creates RPC function to resolve default accounting period based on journal activity
-- Hierarchy: Latest OPEN with activity → Latest SOFT_CLOSED with activity → Latest LOCKED with activity → Current month fallback

-- ============================================================================
-- FUNCTION: resolve_default_accounting_period
-- ============================================================================
CREATE OR REPLACE FUNCTION resolve_default_accounting_period(
  p_business_id UUID
)
RETURNS TABLE (
  period_id UUID,
  period_start DATE,
  period_end DATE,
  status TEXT,
  resolution_reason TEXT
) AS $$
DECLARE
  resolved_period accounting_periods;
BEGIN
  -- 1️⃣ Latest OPEN period with POSTED activity
  -- Note: All journal_entries in the table are implicitly "posted" (no status column exists)
  SELECT ap.* INTO resolved_period
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.status = 'open'
    AND EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.business_id = p_business_id
        AND je.date >= ap.period_start
        AND je.date <= ap.period_end
    )
  ORDER BY ap.period_start DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      resolved_period.id,
      resolved_period.period_start,
      resolved_period.period_end,
      resolved_period.status,
      'latest_open_with_activity'::TEXT;
    RETURN;
  END IF;

  -- 2️⃣ Latest SOFT_CLOSED period with POSTED activity
  SELECT ap.* INTO resolved_period
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.status = 'soft_closed'
    AND EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.business_id = p_business_id
        AND je.date >= ap.period_start
        AND je.date <= ap.period_end
    )
  ORDER BY ap.period_start DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      resolved_period.id,
      resolved_period.period_start,
      resolved_period.period_end,
      resolved_period.status,
      'latest_soft_closed_with_activity'::TEXT;
    RETURN;
  END IF;

  -- 3️⃣ Latest LOCKED period with POSTED activity
  SELECT ap.* INTO resolved_period
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.status = 'locked'
    AND EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.business_id = p_business_id
        AND je.date >= ap.period_start
        AND je.date <= ap.period_end
    )
  ORDER BY ap.period_start DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      resolved_period.id,
      resolved_period.period_start,
      resolved_period.period_end,
      resolved_period.status,
      'latest_locked_with_activity'::TEXT;
    RETURN;
  END IF;

  -- 4️⃣ Current Month Fallback
  SELECT * INTO resolved_period
  FROM ensure_accounting_period(p_business_id, CURRENT_DATE);

  RETURN QUERY SELECT
    resolved_period.id,
    resolved_period.period_start,
    resolved_period.period_end,
    resolved_period.status,
    'current_month_fallback'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- COMMENT
-- ============================================================================
COMMENT ON FUNCTION resolve_default_accounting_period(UUID) IS 
'Resolves default accounting period for public reports based on journal activity.
Hierarchy: Latest OPEN with activity → Latest SOFT_CLOSED with activity → Latest LOCKED with activity → Current month fallback.
All journal_entries are implicitly "posted" (no status column exists).
Returns: period_id, period_start, period_end, status, resolution_reason.
Used by: app/api/reports/trial-balance, app/api/reports/balance-sheet.';
