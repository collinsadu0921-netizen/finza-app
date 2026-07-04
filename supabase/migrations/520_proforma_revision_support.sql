-- Migration 520: Proforma revision support
-- Enables quote-style revisions: editing a sent proforma creates a new draft revision.

ALTER TABLE proforma_invoices
  ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1;

ALTER TABLE proforma_invoices
  ADD COLUMN IF NOT EXISTS supersedes_id UUID REFERENCES proforma_invoices(id) ON DELETE SET NULL;

-- Replace single-number uniqueness with revision-aware uniqueness
ALTER TABLE proforma_invoices
  DROP CONSTRAINT IF EXISTS proforma_invoices_business_id_proforma_number_key;

CREATE INDEX IF NOT EXISTS idx_proforma_invoices_supersedes_id
  ON proforma_invoices(supersedes_id)
  WHERE supersedes_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proforma_invoices_revision_number
  ON proforma_invoices(business_id, proforma_number, revision_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_proforma_invoices_business_number_revision
  ON proforma_invoices(business_id, proforma_number, revision_number)
  WHERE proforma_number IS NOT NULL AND deleted_at IS NULL;

UPDATE proforma_invoices
SET revision_number = 1
WHERE revision_number IS NULL OR revision_number = 0;

COMMENT ON COLUMN proforma_invoices.revision_number IS 'Revision number for this document version. Starts at 1. New revisions increment this number.';
COMMENT ON COLUMN proforma_invoices.supersedes_id IS 'ID of the previous revision this document supersedes. NULL for original documents.';
