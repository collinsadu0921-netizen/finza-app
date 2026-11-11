-- ============================================================================
-- Release 09: personal sender identification for proposals
-- ============================================================================
-- Additive snapshot fields only. The business remains the official issuer.
-- Existing proposals remain valid with all four fields null and keep showing
-- the business name in the "Prepared by" position.
-- ============================================================================

BEGIN;

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS prepared_by_name TEXT,
  ADD COLUMN IF NOT EXISTS prepared_by_title TEXT,
  ADD COLUMN IF NOT EXISTS prepared_by_email TEXT,
  ADD COLUMN IF NOT EXISTS prepared_by_phone TEXT;

COMMENT ON COLUMN public.proposals.prepared_by_name IS
  'Optional per-proposal sender snapshot. Business remains the official proposal issuer.';
COMMENT ON COLUMN public.proposals.prepared_by_title IS
  'Optional sender job title shown with prepared_by_name.';
COMMENT ON COLUMN public.proposals.prepared_by_email IS
  'Optional sender email explicitly chosen for client-facing display.';
COMMENT ON COLUMN public.proposals.prepared_by_phone IS
  'Optional sender phone explicitly chosen for client-facing display.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.proposals'::regclass
      AND conname = 'proposals_prepared_by_name_length_check'
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_prepared_by_name_length_check
      CHECK (prepared_by_name IS NULL OR char_length(prepared_by_name) <= 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.proposals'::regclass
      AND conname = 'proposals_prepared_by_title_length_check'
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_prepared_by_title_length_check
      CHECK (prepared_by_title IS NULL OR char_length(prepared_by_title) <= 160);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.proposals'::regclass
      AND conname = 'proposals_prepared_by_email_length_check'
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_prepared_by_email_length_check
      CHECK (prepared_by_email IS NULL OR char_length(prepared_by_email) <= 254);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.proposals'::regclass
      AND conname = 'proposals_prepared_by_phone_length_check'
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_prepared_by_phone_length_check
      CHECK (prepared_by_phone IS NULL OR char_length(prepared_by_phone) <= 50);
  END IF;
END $$;

COMMIT;
