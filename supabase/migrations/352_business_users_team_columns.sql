-- Migration 352: Add display_name and email columns to business_users
-- These allow the business owner to see who their team members are
-- without needing to query auth.users (which requires service role).

ALTER TABLE business_users
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS email        TEXT,
  ADD COLUMN IF NOT EXISTS invited_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at   TIMESTAMPTZ DEFAULT now();

-- Index for fast lookup by email within a business
CREATE INDEX IF NOT EXISTS idx_business_users_email
  ON business_users (business_id, email);

-- Update RLS: business owners and admins can read all team members
-- (existing RLS policies already cover owner read via businesses join)
