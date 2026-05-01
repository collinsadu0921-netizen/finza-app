-- =============================================================================
-- SERVICE TRIAL SIGNUP — ADMIN INSPECTION & ONE-OFF REPAIR (post-fix cleanup)
-- =============================================================================
--
-- CONTEXT
-- -------
-- Some Service businesses were created while OAuth dropped trial metadata when
-- the marketing link had trial=1 without plan. They may look like:
--   service_subscription_status = 'active'
--   trial_started_at / trial_ends_at = NULL
--   subscription_started_at / current_period_ends_at = NULL
-- even though the user intended a 14-day trial from /signup?workspace=service&trial=1
--
-- THIS SCRIPT DOES NOT RUN AUTOMATICALLY. Run statements manually in SQL Editor
-- (or psql) after human review. Never bulk-update all businesses.
--
-- WARNINGS (read before running anything)
-- ----------------------------------------
-- 1. Do NOT use the repair UPDATE unless you have confirmed the row is a false
--    "active" trial (e.g. owner confirms trial CTA, no payment ever taken).
-- 2. The repair UPDATE refuses rows that already have paid-period signals
--    (subscription_started_at or current_period_ends_at). If those are set,
--    stop — the business may be or have been a real paid subscriber.
-- 3. The repair does NOT change service_subscription_tier. If the user should
--    trial Professional/Business, fix tier separately (and document why).
-- 4. Repairing the DB does NOT fix Supabase Auth user_metadata. See the
--    read-only Auth section below; update metadata only if needed and never
--    overwrite blindly (merge known keys after export).
-- 5. Prefer running against staging / a snapshot first. Keep a copy of the
--    inspection SELECT output before UPDATE.
-- 6. service_subscription_tier = 'starter' alone is NOT proof of a broken
--    trial — many legitimate accounts are active starter. The safe pattern is:
--    business-specific review + NULL paid columns + evidence from signup.
--
-- =============================================================================


-- ---------------------------------------------------------------------------
-- A) READ-ONLY: Inspect ONE business by business_id AND owner email
-- ---------------------------------------------------------------------------
-- Replace the two placeholders before running.

-- For Supabase SQL Editor or psql: replace UUID and email literals below.

SELECT
  b.id                    AS business_id,
  b.name                  AS business_name,
  u.email                 AS owner_email,
  b.service_subscription_status,
  b.service_subscription_tier,
  b.billing_cycle,
  b.trial_started_at,
  b.trial_ends_at,
  b.subscription_started_at,
  b.current_period_ends_at,
  b.subscription_grace_until,
  b.created_at,
  b.industry,
  b.owner_id
FROM public.businesses b
JOIN auth.users u ON u.id = b.owner_id
WHERE b.id = '00000000-0000-0000-0000-000000000000'::uuid
  AND lower(trim(u.email)) = lower(trim('reviewed-user@example.com'))
  AND b.archived_at IS NULL;

-- If this returns 0 rows: wrong id/email pair, or business archived — do not repair.


-- ---------------------------------------------------------------------------
-- B) READ-ONLY: Auth user_metadata for the same owner (no writes)
-- ---------------------------------------------------------------------------
-- Use owner_id from the inspection SELECT above.

SELECT
  u.id,
  u.email,
  u.raw_user_meta_data->>'trial_intent'       AS trial_intent,
  u.raw_user_meta_data->>'trial_workspace'    AS trial_workspace,
  u.raw_user_meta_data->>'trial_plan'         AS trial_plan,
  u.raw_user_meta_data->>'signup_service_plan' AS signup_service_plan,
  u.raw_user_meta_data->>'signup_billing_cycle' AS signup_billing_cycle,
  u.raw_user_meta_data
FROM auth.users u
WHERE u.id = (
  SELECT owner_id
  FROM public.businesses
  WHERE id = '00000000-0000-0000-0000-000000000000'::uuid
  LIMIT 1
);

-- Optional: if metadata is missing trial flags but you have evidence the user
-- used the trial CTA, consider a manual Auth merge (Dashboard → Auth → user
-- or admin.updateUserById) to set e.g. trial_intent=true, trial_workspace=service,
-- trial_plan=<tier> — only after policy review. Do not run generic UPDATEs on
-- auth.users from ad-hoc SQL unless your org allows it and you know the JSON merge.


-- ---------------------------------------------------------------------------
-- C) ONE-BUSINESS REPAIR UPDATE (strict guards — single id)
-- ---------------------------------------------------------------------------
-- Preconditions you must verify by hand:
--   - Row is industry = 'service'
--   - No evidence of completed platform subscription payment for this business
--   - Inspection query returned exactly one row matching email + id
--
-- This UPDATE affects at most one row. It still requires the same id + email
-- binding so it cannot fire on the wrong tenant if the UUID is mistyped alone.

BEGIN;

UPDATE public.businesses AS b
SET
  service_subscription_status = 'trialing',
  trial_started_at            = now(),
  trial_ends_at               = now() + interval '14 days',
  current_period_ends_at      = NULL,
  subscription_started_at     = NULL,
  subscription_grace_until    = NULL,
  updated_at                  = now()
FROM auth.users AS u
WHERE b.owner_id = u.id
  AND b.id = '00000000-0000-0000-0000-000000000000'::uuid
  AND lower(trim(u.email)) = lower(trim('reviewed-user@example.com'))
  AND b.archived_at IS NULL
  AND b.industry = 'service'
  AND b.service_subscription_status = 'active'
  AND b.trial_started_at IS NULL
  AND b.trial_ends_at IS NULL
  AND b.subscription_started_at IS NULL
  AND b.current_period_ends_at IS NULL
  AND b.subscription_grace_until IS NULL;

-- Check rowcount: should be 1. If 0, no row matched guards — investigate. If >1,
-- your schema should still only match one id; if ever >1, ROLLBACK immediately.

COMMIT;
-- If anything looks wrong before COMMIT, use ROLLBACK instead.


-- ---------------------------------------------------------------------------
-- D) ROLLBACK for the SAME business_id (revert DB row to pre-repair shape)
-- ---------------------------------------------------------------------------
-- Use only if the repair was mistaken. This restores "active with no trial"
-- and clears trial window columns. It does NOT restore previous tier if you
-- changed tier manually.

BEGIN;

UPDATE public.businesses AS b
SET
  service_subscription_status = 'active',
  trial_started_at            = NULL,
  trial_ends_at               = NULL,
  current_period_ends_at      = NULL,
  subscription_started_at     = NULL,
  updated_at                  = now()
FROM auth.users AS u
WHERE b.owner_id = u.id
  AND b.id = '00000000-0000-0000-0000-000000000000'::uuid
  AND lower(trim(u.email)) = lower(trim('reviewed-user@example.com'))
  AND b.archived_at IS NULL
  AND b.industry = 'service';

COMMIT;


-- ---------------------------------------------------------------------------
-- E) READ-ONLY: Re-inspect after repair or rollback
-- ---------------------------------------------------------------------------

SELECT
  b.id,
  b.name,
  u.email,
  b.service_subscription_status,
  b.service_subscription_tier,
  b.billing_cycle,
  b.trial_started_at,
  b.trial_ends_at,
  b.subscription_started_at,
  b.current_period_ends_at,
  b.created_at
FROM public.businesses b
JOIN auth.users u ON u.id = b.owner_id
WHERE b.id = '00000000-0000-0000-0000-000000000000'::uuid
  AND b.archived_at IS NULL;
