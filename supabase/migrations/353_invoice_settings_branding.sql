-- Add branding + document prefix columns to invoice_settings
ALTER TABLE invoice_settings
  ADD COLUMN IF NOT EXISTS brand_color    TEXT DEFAULT '#0f172a',
  ADD COLUMN IF NOT EXISTS quote_prefix   TEXT DEFAULT 'QUO-',
  ADD COLUMN IF NOT EXISTS proforma_prefix TEXT DEFAULT 'PRF-';
