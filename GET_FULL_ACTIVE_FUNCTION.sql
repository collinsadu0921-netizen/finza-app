-- Get the COMPLETE active function definition
SELECT 
  proname,
  pg_get_functiondef(oid) as full_definition
FROM pg_proc
WHERE proname = 'post_sale_to_ledger'
ORDER BY oid DESC
LIMIT 1;
