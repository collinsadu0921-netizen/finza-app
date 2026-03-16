-- ============================================================================
-- Phase 0 Semantic Freeze: Prevent products_services.type from changing
-- from 'service' to any other value (SERVICE_CREATION_SEMANTIC_GUARD_DESIGN).
-- ============================================================================
-- Trigger: BEFORE UPDATE ON products_services
-- Condition: OLD.type = 'service' AND NEW.type <> 'service' → REJECT
-- Error code: SERVICE_ITEM_IMMUTABLE_TYPE
-- ============================================================================

CREATE OR REPLACE FUNCTION guard_products_services_service_type_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.type = 'service' AND (NEW.type IS NULL OR NEW.type <> 'service') THEN
    RAISE EXCEPTION 'SERVICE_ITEM_IMMUTABLE_TYPE: Cannot change type from service to product or any other value.'
      USING ERRCODE = '55001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_products_services_service_type ON products_services;
CREATE TRIGGER trigger_guard_products_services_service_type
  BEFORE UPDATE ON products_services
  FOR EACH ROW
  EXECUTE FUNCTION guard_products_services_service_type_immutable();

-- ============================================================================
-- ROLLBACK (run manually if reverting this migration):
-- ============================================================================
-- DROP TRIGGER IF EXISTS trigger_guard_products_services_service_type ON products_services;
-- DROP FUNCTION IF EXISTS guard_products_services_service_type_immutable();
