-- ============================================================================
-- Explicit Practice assignment-enforcement flag.
-- NULL = legacy firm-wide visibility for restricted roles.
-- Timestamp = enforced. Clearing assignment rows does not turn this off.
-- Default NULL so existing firms are not locked out.
-- ============================================================================

ALTER TABLE public.accounting_firms
  ADD COLUMN IF NOT EXISTS assignment_scope_enabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assignment_scope_enabled_by UUID REFERENCES auth.users(id);

COMMENT ON COLUMN public.accounting_firms.assignment_scope_enabled_at IS
  'When set, Senior/Junior/Readonly are limited to assigned effective clients. NULL = legacy firm-wide visibility.';
COMMENT ON COLUMN public.accounting_firms.assignment_scope_enabled_by IS
  'Partner who last enabled assignment enforcement.';
