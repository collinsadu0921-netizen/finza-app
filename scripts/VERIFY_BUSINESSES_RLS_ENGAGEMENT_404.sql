-- ============================================================================
-- Engagement 404 forensic: verify businesses RLS in live DB
-- Run through the SAME connection the server uses (e.g. Supabase SQL editor
-- as authenticated user, or pooler used by app).
-- ============================================================================

-- STEP 1 — Prove businesses RLS is active
-- Expected: relrowsecurity = true. If false → migration 283 never applied.
SELECT relrowsecurity
FROM pg_class
WHERE relname = 'businesses';

-- STEP 2 — List all RLS policies on businesses
-- Expected exactly: "Owners can select own business", "Business members can select their businesses"
SELECT policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'businesses'
ORDER BY policyname;
