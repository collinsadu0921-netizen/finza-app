-- Migration: Business Profile and Invoice Settings
-- Adds business profile fields and invoice settings for professional Ghana invoices

-- ============================================================================
-- ENHANCE BUSINESSES TABLE (Business Profile)
-- ============================================================================
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS trading_name TEXT,
  ADD COLUMN IF NOT EXISTS address_street TEXT,
  ADD COLUMN IF NOT EXISTS address_city TEXT,
  ADD COLUMN IF NOT EXISTS address_region TEXT,
  ADD COLUMN IF NOT EXISTS address_country TEXT DEFAULT 'Ghana',
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS tin TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS default_currency TEXT DEFAULT 'GHS';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_businesses_tin ON businesses(tin) WHERE tin IS NOT NULL;

-- ============================================================================
-- INVOICE_SETTINGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS invoice_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  invoice_prefix TEXT DEFAULT 'INV-',
  starting_number INTEGER DEFAULT 1,
  number_initialized BOOLEAN DEFAULT false,
  due_days_default INTEGER DEFAULT 30,
  default_payment_terms TEXT,
  default_footer_message TEXT,
  show_tax_breakdown BOOLEAN DEFAULT true,
  show_business_tin BOOLEAN DEFAULT true,
  -- Payment Details
  bank_name TEXT,
  bank_account_name TEXT,
  bank_account_number TEXT,
  momo_provider TEXT CHECK (momo_provider IN ('MTN', 'Vodafone', 'AirtelTigo', NULL)),
  momo_name TEXT,
  momo_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invoice_settings_business_id ON invoice_settings(business_id);

-- ============================================================================
-- FUNCTION: Get or create invoice settings for business
-- ============================================================================
CREATE OR REPLACE FUNCTION get_or_create_invoice_settings(business_uuid UUID)
RETURNS invoice_settings AS $$
DECLARE
  settings invoice_settings;
BEGIN
  SELECT * INTO settings
  FROM invoice_settings
  WHERE business_id = business_uuid;
  
  IF NOT FOUND THEN
    INSERT INTO invoice_settings (business_id)
    VALUES (business_uuid)
    RETURNING * INTO settings;
  END IF;
  
  RETURN settings;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Generate invoice number with prefix and sequential number
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_invoice_number_with_settings(business_uuid UUID)
RETURNS TEXT AS $$
DECLARE
  settings_record invoice_settings;
  last_number INTEGER;
  new_number TEXT;
  prefix TEXT;
BEGIN
  -- Get invoice settings
  SELECT * INTO settings_record
  FROM get_or_create_invoice_settings(business_uuid);
  
  prefix := COALESCE(settings_record.invoice_prefix, 'INV-');
  
  -- If not initialized, use starting_number
  IF NOT settings_record.number_initialized THEN
    -- Mark as initialized
    UPDATE invoice_settings
    SET number_initialized = true
    WHERE business_id = business_uuid;
    
    new_number := prefix || LPAD(settings_record.starting_number::TEXT, 6, '0');
    RETURN new_number;
  END IF;
  
  -- Get the last invoice number for this business
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '[0-9]+$') AS INTEGER)), settings_record.starting_number - 1)
  INTO last_number
  FROM invoices
  WHERE business_id = business_uuid
    AND invoice_number ~ ('^' || prefix || '[0-9]+$')
    AND deleted_at IS NULL;
  
  -- Generate new number
  new_number := prefix || LPAD((last_number + 1)::TEXT, 6, '0');
  
  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- UPDATE TRIGGERS
-- ============================================================================

-- Auto-update updated_at for invoice_settings
DROP TRIGGER IF EXISTS update_invoice_settings_updated_at ON invoice_settings;
CREATE TRIGGER update_invoice_settings_updated_at
  BEFORE UPDATE ON invoice_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on invoice_settings
ALTER TABLE invoice_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view invoice settings for their business" ON invoice_settings;
DROP POLICY IF EXISTS "Users can insert invoice settings for their business" ON invoice_settings;
DROP POLICY IF EXISTS "Users can update invoice settings for their business" ON invoice_settings;

-- Create RLS policies for invoice_settings
CREATE POLICY "Users can view invoice settings for their business"
  ON invoice_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = invoice_settings.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert invoice settings for their business"
  ON invoice_settings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = invoice_settings.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update invoice settings for their business"
  ON invoice_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = invoice_settings.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

