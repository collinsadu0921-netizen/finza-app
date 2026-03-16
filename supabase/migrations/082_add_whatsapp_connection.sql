-- Migration: Add WhatsApp Cloud API Connection
-- Stores Meta WhatsApp Business API connection details per business

-- ============================================================================
-- ADD WHATSAPP CONNECTION FIELDS TO BUSINESSES TABLE
-- ============================================================================

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS whatsapp_connected BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_business_id TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_access_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_token_expires_at TIMESTAMP WITH TIME ZONE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_businesses_whatsapp_connected ON businesses(whatsapp_connected) WHERE whatsapp_connected = true;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN businesses.whatsapp_connected IS 'Whether business has connected WhatsApp Cloud API';
COMMENT ON COLUMN businesses.whatsapp_business_id IS 'Meta Business Account ID';
COMMENT ON COLUMN businesses.whatsapp_phone_number_id IS 'WhatsApp Phone Number ID from Meta';
COMMENT ON COLUMN businesses.whatsapp_phone_number IS 'WhatsApp Business phone number (readable format)';
COMMENT ON COLUMN businesses.whatsapp_access_token_encrypted IS 'Encrypted Meta access token for WhatsApp API';
COMMENT ON COLUMN businesses.whatsapp_token_expires_at IS 'Token expiration timestamp';

-- ============================================================================
-- NOTE: Token Encryption
-- ============================================================================
-- Access tokens should be encrypted at application level before storage
-- Consider using Supabase Vault or application-level encryption
-- For now, storing as encrypted text - implement encryption in API layer













