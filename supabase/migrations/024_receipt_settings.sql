-- Receipt Settings for Retail Mode
-- Stage 31: Professional Receipt System
-- Required for Retail > Settings > Receipt Settings (table: public.receipt_settings)

-- Create receipt_settings table
CREATE TABLE IF NOT EXISTS receipt_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  printer_type text DEFAULT 'browser_print' CHECK (printer_type IN ('escpos', 'browser_print')),
  printer_width text DEFAULT '58mm' CHECK (printer_width IN ('58mm', '80mm')),
  auto_cut boolean DEFAULT false,
  drawer_kick boolean DEFAULT false,
  show_logo boolean DEFAULT true,
  receipt_mode text DEFAULT 'full' CHECK (receipt_mode IN ('compact', 'full')),
  footer_text text DEFAULT '',
  show_qr_code boolean DEFAULT false,
  qr_code_content text DEFAULT '',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(business_id)
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_receipt_settings_business_id ON receipt_settings(business_id);

-- Enable RLS
ALTER TABLE receipt_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Enable read access for all users" ON receipt_settings;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON receipt_settings;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON receipt_settings;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON receipt_settings;

-- Create policies
CREATE POLICY "Enable read access for all users" ON receipt_settings FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON receipt_settings FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON receipt_settings FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON receipt_settings FOR DELETE USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE receipt_settings IS 'Receipt printing settings for Retail Mode';
COMMENT ON COLUMN receipt_settings.printer_type IS 'Type of printer: escpos or browser_print';
COMMENT ON COLUMN receipt_settings.printer_width IS 'Printer width: 58mm or 80mm';
COMMENT ON COLUMN receipt_settings.auto_cut IS 'Enable automatic paper cut after printing';
COMMENT ON COLUMN receipt_settings.drawer_kick IS 'Enable automatic cash drawer open after printing';
COMMENT ON COLUMN receipt_settings.show_logo IS 'Show business logo on receipt';
COMMENT ON COLUMN receipt_settings.receipt_mode IS 'Receipt display mode: compact or full';
COMMENT ON COLUMN receipt_settings.footer_text IS 'Custom footer text to display on receipt';
COMMENT ON COLUMN receipt_settings.show_qr_code IS 'Show QR code on receipt';
COMMENT ON COLUMN receipt_settings.qr_code_content IS 'Content for QR code (URL, phone number, etc.)';







