-- ============================================================================
-- CHECK ACCOUNT IDs
-- ============================================================================
-- This checks if the account IDs that should be used are actually available

SELECT 
  'ACCOUNT ID CHECK' as section,
  get_account_by_control_key('69278e9a-8694-4640-88d1-cbcfe7dd42f3', 'CASH') as cash_account_id,
  get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '4000') as revenue_account_id,
  get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '5000') as cogs_account_id,
  get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '1200') as inventory_account_id,
  CASE 
    WHEN get_account_by_control_key('69278e9a-8694-4640-88d1-cbcfe7dd42f3', 'CASH') IS NULL THEN 'ERROR: Cash account is NULL!'
    WHEN get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '4000') IS NULL THEN 'ERROR: Revenue account is NULL!'
    WHEN get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '5000') IS NULL THEN 'ERROR: COGS account is NULL!'
    WHEN get_account_by_code('69278e9a-8694-4640-88d1-cbcfe7dd42f3', '1200') IS NULL THEN 'ERROR: Inventory account is NULL!'
    ELSE 'OK: All account IDs are available'
  END as status;

-- Also check what accounts exist in the accounts table
SELECT 
  'ACCOUNTS IN accounts TABLE' as section,
  code,
  name,
  type,
  id,
  deleted_at
FROM accounts
WHERE business_id = '69278e9a-8694-4640-88d1-cbcfe7dd42f3'
  AND code IN ('1000', '4000', '5000', '1200', '2100')
ORDER BY code;
