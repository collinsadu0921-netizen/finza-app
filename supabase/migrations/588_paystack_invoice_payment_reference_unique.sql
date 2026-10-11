-- Service invoice Paystack references are FNZ-<invoice>-<time>.
-- Subscription charges use FNZ-SUB- and are excluded.
-- Retail sale references are not FNZ- invoice charges.
-- Soft-deleted rows are excluded so a ledger rollback can retry the same reference.
-- Not applied to production by this change.

CREATE UNIQUE INDEX IF NOT EXISTS payments_reference_fnz_invoice_unique
  ON public.payments (reference)
  WHERE reference IS NOT NULL
    AND deleted_at IS NULL
    AND reference LIKE 'FNZ-%'
    AND reference NOT LIKE 'FNZ-SUB-%';
