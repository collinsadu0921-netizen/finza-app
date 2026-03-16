-- ============================================================================
-- Migration 181: Retail Posting Debug Log (Evidence Capture Only)
-- ============================================================================
-- This migration creates a debug table to capture evidence of journal_lines
-- construction before post_journal_entry() is called.
-- 
-- PURPOSE: Prove why credit=0 in TEST A/B (no fixes, evidence only)
-- REMOVABLE: This table and logging can be removed after root cause is proven
-- ============================================================================

-- Create debug log table
CREATE TABLE IF NOT EXISTS public.retail_posting_debug_log (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  sale_id uuid NOT NULL,
  business_id uuid,
  gross_total numeric,
  net_total numeric,
  total_tax_amount numeric,
  total_cogs numeric,
  tax_lines_jsonb jsonb,
  journal_lines jsonb,
  line_count int,
  debit_sum numeric,
  credit_sum numeric,
  credit_count int,
  tax_shape text,  -- 'object' | 'array' | 'null' | 'other'
  note text
);

-- Add index for efficient querying
CREATE INDEX IF NOT EXISTS idx_retail_posting_debug_log_sale_id 
  ON public.retail_posting_debug_log(sale_id, created_at DESC);

-- Add comment
COMMENT ON TABLE public.retail_posting_debug_log IS 
'DEBUG ONLY: Captures evidence of journal_lines construction before post_journal_entry() call. Used to diagnose credit=0 issue in TEST A/B. Can be removed after root cause is proven.';

COMMENT ON COLUMN public.retail_posting_debug_log.tax_shape IS 
'Shape of tax_lines_jsonb: null, object, array, or other';

COMMENT ON COLUMN public.retail_posting_debug_log.journal_lines IS 
'Exact JSONB array passed to post_journal_entry()';

COMMENT ON COLUMN public.retail_posting_debug_log.credit_sum IS 
'Sum of all credit values in journal_lines (should be > 0 but is 0 in failing tests)';
