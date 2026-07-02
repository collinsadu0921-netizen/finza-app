-- Staging verification for migration 511 (project adonhhtooawkeemdqqeo only)

SELECT pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_bills_list_page';

-- Smoke (authenticated user context in app; service role may differ):
-- SELECT get_bills_list_page(
--   '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid,
--   50, 0, NULL, NULL, NULL, NULL, NULL
-- );
