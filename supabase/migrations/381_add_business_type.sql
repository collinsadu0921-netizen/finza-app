-- Migration 381: Add business_type to businesses table
-- Used by AFS generation to produce entity-appropriate financial statements.
-- 'limited_company' → Equity section (Share Capital, Retained Earnings)
-- 'sole_proprietorship' → Owner's Equity section (Capital, Drawings)
--
-- Defaults to 'limited_company' to preserve all existing behaviour.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS business_type TEXT
    NOT NULL DEFAULT 'limited_company'
    CHECK (business_type IN ('limited_company', 'sole_proprietorship'));

COMMENT ON COLUMN businesses.business_type IS
  'Legal entity type: limited_company or sole_proprietorship.
   Affects AFS equity section labels and structure.
   Defaults to limited_company for backwards-compatibility.';
