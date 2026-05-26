-- Hubtel Online Checkout (service invoice): pending_verification status + payment reference idempotency.

ALTER TABLE public.payment_provider_transactions
  DROP CONSTRAINT IF EXISTS payment_provider_transactions_status_check;

ALTER TABLE public.payment_provider_transactions
  ADD CONSTRAINT payment_provider_transactions_status_check
  CHECK (status IN (
    'initiated',
    'pending',
    'requires_action',
    'pending_verification',
    'successful',
    'failed',
    'cancelled'
  ));

COMMENT ON COLUMN public.payment_provider_transactions.status IS
  'Provider session lifecycle. pending_verification = paid at Hubtel but Finza could not confirm via status API (e.g. IP whitelist).';

-- Hubtel invoice clientReference prefix FZHB — prevent duplicate payment rows on verify races.
CREATE UNIQUE INDEX IF NOT EXISTS payments_reference_hubtel_fzhb_unique
  ON public.payments (reference)
  WHERE reference IS NOT NULL AND reference LIKE 'FZHB%';
