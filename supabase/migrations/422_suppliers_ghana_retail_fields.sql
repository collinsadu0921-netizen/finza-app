-- Ghana-oriented retail supplier profile fields (lightweight, not enterprise procurement).
-- Existing `name` = supplier business / trading name; `phone` / `email` / `status` unchanged.

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS whatsapp_phone text,
  ADD COLUMN IF NOT EXISTS location_line text,
  ADD COLUMN IF NOT EXISTS payment_preference text,
  ADD COLUMN IF NOT EXISTS payment_terms_type text,
  ADD COLUMN IF NOT EXISTS payment_terms_custom text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS momo_number text,
  ADD COLUMN IF NOT EXISTS momo_network text,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS lead_time_days integer,
  ADD COLUMN IF NOT EXISTS regular_products_note text;

COMMENT ON COLUMN suppliers.contact_person IS 'Primary contact at the supplier.';
COMMENT ON COLUMN suppliers.location_line IS 'Area, landmark, or how to find them (free text).';
COMMENT ON COLUMN suppliers.payment_preference IS 'cash | mobile_money | bank_transfer | credit';
COMMENT ON COLUMN suppliers.payment_terms_type IS 'on_delivery | net_7 | net_14 | net_30 | custom';
COMMENT ON COLUMN suppliers.payment_terms_custom IS 'When payment_terms_type = custom, human-readable terms.';
COMMENT ON COLUMN suppliers.regular_products_note IS 'Informal list of usual stock (e.g. beverages, rice).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_payment_preference_check'
  ) THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_payment_preference_check
      CHECK (
        payment_preference IS NULL
        OR payment_preference IN ('cash', 'mobile_money', 'bank_transfer', 'credit')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_payment_terms_type_check'
  ) THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_payment_terms_type_check
      CHECK (
        payment_terms_type IS NULL
        OR payment_terms_type IN ('on_delivery', 'net_7', 'net_14', 'net_30', 'custom')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_lead_time_days_check'
  ) THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_lead_time_days_check
      CHECK (lead_time_days IS NULL OR (lead_time_days >= 0 AND lead_time_days <= 365));
  END IF;
END $$;
