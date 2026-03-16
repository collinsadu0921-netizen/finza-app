-- ============================================================================
-- FIND RECENT TEST SALES
-- ============================================================================
-- This script finds any recent test sales that might still exist

SELECT 
  id,
  business_id,
  amount,
  payment_method,
  payment_status,
  description,
  tax_lines,
  created_at
FROM sales
WHERE description LIKE '%ROOT CAUSE TEST%'
   OR description LIKE '%Diagnostic sale%'
ORDER BY created_at DESC
LIMIT 10;
