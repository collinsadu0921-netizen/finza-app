-- Pricing mode for credit notes.
--
-- Credit notes inherit the pricing mode of the invoice they credit:
--   inclusive -> entered line prices are gross; tax is extracted.
--   exclusive -> entered line prices are net; tax is added on top.
-- The column is additive and defaults to 'inclusive' so legacy credit notes
-- keep their existing interpretation. No existing amount or journal is
-- rewritten by this migration.

ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS tax_pricing_mode text NOT NULL DEFAULT 'inclusive';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'credit_notes_tax_pricing_mode_check'
      AND conrelid = 'public.credit_notes'::regclass
  ) THEN
    ALTER TABLE public.credit_notes
      ADD CONSTRAINT credit_notes_tax_pricing_mode_check
      CHECK (tax_pricing_mode IN ('inclusive', 'exclusive'));
  END IF;
END;
$$;
