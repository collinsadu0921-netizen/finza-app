-- Migration 341: Add cit_rate_code to businesses
-- ============================================================================
-- Stores the CIT rate category for automatic CIT provision calculation.
-- Defaults to 'standard_25' (25%) which applies to most Ghanaian companies.
-- Non-Ghana businesses are unaffected — the field simply remains at the default
-- and the CIT UI is only shown when address_country = 'Ghana'.
-- ============================================================================

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS cit_rate_code TEXT
    NOT NULL DEFAULT 'standard_25'
    CHECK (cit_rate_code IN (
      'standard_25',    -- Standard company: 25% of net profit (default)
      'hotel_22',       -- Hotel industry: 22% of net profit
      'export_8',       -- Non-traditional exports: 8% of net profit
      'bank_20',        -- Banks (agri/leasing income): 20% of net profit
      'mining_35',      -- Mining & upstream petroleum: 35% of net profit
      'agro_1',         -- Agro-processing (first 5 yrs): 1% of net profit
      'presumptive_3',  -- Sole trader / presumptive: 3% of gross turnover
      'exempt'          -- Free zone / tax holiday: 0%
    ));

COMMENT ON COLUMN businesses.cit_rate_code IS
  'CIT rate category for Ghana tax. Drives automatic CIT provision calculation. Only used when address_country = Ghana.';
