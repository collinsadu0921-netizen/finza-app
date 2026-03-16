-- ============================================================================
-- Migration 331: Fix base64url token generation
-- ============================================================================
-- PostgreSQL encode() does not support 'base64url'. Replace with base64 then
-- convert to URL-safe form (replace +/ with -_, strip = and newlines).
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_public_token()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  v_token := encode(gen_random_bytes(32), 'base64');
  v_token := replace(v_token, '+', '-');
  v_token := replace(v_token, '/', '_');
  v_token := replace(v_token, '=', '');
  v_token := replace(v_token, chr(10), '');
  RETURN v_token;
END;
$$;
