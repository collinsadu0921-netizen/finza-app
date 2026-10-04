-- Online Retail POS idempotency.
-- One client_sale_id may create at most one completed sale for a business+register.
-- Retries and concurrent duplicates collide on this index. A new sale uses a new id.
-- Offline sales keep using offline_transactions.local_id and do not need this column.
-- Existing sales stay NULL and are not rewritten.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS client_sale_id text;

COMMENT ON COLUMN public.sales.client_sale_id IS
  'Client-generated id for one online POS checkout attempt. Unique per business and register when set. Not an inventory movement.';

CREATE UNIQUE INDEX IF NOT EXISTS sales_online_client_sale_id_uidx
  ON public.sales (business_id, register_id, client_sale_id)
  WHERE client_sale_id IS NOT NULL AND register_id IS NOT NULL;
