-- Add missing columns to receipt_settings (table may exist from older schema)
-- Run this if you get: column "auto_cut" of relation "receipt_settings" does not exist

ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS auto_cut boolean DEFAULT false;
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS drawer_kick boolean DEFAULT false;
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS show_logo boolean DEFAULT true;
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS receipt_mode text DEFAULT 'full';
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS footer_text text DEFAULT '';
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS show_qr_code boolean DEFAULT false;
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS qr_code_content text DEFAULT '';
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Enforce constraints if columns were just added (avoid duplicate constraint names)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receipt_settings_receipt_mode_check'
  ) THEN
    ALTER TABLE receipt_settings ADD CONSTRAINT receipt_settings_receipt_mode_check
      CHECK (receipt_mode IN ('compact', 'full'));
  END IF;
END $$;

COMMENT ON COLUMN receipt_settings.auto_cut IS 'Enable automatic paper cut after printing';
COMMENT ON COLUMN receipt_settings.drawer_kick IS 'Enable automatic cash drawer open after printing';
COMMENT ON COLUMN receipt_settings.show_logo IS 'Show business logo on receipt';
COMMENT ON COLUMN receipt_settings.receipt_mode IS 'Receipt display mode: compact or full';
COMMENT ON COLUMN receipt_settings.footer_text IS 'Custom footer text to display on receipt';
COMMENT ON COLUMN receipt_settings.show_qr_code IS 'Show QR code on receipt';
COMMENT ON COLUMN receipt_settings.qr_code_content IS 'Content for QR code (URL, phone number, etc.)';
