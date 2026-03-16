-- Migration 305: business_whatsapp_templates — editable WhatsApp message templates per business
-- Ownership: business owner only (same pattern as accounts: businesses.owner_id = auth.uid())
-- ============================================================================

CREATE TABLE IF NOT EXISTS business_whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('invoice', 'estimate', 'order')),
  template TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (business_id, type)
);

CREATE INDEX IF NOT EXISTS idx_business_whatsapp_templates_business_id
  ON business_whatsapp_templates(business_id);

-- RLS: owner only (same as accounts)
ALTER TABLE business_whatsapp_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business owners can select whatsapp templates" ON business_whatsapp_templates;
CREATE POLICY "Business owners can select whatsapp templates"
  ON business_whatsapp_templates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_whatsapp_templates.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Business owners can insert whatsapp templates" ON business_whatsapp_templates;
CREATE POLICY "Business owners can insert whatsapp templates"
  ON business_whatsapp_templates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_whatsapp_templates.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Business owners can update whatsapp templates" ON business_whatsapp_templates;
CREATE POLICY "Business owners can update whatsapp templates"
  ON business_whatsapp_templates FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_whatsapp_templates.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Business owners can delete whatsapp templates" ON business_whatsapp_templates;
CREATE POLICY "Business owners can delete whatsapp templates"
  ON business_whatsapp_templates FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_whatsapp_templates.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Keep updated_at in sync (optional; can be set in API as well)
CREATE OR REPLACE FUNCTION set_business_whatsapp_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS business_whatsapp_templates_updated_at ON business_whatsapp_templates;
CREATE TRIGGER business_whatsapp_templates_updated_at
  BEFORE UPDATE ON business_whatsapp_templates
  FOR EACH ROW
  EXECUTE FUNCTION set_business_whatsapp_templates_updated_at();
