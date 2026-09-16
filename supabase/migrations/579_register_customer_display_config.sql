-- Additive per-register customer display configuration (Retail).
-- Staging-safe: nullable serial profile fields; no universal baud/protocol default.
-- COM port is never stored — Chrome Web Serial permission stays browser-local.

ALTER TABLE public.registers
  ADD COLUMN IF NOT EXISTS customer_display_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_display_profile_id text NULL,
  ADD COLUMN IF NOT EXISTS customer_display_baud_rate integer NULL,
  ADD COLUMN IF NOT EXISTS customer_display_data_bits integer NULL,
  ADD COLUMN IF NOT EXISTS customer_display_stop_bits integer NULL,
  ADD COLUMN IF NOT EXISTS customer_display_parity text NULL,
  ADD COLUMN IF NOT EXISTS customer_display_flow_control text NULL,
  ADD COLUMN IF NOT EXISTS customer_display_amount_write_mode text NULL,
  ADD COLUMN IF NOT EXISTS customer_display_physically_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_display_verified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS customer_display_verified_by uuid NULL,
  ADD COLUMN IF NOT EXISTS customer_display_verified_note text NULL,
  ADD COLUMN IF NOT EXISTS customer_display_config_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_display_updated_at timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registers_customer_display_profile_id_check'
  ) THEN
    ALTER TABLE public.registers
      ADD CONSTRAINT registers_customer_display_profile_id_check
      CHECK (
        customer_display_profile_id IS NULL
        OR customer_display_profile_id IN ('2400', '4800', '9600', '19200')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registers_customer_display_baud_rate_check'
  ) THEN
    ALTER TABLE public.registers
      ADD CONSTRAINT registers_customer_display_baud_rate_check
      CHECK (
        customer_display_baud_rate IS NULL
        OR customer_display_baud_rate IN (2400, 4800, 9600, 19200)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registers_customer_display_data_bits_check'
  ) THEN
    ALTER TABLE public.registers
      ADD CONSTRAINT registers_customer_display_data_bits_check
      CHECK (
        customer_display_data_bits IS NULL
        OR customer_display_data_bits IN (7, 8)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registers_customer_display_stop_bits_check'
  ) THEN
    ALTER TABLE public.registers
      ADD CONSTRAINT registers_customer_display_stop_bits_check
      CHECK (
        customer_display_stop_bits IS NULL
        OR customer_display_stop_bits IN (1, 2)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registers_customer_display_parity_check'
  ) THEN
    ALTER TABLE public.registers
      ADD CONSTRAINT registers_customer_display_parity_check
      CHECK (
        customer_display_parity IS NULL
        OR customer_display_parity IN ('none', 'even', 'odd')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registers_customer_display_flow_control_check'
  ) THEN
    ALTER TABLE public.registers
      ADD CONSTRAINT registers_customer_display_flow_control_check
      CHECK (
        customer_display_flow_control IS NULL
        OR customer_display_flow_control IN ('none', 'hardware')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registers_customer_display_amount_write_mode_check'
  ) THEN
    ALTER TABLE public.registers
      ADD CONSTRAINT registers_customer_display_amount_write_mode_check
      CHECK (
        customer_display_amount_write_mode IS NULL
        OR customer_display_amount_write_mode IN ('ascii_only', 'clear_then_amount')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.registers.customer_display_enabled IS
  'Retail: register has a saved customer-display serial profile (not COM port).';
COMMENT ON COLUMN public.registers.customer_display_physically_verified IS
  'Retail: owner/admin confirmed physical rendering on this till. Fail-closed until true.';
COMMENT ON COLUMN public.registers.customer_display_baud_rate IS
  'Retail: baud for this register only. NULL means unconfigured — never invent 2400/9600.';
