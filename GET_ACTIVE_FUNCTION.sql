-- Get the ACTUAL active function definition
SELECT 
  proname,
  prosrc
FROM pg_proc
WHERE proname = 'post_sale_to_ledger'
ORDER BY oid DESC
LIMIT 1;
