-- Platform subscription MTN MoMo sandbox collections: track sessions on payment_provider_transactions
-- with workspace = platform_subscription (invoice_id NULL, same Collection API as tenant MTN direct).

ALTER TABLE public.payment_provider_transactions
  DROP CONSTRAINT IF EXISTS payment_provider_transactions_workspace_check;

ALTER TABLE public.payment_provider_transactions
  ADD CONSTRAINT payment_provider_transactions_workspace_check
  CHECK (workspace IN ('service', 'retail', 'platform_subscription'));

COMMENT ON TABLE public.payment_provider_transactions IS
  'Canonical mapping for provider reference -> business and invoice/sale; webhook/verify idempotency. '
  'workspace platform_subscription = Finza platform subscription (MTN sandbox/live), no invoice row.';
