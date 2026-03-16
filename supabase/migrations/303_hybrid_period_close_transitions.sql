-- ============================================================================
-- Hybrid period close: allow both owner path (open→soft_closed) and firm path
-- (open→closing→soft_closed). Add business-centric engagement check for UI/API.
-- ============================================================================

-- ============================================================================
-- STEP 1: Expand enforce_period_state_transitions for hybrid workflow
-- ============================================================================
-- Allowed transitions:
--   open → soft_closed (owner direct)
--   open → closing (request_close)
--   closing → open (reject_close)
--   closing → soft_closed (approve_close)
--   soft_closed → locked
--   locked: no change (existing guard)
CREATE OR REPLACE FUNCTION enforce_period_state_transitions()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent reopening locked periods
  IF OLD.status = 'locked' AND NEW.status != 'locked' THEN
    RAISE EXCEPTION 'Cannot change status of locked period. Period is immutable forever. Current status: %, Attempted: %', OLD.status, NEW.status;
  END IF;

  -- Prevent skipping soft_closed (open → locked forbidden)
  IF OLD.status = 'open' AND NEW.status = 'locked' THEN
    RAISE EXCEPTION 'Cannot lock period directly from open status. Period must be soft_closed first.';
  END IF;

  -- Ensure proper transition paths (hybrid: owner path + firm path)
  IF OLD.status != NEW.status THEN
    IF NOT (
      (OLD.status = 'open' AND NEW.status IN ('soft_closed', 'closing')) OR
      (OLD.status = 'closing' AND NEW.status IN ('open', 'soft_closed')) OR
      (OLD.status = 'soft_closed' AND NEW.status = 'locked')
    ) THEN
      RAISE EXCEPTION 'Invalid period status transition. From: %, To: %. Valid transitions: open→soft_closed, open→closing, closing→open, closing→soft_closed, soft_closed→locked', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION enforce_period_state_transitions IS 'Hybrid period close: allows open→soft_closed (owner), open→closing (request), closing→open (reject), closing→soft_closed (approve), soft_closed→locked. Locked is immutable.';

-- ============================================================================
-- STEP 2: Business-centric engagement check (for UI and API)
-- ============================================================================
-- Returns true if the business has any effective firm engagement (accepted/active, within dates).
-- Used by: has-active-engagement API and close route (to block soft_close when engaged).
-- RLS applies: caller must be able to see the engagement (owner or firm user).
CREATE OR REPLACE FUNCTION business_has_active_engagement(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM firm_client_engagements e
    WHERE e.client_business_id = p_business_id
      AND e.status IN ('accepted', 'active')
      AND e.effective_from <= CURRENT_DATE
      AND (e.effective_to IS NULL OR e.effective_to >= CURRENT_DATE)
  );
$$;

COMMENT ON FUNCTION business_has_active_engagement(UUID) IS 'Returns true if business has any effective firm engagement (accepted/active, within effective date range). Used for hybrid period close UI and server-side soft_close gating.';
