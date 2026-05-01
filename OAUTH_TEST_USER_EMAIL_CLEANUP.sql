-- =============================================================================
-- DISPOSABLE OAUTH / SIGNUP TEST USER — ONE-OFF CLEANUP (public.users orphan)
-- =============================================================================
--
-- SYMPTOM
-- -------
-- After deleting a user from Supabase Auth and signing up again with Google,
-- `public.users` may still hold a row with the same email (old UUID = old auth id).
-- `ensureUserRecord` then fails with:
--   duplicate key value violates unique constraint "users_email_key"
--
-- SCOPE
-- -----
-- This script targets **one** disposable test email + **one** confirmed
-- `public.users.id` (UUID). It is NOT for bulk cleanup or production accounts.
--
-- SAFETY
-- -------
-- - Replace BOTH literals everywhere (email + UUID) after inspection.
-- - Every destructive statement is guarded by **email + id** (and extra checks).
-- - Use BEGIN → verify rowcounts → COMMIT or ROLLBACK.
-- - If any "blocker" SELECT returns unexpected rows for a *disposable* test user,
--   STOP and widen inspection — do not guess-delete real customer data.
--
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 0) SET RUNTIME PARAMETERS (edit before use — Supabase SQL Editor)
-- ---------------------------------------------------------------------------
-- Replace these two literals only (same values in every section below).

--   test_email          := 'your-disposable-test+oauth@example.com'
--   orphan_public_id    := '00000000-0000-0000-0000-000000000000'::uuid
--                         ↑ must be the `public.users.id` you intend to remove
--                           (typically the OLD auth id, no longer in auth.users)


-- ---------------------------------------------------------------------------
-- A) READ-ONLY — auth.users for this email
-- ---------------------------------------------------------------------------

SELECT id, email, created_at, last_sign_in_at, raw_user_meta_data
FROM auth.users
WHERE lower(trim(email)) = lower(trim('your-disposable-test+oauth@example.com'))
ORDER BY created_at;


-- ---------------------------------------------------------------------------
-- B) READ-ONLY — public.users for this email (expect at most one row / email)
-- ---------------------------------------------------------------------------

SELECT id, email, full_name, created_at, updated_at
FROM public.users
WHERE lower(trim(email)) = lower(trim('your-disposable-test+oauth@example.com'))
ORDER BY created_at;


-- ---------------------------------------------------------------------------
-- C) READ-ONLY — orphan profile row (public id with NO matching auth.users id)
-- ---------------------------------------------------------------------------
-- If this returns the row you want to delete, that row is the usual cause of
-- `users_email_key` violation on re-signup (stale email with dead auth id).

SELECT pu.*
FROM public.users pu
LEFT JOIN auth.users au ON au.id = pu.id
WHERE lower(trim(pu.email)) = lower(trim('your-disposable-test+oauth@example.com'))
  AND au.id IS NULL;


-- ---------------------------------------------------------------------------
-- D) READ-ONLY — workspace links for the orphan public.users.id
-- ---------------------------------------------------------------------------
-- Replace UUID with orphan_public_id.

SELECT bu.*, b.name AS business_name, b.industry, b.owner_id
FROM public.business_users bu
JOIN public.businesses b ON b.id = bu.business_id
WHERE bu.user_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND b.archived_at IS NULL;

SELECT b.*
FROM public.businesses b
WHERE b.owner_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND b.archived_at IS NULL;


-- ---------------------------------------------------------------------------
-- E) READ-ONLY — other public tables referencing public.users(id)
-- ---------------------------------------------------------------------------
-- Service / retail edge cases that can block DELETE on public.users:

SELECT id, business_id, register_id, cashier_id, status, created_at
FROM public.offline_transactions
WHERE cashier_id = '00000000-0000-0000-0000-000000000000'::uuid
LIMIT 50;

SELECT id, business_id, cashier_id, created_at
FROM public.parked_sales
WHERE cashier_id = '00000000-0000-0000-0000-000000000000'::uuid
LIMIT 50;

SELECT id, register_id, user_id, status, started_at
FROM public.cashier_sessions
WHERE user_id = '00000000-0000-0000-0000-000000000000'::uuid
LIMIT 50;

-- Accounting firm membership (references auth.users in many installs — still list if present)
SELECT * FROM public.accounting_firm_users
WHERE user_id = '00000000-0000-0000-0000-000000000000'::uuid
LIMIT 20;

