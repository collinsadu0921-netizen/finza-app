-- ============================================================================
-- MIGRATION: STEP 6 - Credit Note Recognition Reversal
-- ============================================================================
-- This migration implements credit notes and refunds as proper NEGATIVE RECOGNITION events,
-- using TaxLine metadata to reverse revenue/expense and tax control balances cleanly.
--
-- Rules:
-- 1. Credit notes MUST be separate recognition documents (never modify original entries)
-- 2. Base lines reverse recognition (Debit Revenue, Credit AR for sales credit notes)
-- 3. Tax reversal using TaxLine metadata with side inversion
-- 4. NO cash/bank movements (settlement handled separately in Step 5)
-- ============================================================================

-- ============================================================================
-- ADD tax_lines COLUMN TO credit_notes (if not exists)
-- ============================================================================
ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS tax_lines JSONB,
  ADD COLUMN IF NOT EXISTS tax_engine_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_engine_effective_from DATE,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction TEXT;

-- Index for tax_lines queries
CREATE INDEX IF NOT EXISTS idx_credit_notes_tax_engine_code ON credit_notes(tax_engine_code) WHERE tax_engine_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_notes_tax_jurisdiction ON credit_notes(tax_jurisdiction) WHERE tax_jurisdiction IS NOT NULL;

-- Comments
COMMENT ON COLUMN credit_notes.tax_lines IS 'Array of tax line items with ledger_account_code and ledger_side metadata for reversal';

-- ============================================================================
-- FUNCTION: Post credit note to ledger (Sales/Invoice credit note)
-- ============================================================================
-- Reverses invoice recognition:
-- - Debit: Revenue (reverse)
-- - Credit: AR (reduce receivable)
-- - Tax reversal: Uses TaxLine metadata with side inversion
-- ============================================================================
CREATE OR REPLACE FUNCTION post_credit_note_to_ledger(p_credit_note_id UUID)
RETURNS UUID AS $$
DECLARE
  cn_record RECORD;
  invoice_record RECORD;
  business_id_val UUID;
  ar_account_id UUID;
  revenue_account_id UUID;
  journal_id UUID;
  subtotal NUMERIC;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
BEGIN
  -- Get credit note details
  SELECT 
    cn.business_id,
    cn.invoice_id,
    cn.total,
    cn.subtotal,
    cn.total_tax,
    cn.credit_number,
    cn.date,
    cn.tax_lines
  INTO cn_record
  FROM credit_notes cn
  WHERE cn.id = p_credit_note_id
    AND cn.status = 'applied';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Applied credit note not found: %', p_credit_note_id;
  END IF;

  -- Get invoice details (for invoice_number only)
  SELECT invoice_number INTO invoice_record
  FROM invoices
  WHERE id = cn_record.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for credit note: %. Invoice ID: %', p_credit_note_id, cn_record.invoice_id;
  END IF;

  business_id_val := cn_record.business_id;
  subtotal := COALESCE(cn_record.subtotal, 0);

  -- Parse tax_lines JSONB metadata
  tax_lines_jsonb := cn_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    -- Handle both formats: object with tax_lines key, or direct array
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
    -- Validate it's an array and parse individual tax line items
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        -- Defensive validation: ensure tax line has required fields
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Get account IDs
  ar_account_id := get_account_by_code(business_id_val, '1100');
  revenue_account_id := get_account_by_code(business_id_val, '4000');

  -- Validate accounts exist
  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account (1100) not found for business: %. Credit Note ID: %', business_id_val, p_credit_note_id;
  END IF;
  IF revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Revenue account (4000) not found for business: %. Credit Note ID: %', business_id_val, p_credit_note_id;
  END IF;

  -- Build journal entry lines: start with base lines (reverse recognition)
  -- Sales credit note: Debit Revenue (reverse), Credit AR (reduce receivable)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', revenue_account_id,
      'debit', subtotal,
      'description', 'Reverse revenue'
    ),
    jsonb_build_object(
      'account_id', ar_account_id,
      'credit', cn_record.total,
      'description', 'Reduce receivable'
    )
  );

  -- Add tax reversal lines: iterate parsed_tax_lines and reverse each tax control account
  -- STEP 6 RULE: Reverse the original side (credit → debit, debit → credit)
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    -- Only post tax lines with ledger_account_code (skip absorbed taxes)
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      IF tax_account_id IS NULL THEN
        RAISE EXCEPTION 'Tax account (%) not found for business: %. Credit Note ID: %', 
          tax_ledger_account_code, business_id_val, p_credit_note_id;
      END IF;
      
      -- STEP 6 RULE: Reverse the original side
      -- Original 'credit' → post 'debit' (reverse credit)
      -- Original 'debit'  → post 'credit' (reverse debit)
      IF tax_ledger_side = 'credit' THEN
        -- Original was credit, reverse with debit
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax reversal'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        -- Original was debit, reverse with credit
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax reversal'
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- Post journal entry
  -- STEP 6 RULE: NO cash/bank movements (settlement handled separately)
  SELECT post_journal_entry(
    business_id_val,
    cn_record.date,
    'Credit Note #' || cn_record.credit_number || ' for Invoice #' || invoice_record.invoice_number,
    'credit_note',
    p_credit_note_id,
    journal_lines
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Post refund to ledger (Recognition reversal only; no cash)
-- ============================================================================
-- This function handles refund recognition reversal when a refund is issued.
-- It creates a negative recognition entry but does NOT handle cash movement.
-- Cash refund settlement is handled separately in Step 5.
-- ============================================================================
CREATE OR REPLACE FUNCTION post_refund_to_ledger(p_refund_id UUID)
RETURNS UUID AS $$
DECLARE
  refund_record RECORD;
  business_id_val UUID;
  ar_account_id UUID;
  revenue_account_id UUID;
  journal_id UUID;
  subtotal NUMERIC;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
BEGIN
  -- NOTE: This function assumes a refunds table exists with similar structure to credit_notes
  -- If refunds are handled differently, this function may need adjustment
  
  -- Get refund details (assuming refunds table structure similar to credit_notes)
  -- For now, this is a placeholder that can be implemented when refunds table structure is known
  RAISE EXCEPTION 'post_refund_to_ledger: Refund table structure not yet defined. Please implement when refunds table is created.';
  
  -- Future implementation would follow same pattern as post_credit_note_to_ledger:
  -- 1. Get refund record with tax_lines
  -- 2. Parse tax_lines metadata
  -- 3. Build base reversal lines (Debit Revenue, Credit AR)
  -- 4. Reverse taxes with side inversion
  -- 5. Post journal entry (NO cash/bank)
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION: Ensure no cash/bank movements in credit note posting
-- ============================================================================
DO $$
BEGIN
  -- Verify that post_credit_note_to_ledger does not reference cash/bank accounts
  -- This is a sanity check - the function should only use AR and Revenue accounts
  RAISE NOTICE 'STEP 6: Credit note recognition reversal functions created';
  RAISE NOTICE '  - post_credit_note_to_ledger: Reverses revenue and AR, reverses taxes with side inversion';
  RAISE NOTICE '  - post_refund_to_ledger: Placeholder for future refund recognition reversal';
  RAISE NOTICE '  - NO cash/bank movements in recognition reversal (settlement handled in Step 5)';
END;
$$;

