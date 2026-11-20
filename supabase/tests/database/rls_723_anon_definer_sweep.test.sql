-- 723 anonymous definer sweep test
BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.prosecdef
    AND p.prokind = 'f'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF n > 2 THEN
    RAISE EXCEPTION 'anon retains execution on % definer functions (expected max 2)', n;
  END IF;

  -- The intentionally public helpers remain anon-executable.
  IF NOT has_function_privilege('anon','public.generate_public_token()','EXECUTE') THEN
    RAISE EXCEPTION 'generate_public_token lost anonymous execution';
  END IF;
  IF NOT has_function_privilege('anon','public.finza_user_can_access_proposal_storage_path(text)','EXECUTE') THEN
    RAISE EXCEPTION 'proposal storage path helper lost anonymous execution';
  END IF;
END $$;

ROLLBACK;
