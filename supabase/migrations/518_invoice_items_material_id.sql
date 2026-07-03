-- ============================================================================
-- Migration 518: Optional material reference on invoice line items (PR C)
-- Additive metadata only — no stock/COGS/ledger behavior.
-- ============================================================================

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES public.service_material_inventory(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.invoice_items.material_id IS
  'Optional link to billable material at time of invoice. Line description/unit_price are snapshotted; no stock movement.';

CREATE INDEX IF NOT EXISTS idx_invoice_items_material_id
  ON public.invoice_items(material_id)
  WHERE material_id IS NOT NULL;
