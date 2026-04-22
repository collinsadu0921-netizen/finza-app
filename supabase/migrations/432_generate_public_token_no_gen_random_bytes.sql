-- ============================================================================
-- generate_public_token() without gen_random_bytes (pgcrypto)
-- ============================================================================
-- Some Postgres / migration orders lack pgcrypto, so gen_random_bytes(integer)
-- is missing and inserts that DEFAULT generate_public_token() fail.
-- Use gen_random_uuid() (built-in from PG 13+) to build 32 random bytes, then
-- base64url-style encoding — same shape as migration 331.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_public_token()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_hex TEXT;
BEGIN
  v_hex :=
    replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '');
  v_token := encode(decode(v_hex, 'hex'), 'base64');
  v_token := replace(v_token, '+', '-');
  v_token := replace(v_token, '/', '_');
  v_token := replace(v_token, '=', '');
  v_token := replace(v_token, chr(10), '');
  RETURN v_token;
END;
$$;

COMMENT ON FUNCTION public.generate_public_token() IS
  'URL-safe public token; uses gen_random_uuid() so pgcrypto is not required.';
