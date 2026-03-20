-- ============================================================================
-- MIGRATION 367: Fix payslip public token URL safety
-- ============================================================================
-- generate_payslip_token() used encode(..., 'base64') which produces standard
-- Base64 tokens containing '/', '+', and '=' characters.  When the token
-- contains '/', the URL /payslips/<token> becomes a multi-segment path that
-- Next.js cannot match against the [token] dynamic route, causing 404s.
--
-- Fix:
--   1. Replace generate_payslip_token() with a hex-based implementation.
--      Hex is always URL-safe (0-9, a-f) and unambiguous.
--   2. Re-generate any existing payslip tokens that contain unsafe characters.
-- ============================================================================


-- ── 1. Fix the token generator ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION generate_payslip_token()
RETURNS TEXT AS $$
BEGIN
  -- 32 random bytes → 64-character lowercase hex string.
  -- Hex is always URL-safe: no '+', '/', or '=' characters.
  RETURN encode(gen_random_bytes(32), 'hex');
END;
$$ LANGUAGE plpgsql;


-- ── 2. Sanitize existing tokens that contain URL-unsafe characters ────────────

DO $$
DECLARE
  rec       RECORD;
  new_token TEXT;
BEGIN
  -- Find payslips whose tokens contain '/', '+', or '=' (standard base64 chars)
  FOR rec IN
    SELECT id
    FROM payslips
    WHERE public_token IS NOT NULL
      AND (
        public_token LIKE '%/%'
        OR public_token LIKE '%+%'
        OR public_token LIKE '%=%'
      )
  LOOP
    -- Generate a fresh hex token, retrying on the rare collision
    LOOP
      new_token := encode(gen_random_bytes(32), 'hex');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM payslips WHERE public_token = new_token);
    END LOOP;

    UPDATE payslips SET public_token = new_token WHERE id = rec.id;
  END LOOP;
END;
$$;
