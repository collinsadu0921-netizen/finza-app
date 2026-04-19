-- Optional per-store logo for receipts and retail branding (HTTPS or public URL).

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS logo_url text;

COMMENT ON COLUMN stores.logo_url IS 'Optional public URL to store logo; receipt prefers this over business logo when set.';
