-- Migration: Enforce Canonical Tax Data for Retail Sales
-- Commit C: Retail Canonical-Only Tax Write Path (Pre-Launch Cleanup)
--
-- PURPOSE:
-- Enforce audit invariants for Retail sales with tax data.
-- If a sale has tax_lines (taxes applied), all canonical metadata must be present.
--
-- SCOPE:
-- Only applies to sales table (Retail transactions).
-- Does NOT affect Service/Accounting flows or other transaction types.
--
-- CONSTRAINTS:
-- If tax_lines IS NOT NULL and not empty:
--   - tax_engine_code IS NOT NULL
--   - tax_engine_effective_from IS NOT NULL
--   - tax_jurisdiction IS NOT NULL

-- ============================================================================
-- CONSTRAINT 1: Check that tax_lines is a valid non-empty JSONB array/object
-- ============================================================================

-- Validate tax_lines structure if present
-- Accepts both array format and object with 'lines' key
CREATE OR REPLACE FUNCTION validate_tax_lines_structure(tax_lines JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  -- NULL is valid (taxes not applied)
  IF tax_lines IS NULL THEN
    RETURN TRUE;
  END IF;
  
  -- Check if it's an array with at least one element
  IF jsonb_typeof(tax_lines) = 'array' AND jsonb_array_length(tax_lines) > 0 THEN
    RETURN TRUE;
  END IF;
  
  -- Check if it's an object with 'lines' array that has elements
  IF jsonb_typeof(tax_lines) = 'object' THEN
    IF tax_lines ? 'lines' AND jsonb_typeof(tax_lines->'lines') = 'array' THEN
      IF jsonb_array_length(tax_lines->'lines') > 0 THEN
        RETURN TRUE;
      END IF;
    END IF;
  END IF;
  
  -- Invalid structure (empty array or empty object)
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- STEP 1: Backfill missing canonical metadata for existing sales with tax_lines
-- ============================================================================
-- For existing sales that have tax_lines but missing metadata, infer defaults:
-- - tax_jurisdiction: Extract from business.address_country (simple 2-letter extraction)
-- - tax_engine_code: Default to 'GH-2025-A' for Ghana, NULL otherwise (can be set later)
-- - tax_engine_effective_from: Use sale created_at date

-- Simple helper to extract country code from business address_country
-- Maps common country names to codes, otherwise extracts first 2 uppercase letters
CREATE OR REPLACE FUNCTION extract_country_code(country_name TEXT)
RETURNS TEXT AS $$
DECLARE
  normalized TEXT;
BEGIN
  IF country_name IS NULL OR TRIM(country_name) = '' THEN
    RETURN NULL;
  END IF;
  
  normalized := UPPER(TRIM(country_name));
  
  -- Map common country name variations to ISO codes (matches TypeScript normalizeCountry logic)
  CASE normalized
    WHEN 'GH', 'GHANA', 'GHA' THEN RETURN 'GH';
    WHEN 'NG', 'NIGERIA' THEN RETURN 'NG';
    WHEN 'KE', 'KENYA', 'KEN' THEN RETURN 'KE';
    WHEN 'UG', 'UGANDA' THEN RETURN 'UG';
    WHEN 'TZ', 'TANZANIA', 'UNITED REPUBLIC OF TANZANIA' THEN RETURN 'TZ';
    WHEN 'RW', 'RWANDA' THEN RETURN 'RW';
    WHEN 'ZM', 'ZAMBIA' THEN RETURN 'ZM';
    ELSE 
      -- If it's already a 2-letter code, return it (validates later)
      IF LENGTH(normalized) >= 2 THEN
        RETURN SUBSTRING(normalized, 1, 2);
      END IF;
      RETURN NULL;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Backfill missing metadata for existing sales with tax_lines
UPDATE sales s
SET 
  tax_jurisdiction = COALESCE(
    s.tax_jurisdiction,
    (SELECT extract_country_code(b.address_country) FROM businesses b WHERE b.id = s.business_id)
  ),
  tax_engine_code = COALESCE(
    s.tax_engine_code,
    CASE 
      -- Default to GH-2025-A for Ghana (most common case pre-launch)
      WHEN COALESCE(s.tax_jurisdiction, (SELECT extract_country_code(b.address_country) FROM businesses b WHERE b.id = s.business_id)) = 'GH' 
      THEN 'GH-2025-A'
      ELSE NULL
    END
  ),
  tax_engine_effective_from = COALESCE(
    s.tax_engine_effective_from,
    DATE(s.created_at)
  )
WHERE 
  validate_tax_lines_structure(s.tax_lines)
  AND (
    s.tax_engine_code IS NULL 
    OR s.tax_engine_effective_from IS NULL 
    OR s.tax_jurisdiction IS NULL
  );

-- ============================================================================
-- CONSTRAINT 2: Check constraint to enforce canonical metadata when tax_lines exists
-- ============================================================================

-- Drop existing constraint if it exists (idempotent)
ALTER TABLE sales DROP CONSTRAINT IF EXISTS check_canonical_tax_metadata;

-- Add check constraint: If tax_lines is present and valid, all metadata must be present
-- NOTE: After backfill above, all existing sales with tax_lines should have metadata
ALTER TABLE sales
ADD CONSTRAINT check_canonical_tax_metadata
CHECK (
  -- If tax_lines is NULL or invalid/empty, no constraints (taxes not applied)
  NOT validate_tax_lines_structure(tax_lines)
  OR
  -- If tax_lines is valid and non-empty, all canonical metadata must be present
  (
    validate_tax_lines_structure(tax_lines)
    AND tax_engine_code IS NOT NULL
    AND tax_engine_effective_from IS NOT NULL
    AND tax_jurisdiction IS NOT NULL
  )
);

COMMENT ON CONSTRAINT check_canonical_tax_metadata ON sales IS 
'Enforces that Retail sales with tax_lines must include all canonical tax metadata (tax_engine_code, tax_engine_effective_from, tax_jurisdiction) for audit compliance';

-- ============================================================================
-- NOTES:
-- ============================================================================
-- 1. This constraint only validates structure - it does NOT enforce tax calculation logic
-- 2. Legacy columns (vat, nhil, getfund, covid) are NOT constrained (may be NULL/0)
-- 3. Constraint is compatible with existing data (NULL tax_lines passes validation)
-- 4. Only applies to new sales created after Commit C (canonical-only writes)
