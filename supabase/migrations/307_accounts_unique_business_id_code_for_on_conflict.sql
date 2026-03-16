-- ============================================================================
-- Migration 307: Restore exact conflict target for accounts ON CONFLICT
-- ============================================================================
-- Problem:
-- Retail bootstrap uses:
--   ON CONFLICT (business_id, code) DO NOTHING
-- on table `accounts`.
--
-- Postgres requires a matching UNIQUE/EXCLUDE constraint for that exact target.
-- Some environments dropped the full UNIQUE constraint and kept only a partial
-- index, which does not satisfy this ON CONFLICT form.
--
-- Fix:
-- Add/restore UNIQUE (business_id, code) on accounts.
-- This preserves and strengthens integrity and keeps ON CONFLICT unchanged.
-- ============================================================================

DO $$
BEGIN
  -- Fail loudly if current data violates the required uniqueness contract.
  IF EXISTS (
    SELECT 1
    FROM public.accounts
    GROUP BY business_id, code
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add UNIQUE (business_id, code) on public.accounts: duplicates exist.';
  END IF;

  -- Add the exact unique constraint expected by ON CONFLICT (business_id, code).
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.accounts'::regclass
      AND conname = 'accounts_business_id_code_key'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_business_id_code_key
      UNIQUE (business_id, code);
  END IF;
END $$;

