-- Phase 6: append-only audit + idempotent dedupe for tenant provider callbacks (MTN hint-first).
-- Does not replace last_event_payload on the parent row; complements it for traceability.

CREATE TABLE IF NOT EXISTS public.payment_provider_transaction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_provider_transaction_id UUID NOT NULL
    REFERENCES public.payment_provider_transactions(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_event_id TEXT,
  payload JSONB NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_provider_transaction_events_ppt_id_idx
  ON public.payment_provider_transaction_events (payment_provider_transaction_id);

CREATE INDEX IF NOT EXISTS payment_provider_transaction_events_received_at_idx
  ON public.payment_provider_transaction_events (received_at DESC);

-- Idempotent webhook/callback delivery: identical payload for the same txn + event type is stored once.
CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_transaction_events_dedupe_idx
  ON public.payment_provider_transaction_events (
    payment_provider_transaction_id,
    event_type,
    payload_fingerprint
  );

COMMENT ON TABLE public.payment_provider_transaction_events IS
  'Append-only provider callback/hint events. Not used for authoritative settlement; dedupe via payload_fingerprint.';

ALTER TABLE public.payment_provider_transaction_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_provider_transaction_events_select"
  ON public.payment_provider_transaction_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.payment_provider_transactions ppt
      WHERE ppt.id = payment_provider_transaction_id
        AND public.finza_user_can_access_business(ppt.business_id)
    )
  );

-- Inserts are performed by service-role API routes only (bypass RLS). No INSERT policy for clients.
