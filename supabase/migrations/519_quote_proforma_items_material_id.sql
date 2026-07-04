-- ============================================================================
-- Migration 519: Optional material reference on quote and proforma line items
-- Additive metadata only — no stock/COGS/ledger behavior.
-- ============================================================================

ALTER TABLE public.estimate_items
  ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES public.service_material_inventory(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.estimate_items.material_id IS
  'Optional link to billable material at time of quote. Line description/price are snapshotted.';

CREATE INDEX IF NOT EXISTS idx_estimate_items_material_id
  ON public.estimate_items(material_id)
  WHERE material_id IS NOT NULL;

ALTER TABLE public.proforma_invoice_items
  ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES public.service_material_inventory(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.proforma_invoice_items.material_id IS
  'Optional link to billable material at time of proforma. Line description/unit_price are snapshotted.';

CREATE INDEX IF NOT EXISTS idx_proforma_invoice_items_material_id
  ON public.proforma_invoice_items(material_id)
  WHERE material_id IS NOT NULL;
