-- 723_close_anon_definer_drift.sql
-- Final anonymous-execution sweep across SECURITY DEFINER functions.
--
-- 720 revoked the known financial/worker surface, but staging later gained
-- additional SECURITY DEFINER functions (expense repost, payment reversal
-- state, invoice-balance guard) that were created outside the tracked
-- migration chain and inherited the PostgreSQL default PUBLIC execute grant.
-- A production-schema clone cannot see those staging-only functions, so this
-- sweep is written to be a no-op for absent functions.
--
-- Rule: only the two intentionally public helpers keep anonymous execution.
-- Trigger functions are revoked from anon and are not granted to clients
-- (PostgreSQL executes them as the table owner). Everything else keeps
-- authenticated + service_role execution.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.prorettype = 'trigger'::regtype AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prokind = 'f'
      AND p.proname NOT IN (
        'generate_public_token',
        'finza_user_can_access_proposal_storage_path'
      )
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.oid::regprocedure);
    IF r.is_trigger THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.oid::regprocedure);
    END IF;
  END LOOP;
END $$;
