-- 351: Client acceptance — signature + ID verification for quotes and proforma invoices
-- Clients receive a public link, can accept/sign with ID or reject without logging in.

-- ─── ESTIMATES (Quotes) ───────────────────────────────────────────────────────

-- Add public sharing token if not already present
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE DEFAULT gen_random_uuid()::text;

-- Back-fill any NULLs (for existing rows that were inserted before this column existed)
UPDATE estimates SET public_token = gen_random_uuid()::text WHERE public_token IS NULL;

-- Client acceptance fields
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS client_name_signed  TEXT,
  ADD COLUMN IF NOT EXISTS client_id_type      TEXT CHECK (client_id_type IN (
    'ghana_card', 'national_id', 'passport', 'drivers_license', 'voters_id'
  )),
  ADD COLUMN IF NOT EXISTS client_id_number    TEXT,
  ADD COLUMN IF NOT EXISTS client_signature    TEXT,   -- base64 PNG data URL of drawn signature
  ADD COLUMN IF NOT EXISTS signed_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason     TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at         TIMESTAMPTZ;

-- ─── PROFORMA INVOICES ────────────────────────────────────────────────────────
-- proforma_invoices already has public_token from migration 350.

ALTER TABLE proforma_invoices
  ADD COLUMN IF NOT EXISTS client_name_signed  TEXT,
  ADD COLUMN IF NOT EXISTS client_id_type      TEXT CHECK (client_id_type IN (
    'ghana_card', 'national_id', 'passport', 'drivers_license', 'voters_id'
  )),
  ADD COLUMN IF NOT EXISTS client_id_number    TEXT,
  ADD COLUMN IF NOT EXISTS client_signature    TEXT,   -- base64 PNG data URL of drawn signature
  ADD COLUMN IF NOT EXISTS signed_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason     TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at         TIMESTAMPTZ;
