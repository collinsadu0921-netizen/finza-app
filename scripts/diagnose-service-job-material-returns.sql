-- ============================================================================
-- Read-only diagnostic: historical job material returns (Phase 1A)
-- Does NOT update stock, post journals, or repair records.
--
-- Usage (staging):
--   SELECT * FROM diagnose_service_job_material_returns();
--   SELECT * FROM diagnose_service_job_material_returns('<business_uuid>');
--
-- Classifications:
--   Clearly not restored
--   Possibly restored through cancellation
--   Possibly restored through manual adjustment
--   Accounting reversal present
--   Ambiguous
-- ============================================================================

SELECT
  classification,
  COUNT(*) AS usage_count
FROM public.diagnose_service_job_material_returns(NULL)
GROUP BY classification
ORDER BY classification;

SELECT *
FROM public.diagnose_service_job_material_returns(NULL)
ORDER BY business_id, job_id, usage_id
LIMIT 500;
