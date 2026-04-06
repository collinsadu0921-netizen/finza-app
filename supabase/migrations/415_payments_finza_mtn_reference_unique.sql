-- Tenant MTN direct (service invoice) uses payments.reference = finza-mtn-<uuid>.
-- Unique partial index prevents duplicate payment rows when verify runs concurrently.
CREATE UNIQUE INDEX IF NOT EXISTS payments_reference_finza_mtn_unique
  ON public.payments (reference)
  WHERE reference IS NOT NULL AND reference LIKE 'finza-mtn-%';
