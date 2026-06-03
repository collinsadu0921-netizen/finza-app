-- Migration 491: Restore SELECT RLS on invoices / invoice_items (read access for tenant members)
-- Regression: migration 488 replaced write policies but left invoices without any SELECT policy.
-- Does not modify INSERT/UPDATE/DELETE policies.

DROP POLICY IF EXISTS "service trial read select" ON public.invoices;

CREATE POLICY "service trial read select" ON public.invoices
  FOR SELECT
  USING (
    public.finza_user_can_access_business(invoices.business_id)
    AND invoices.deleted_at IS NULL
  );

DROP POLICY IF EXISTS "service trial read select" ON public.invoice_items;

CREATE POLICY "service trial read select" ON public.invoice_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
        AND public.finza_user_can_access_business(i.business_id)
        AND i.deleted_at IS NULL
    )
  );
