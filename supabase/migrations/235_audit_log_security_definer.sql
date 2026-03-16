-- Migration: Audit log insert via SECURITY DEFINER
-- Fixes RLS violation during business confirmation/onboarding.
-- Application calls create_audit_log() via RPC; function runs as definer and
-- performs INSERT into audit_logs, bypassing RLS for that operation only.
-- RLS remains enabled on audit_logs; no permissive policies added for end users.

ALTER FUNCTION create_audit_log(
  UUID, UUID, TEXT, TEXT, UUID, JSONB, JSONB, TEXT, TEXT, TEXT
) SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION create_audit_log(UUID, UUID, TEXT, TEXT, UUID, JSONB, JSONB, TEXT, TEXT, TEXT) IS
  'Insert audit log entry. SECURITY DEFINER so app/triggers can write without RLS blocking. RLS stays on table.';
