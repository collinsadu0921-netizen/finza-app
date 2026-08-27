-- STAGING ONLY — do not execute unless 578 must be reverted.
-- Drops the composite materials workspace RPC. The HTTP route must also
-- be rolled back to the pre-578 multi-SELECT loader.

DROP FUNCTION IF EXISTS public.get_service_materials_workspace(uuid, text, text, text, integer, integer);
