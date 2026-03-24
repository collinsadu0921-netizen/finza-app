-- Migration 385: Service workspace trial flow + subscription status
-- =============================================================================
-- Adds first-class trial and subscription status tracking to the businesses
-- table. Only the Service workspace uses these columns — Retail and other
-- workspaces are unaffected.
--
-- STATUS MODEL (service_subscription_status):
--   trialing  — inside a free trial window (check trial_ends_at for expiry)
--   active    — paid subscription is current
--   past_due  — payment failed but MoMo grace period still open
--   locked    — grace period expired after a failed renewal; access blocked
--
--   NOTE: trial expiry does NOT set locked. When trial_ends_at passes and
--   status is still 'trialing', the application resolves effective_tier as
--   'starter' — the user keeps Essentials access and sees a subscribe CTA.
--   Only a failed/expired payment grace triggers 'locked'.
--
-- TIER MODEL (service_subscription_tier) is unchanged:
--   starter | professional | business
--   Tier describes WHAT the user is entitled to; status describes their
--   subscription lifecycle state. They are independent columns.
--
-- BACKFILL RULE:
--   Existing businesses were created before the trial system and are assumed
--   to be paying customers — they receive status='active'. New rows created
--   after this migration must have status set explicitly by the application.
--
-- TIER DEFAULT FIX:
--   The previous DEFAULT 'business' was dangerous: any INSERT that omitted
--   the column silently granted full Business access. Changed to 'starter'
--   so new rows fail safe. The application always sets the column explicitly.
-- =============================================================================

-- 1. Add subscription status column.
--    Nullable so the column can be added without touching existing rows.
--    Backfill existing rows as 'active' (paying customers before trial system).
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS service_subscription_status TEXT
    CHECK (service_subscription_status IN ('trialing', 'active', 'past_due', 'locked'));

UPDATE businesses
  SET service_subscription_status = 'active'
  WHERE service_subscription_status IS NULL;

-- 2. Add trial window columns (nullable — only set when a trial is created).
--    Column is named trial_started_at to be consistent with subscription_started_at.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at    TIMESTAMPTZ;

-- 3. Add subscription billing tracking (nullable — set when Paystack activates).
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS billing_cycle           TEXT CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual')),
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_ends_at  TIMESTAMPTZ;

-- 4. Fix the dangerous column default for service_subscription_tier.
--    Existing rows already have an explicit value; only future INSERTs are affected.
ALTER TABLE businesses
  ALTER COLUMN service_subscription_tier SET DEFAULT 'starter';

-- 5. Partial index for efficient trial expiry queries.
CREATE INDEX IF NOT EXISTS idx_businesses_trial_ends_at
  ON businesses (trial_ends_at)
  WHERE service_subscription_status = 'trialing';
