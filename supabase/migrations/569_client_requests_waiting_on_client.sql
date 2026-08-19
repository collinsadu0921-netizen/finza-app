-- ============================================================================
-- client_requests: add waiting_on_client as a real persisted status.
-- Staging-safe: existing rows are unchanged. Only the CHECK is widened.
--
-- Rollback:
--   1. UPDATE client_requests SET status = 'in_progress'
--      WHERE status = 'waiting_on_client';
--   2. Drop client_requests_status_check and restore
--      CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled'))
-- ============================================================================

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
    INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'client_requests'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.client_requests DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.client_requests
  ADD CONSTRAINT client_requests_status_check
  CHECK (status IN ('open', 'in_progress', 'waiting_on_client', 'completed', 'cancelled'));

COMMENT ON COLUMN public.client_requests.status IS
  'open | in_progress | waiting_on_client | completed | cancelled';
