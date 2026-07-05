-- Ensure default paid-from asset accounts exist for all active businesses.
-- This migration ensures payroll and payment workflows always have internal paid-from asset accounts.
-- It does not connect bank accounts or alter ledger balances.

WITH target_accounts AS (
  SELECT
    b.id AS business_id,
    v.code,
    v.name,
    v.sub_type,
    v.description
  FROM public.businesses b
  CROSS JOIN (
    VALUES
      ('1000'::text, 'Cash'::text, 'cash'::text, 'Cash on hand'::text),
      ('1010'::text, 'Bank'::text, 'bank'::text, 'Bank account'::text),
      ('1020'::text, 'Mobile Money'::text, 'mobile_money'::text, 'Mobile money accounts'::text)
  ) AS v(code, name, sub_type, description)
  WHERE b.archived_at IS NULL
)
INSERT INTO public.accounts (
  business_id,
  name,
  code,
  type,
  sub_type,
  description,
  is_system,
  deleted_at
)
SELECT
  t.business_id,
  t.name,
  t.code,
  'asset',
  t.sub_type,
  t.description,
  TRUE,
  NULL
FROM target_accounts t
ON CONFLICT (business_id, code) DO UPDATE
SET
  name = EXCLUDED.name,
  type = 'asset',
  sub_type = EXCLUDED.sub_type,
  is_system = TRUE,
  deleted_at = NULL,
  updated_at = NOW();