SELECT * FROM public.accountant_firm_users
WHERE user_id = '00000000-0000-0000-0000-000000000000'::uuid
LIMIT 20;


-- ---------------------------------------------------------------------------
-- F) BLOCKER GATE — run immediately before the transaction below
-- ---------------------------------------------------------------------------
-- For a *fresh* disposable OAuth test user you expect **zero** rows in most of
-- these. If you see data you did not create in testing, **ROLLBACK** and stop.

SELECT
  (SELECT count(*) FROM public.offline_transactions WHERE cashier_id = '00000000-0000-0000-0000-000000000000'::uuid) AS offline_txn_count,
  (SELECT count(*) FROM public.parked_sales WHERE cashier_id = '00000000-0000-0000-0000-000000000000'::uuid) AS parked_sales_count,
  (SELECT count(*) FROM public.cashier_sessions WHERE user_id = '00000000-0000-0000-0000-000000000000'::uuid) AS cashier_sessions_count,
  (SELECT count(*) FROM public.business_users WHERE user_id = '00000000-0000-0000-0000-000000000000'::uuid) AS business_users_count,
  (SELECT count(*) FROM public.businesses WHERE owner_id = '00000000-0000-0000-0000-000000000000'::uuid AND archived_at IS NULL) AS owned_businesses_count;


-- =============================================================================
-- G) ONE-USER CLEANUP TRANSACTION (orphan public profile + owned test data)
-- =============================================================================
-- Preconditions (human):
--   1) Section C returned exactly the orphan row you expect (dead auth id).
--   2) Section F counts are acceptable for a disposable test (often all 0).
--   3) You are NOT deleting a `public.users.id` that still exists in auth.users.
--
-- Order: remove RESTRICT children → memberships → businesses (cascades most
-- business children) → orphan public.users row.
--
-- NOTE: Deleting `public.businesses` owned by the orphan removes dependent rows
-- that reference `business_id` with ON DELETE CASCADE in most migrations.
-- If DELETE businesses fails, inspect the error for a non-cascading FK.

BEGIN;

-- G.1) offline_transactions references public.users(id) ON DELETE RESTRICT
DELETE FROM public.offline_transactions ot
WHERE ot.cashier_id = '00000000-0000-0000-0000-000000000000'::uuid;

-- G.2) business_users (memberships) for this user id
DELETE FROM public.business_users bu
WHERE bu.user_id = '00000000-0000-0000-0000-000000000000'::uuid;

-- G.3) firm links (safe no-op if empty)
DELETE FROM public.accounting_firm_users afu
WHERE afu.user_id = '00000000-0000-0000-0000-000000000000'::uuid;

DELETE FROM public.accountant_firm_users acfu
WHERE acfu.user_id = '00000000-0000-0000-0000-000000000000'::uuid;

-- G.4) businesses owned by orphan (cascades most child tables)
DELETE FROM public.businesses b
WHERE b.owner_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND b.archived_at IS NULL;

-- G.5) orphan public.users profile — **dual guard** email + id + not in auth
DELETE FROM public.users pu
WHERE pu.id = '00000000-0000-0000-0000-000000000000'::uuid
  AND lower(trim(pu.email)) = lower(trim('your-disposable-test+oauth@example.com'))
  AND NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = pu.id);

-- Expect: last DELETE returns 1 row deleted. If 0, ROLLBACK and re-check id/email.

-- Uncomment ONE of:
-- ROLLBACK;
COMMIT;


-- ---------------------------------------------------------------------------
-- H) READ-ONLY — post cleanup sanity
-- ---------------------------------------------------------------------------

SELECT id, email FROM public.users
WHERE lower(trim(email)) = lower(trim('your-disposable-test+oauth@example.com'));

SELECT id, email FROM auth.users
WHERE lower(trim(email)) = lower(trim('your-disposable-test+oauth@example.com'));


-- =============================================================================
-- I) OPTIONAL — remove the NEW auth user only if you want a full reset
-- =============================================================================
-- Do **not** run against real customers. Supabase Dashboard → Authentication →
-- Users → delete user is often safer than raw SQL on auth.users.
--
-- If you delete auth.users via SQL in your environment, ensure your org allows
-- it and you understand cascade rules into auth-linked tables.
--
-- ROLLBACK for accidental auth delete cannot restore the user; keep backups.
