-- ============================================================================
-- Migration 282: Restore accounting_firms.contact_email (canonical contract)
-- ============================================================================
-- Use when migration 275 was not applied or table was recreated without
-- contact_email. Idempotent; safe to run even if column already exists.
-- No RLS changes; aligns with 275 and AUDIT_ACCOUNTING_FIRM_CONTACT_EMAIL_CONTRACT.
-- ============================================================================

ALTER TABLE public.accounting_firms
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

COMMENT ON COLUMN public.accounting_firms.contact_email IS
  'Optional contact email shown to clients (partner sets in firm settings).';
