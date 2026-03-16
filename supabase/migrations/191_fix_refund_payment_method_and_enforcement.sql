-- ============================================================================
-- MIGRATION: Fix Refund Payment Method & Add Enforcement
-- ============================================================================
-- Fixes post_sale_refund_to_ledger() to:
-- 1. Query original sale journal entry to find payment account (Cash vs clearing)
-- 2. Credit the SAME account that was debited in original sale
-- 3. Use CURRENT_DATE (refund processing date) for entry_date, not sale date
--    - This ensures refunds appear in correct period for Register Report reconciliation
-- 4. Use reference_type='refund' (not 'sale_refund') for clarity
-- 5. Add hard guard: Cash refunds MUST credit Cash (1000) - fails with CASH_REFUND_MUST_CREDIT_CASH
-- 6. Add enforcement: Non-cash refunds MUST NOT credit Cash (1000)
--
-- This fixes the critical bug where:
-- - Non-cash refunds incorrectly credited Cash account
-- - Refunds used sale date instead of refund date (causing Register Report to show ₵170 received, ₵0 paid)
-- - Cash refunds didn't properly reduce Cash in Register Report (variance incorrect)
--
-- FINANCIAL AMOUNTS:
-- - Gross refund = sale.amount (from sale record, canonical value)
-- - Net refund = sale.amount - sum(tax_lines amounts) (from tax_lines JSONB)
-- - Tax refunds = individual tax line amounts (from tax_lines JSONB)
-- - All amounts come from canonical sale values, not UI calculations
--
-- NOTE: Reports need to be updated to look for reference_type='refund' instead of 'sale_refund'
-- ============================================================================

-- ============================================================================
-- STEP 1: Update post_sale_refund_to_ledger() to use correct payment account
-- ============================================================================

DROP FUNCTION IF EXISTS post_sale_refund_to_ledger(UUID) CASCADE;

CREATE OR REPLACE FUNCTION post_sale_refund_to_ledger(p_sale_id UUID)
RETURNS UUID AS $$
DECLARE
  sale_record RECORD;
  original_journal_entry RECORD;
  business_id_val UUID;
  payment_account_id UUID;  -- Changed from cash_account_id
  payment_account_code TEXT;  -- NEW: Track which account to credit
  revenue_account_id UUID;
  cogs_account_id UUID;
  inventory_account_id UUID;
  journal_id UUID;
  subtotal NUMERIC;
  total_cogs NUMERIC := 0;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
  total_tax_amount NUMERIC := 0;
  has_payment_credit BOOLEAN := FALSE;  -- NEW: Track if payment account is credited
  line JSONB;  -- NEW: For validation loop
  line_account_code TEXT;  -- NEW: For enforcement check
BEGIN
  -- IDEMPOTENCY GUARD: Check if refund journal entry already exists
  -- Reference type: 'refund', reference_id: sale_id
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'refund'
    AND reference_id = p_sale_id
    LIMIT 1;

  IF journal_id IS NOT NULL THEN
    -- Refund already posted - return existing journal entry ID (idempotent)
    RETURN journal_id;
  END IF;

  -- Get sale details
  SELECT 
    s.business_id,
    s.amount,
    s.created_at,
    s.description,
    s.tax_lines,
    s.payment_status
  INTO sale_record
  FROM sales s
  WHERE s.id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;

  -- Validate sale is refunded
  IF sale_record.payment_status != 'refunded' THEN
    RAISE EXCEPTION 'Sale % is not refunded (payment_status: %). Cannot post refund to ledger.', 
      p_sale_id, sale_record.payment_status;
  END IF;

  business_id_val := sale_record.business_id;

  -- GUARD: Assert accounting period is open
  -- Refunds must be posted in open periods
  -- Use CURRENT_DATE (refund processing date) not sale date for period check
  PERFORM assert_accounting_period_is_open(business_id_val, CURRENT_DATE);

  -- Get original sale journal entry to ensure it exists
  SELECT id, date, description
  INTO original_journal_entry
  FROM journal_entries
  WHERE reference_type = 'sale'
    AND reference_id = p_sale_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original sale journal entry not found for sale %. Cannot post refund reversal without original entry.', 
      p_sale_id;
  END IF;

  -- CRITICAL FIX: Find original payment account from original sale journal entry
  -- Original sale DEBITS the payment account (Cash 1000, Bank 1010, MoMo 1020, Card 1030)
  -- Refund must CREDIT the SAME account
  SELECT a.id, a.code INTO payment_account_id, payment_account_code
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE je.reference_type = 'sale'
    AND je.reference_id = p_sale_id
    AND a.code IN ('1000', '1010', '1020', '1030')  -- Cash, Bank, MoMo, Card
    AND jel.debit > 0  -- Original sale DEBITS the payment account
  LIMIT 1;

  IF payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Original sale journal entry does not have payment account debit (Cash/Bank/MoMo/Card). Cannot determine refund payment account for sale %.', 
      p_sale_id;
  END IF;

  -- Calculate total COGS from sale_items (same as original sale)
  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0)
  INTO total_cogs
  FROM sale_items
  WHERE sale_id = p_sale_id;

  -- Parse tax_lines JSONB metadata (same format as original sale)
  tax_lines_jsonb := sale_record.tax_lines;
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
          -- Sum tax amounts to calculate subtotal
          total_tax_amount := total_tax_amount + COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Calculate subtotal: total - sum of all taxes (same as original sale)
  subtotal := COALESCE(sale_record.amount, 0) - total_tax_amount;

  -- COA GUARD: Validate all accounts exist before posting
  PERFORM assert_account_exists(business_id_val, payment_account_code);  -- Use payment_account_code
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue
  IF total_cogs > 0 THEN
    PERFORM assert_account_exists(business_id_val, '5000'); -- COGS Expense
    PERFORM assert_account_exists(business_id_val, '1200'); -- Inventory Asset
  END IF;
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs using control keys and codes
  revenue_account_id := get_account_by_code(business_id_val, '4000'); -- Service Revenue
  IF total_cogs > 0 THEN
    cogs_account_id := get_account_by_code(business_id_val, '5000'); -- Cost of Sales
    inventory_account_id := get_account_by_code(business_id_val, '1200'); -- Inventory Asset
  END IF;

  -- Validate all required accounts exist
  IF payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Payment account not found for business: %', business_id_val;
  END IF;
  IF revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Revenue account (4000) not found for business: %', business_id_val;
  END IF;
  IF total_cogs > 0 THEN
    IF cogs_account_id IS NULL THEN
      RAISE EXCEPTION 'COGS account (5000) not found for business: %', business_id_val;
    END IF;
    IF inventory_account_id IS NULL THEN
      RAISE EXCEPTION 'Inventory account (1200) not found for business: %', business_id_val;
    END IF;
  END IF;

  -- Build reversal journal entry lines (opposite of original sale)
  -- Original sale: Payment DEBIT, Revenue CREDIT, COGS DEBIT, Inventory CREDIT, Taxes CREDIT
  -- Refund: Payment CREDIT, Revenue DEBIT, COGS CREDIT, Inventory DEBIT, Taxes DEBIT
  -- 
  -- CRITICAL: Cash refunds MUST credit Cash (1000) = refunded_amount_gross
  -- Why: Cash refunds reduce cash in drawer. Register Report reconciles:
  --   - Cash Received (from sales) - Cash Paid (from refunds) = Net Cash
  --   - If refunds don't credit Cash, Register Report shows incorrect variance
  --   - Example: Sale ₵100 cash, Refund ₵70 cash → Should show Cash Paid ₵70, Closing ₵30
  --   - Without Cash credit, Register Report shows ₵100 received, ₵0 paid, variance ₵70 (WRONG)
  --
  -- FIXED: Use payment_account_id (from original sale) instead of always Cash
  -- Financial amounts come from canonical sale values: sale.amount (gross), tax_lines (taxes)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', payment_account_id,  -- FIXED: Use payment account from original sale, not always Cash
      'credit', sale_record.amount, -- CREDIT = refunded_amount_gross (from sale.amount, canonical value)
      'description', 'Refund: ' || COALESCE(payment_account_code, 'Payment') || ' payment reversed'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'debit', subtotal, -- DEBIT (opposite of original CREDIT)
      'description', 'Refund: Sales revenue reversed'
    )
  );

  -- Add COGS and Inventory reversals (only if COGS > 0, same as original sale)
  IF total_cogs > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', cogs_account_id,
        'credit', total_cogs, -- CREDIT (opposite of original DEBIT)
        'description', 'Refund: Cost of goods sold reversed'
      ),
      jsonb_build_object(
        'account_id', inventory_account_id,
        'debit', total_cogs, -- DEBIT (opposite of original CREDIT)
        'description', 'Refund: Inventory restored'
      )
    );
  END IF;

  -- Add tax reversals: iterate parsed_tax_lines and post each reversed
  -- Original sale taxes are CREDIT (output taxes) → Refund taxes are DEBIT (reverse output)
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    -- Only post tax lines with ledger_account_code
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      -- Reverse tax journal line: original was CREDIT, refund is DEBIT
      -- For sales, taxes are always output taxes (credit), so refunds are always debit
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount, -- DEBIT (opposite of original CREDIT)
            'description', 'Refund: ' || COALESCE(tax_code, 'Tax') || ' tax reversed'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        -- If original was debit (shouldn't happen for sales, but handle for completeness)
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount, -- CREDIT (opposite of original DEBIT)
            'description', 'Refund: ' || COALESCE(tax_code, 'Tax') || ' tax reversed'
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- ENFORCEMENT: Validate payment account credit exists in journal_lines
  -- Check if payment_account_id has a credit line
  FOR line IN SELECT * FROM jsonb_array_elements(journal_lines)
  LOOP
    IF (line->>'account_id')::UUID = payment_account_id 
       AND COALESCE((line->>'credit')::NUMERIC, 0) > 0 THEN
      has_payment_credit := TRUE;
      EXIT;
    END IF;
  END LOOP;

  -- HARD GUARD: Cash refunds MUST credit Cash (1000)
  -- This is critical for Register Report reconciliation
  -- Cash refunds reduce cash in drawer, so Cash account must be credited
  IF payment_account_code = '1000' AND NOT has_payment_credit THEN
    RAISE EXCEPTION 'CASH_REFUND_MUST_CREDIT_CASH: Cash refund must credit Cash account (1000). Journal entry missing Cash CREDIT line. Sale ID: %', 
      p_sale_id;
  END IF;

  -- ENFORCEMENT RULE 2: If original was non-cash, refund MUST NOT credit Cash
  -- Check if any line credits Cash when it shouldn't
  IF payment_account_code != '1000' THEN
    FOR line IN SELECT * FROM jsonb_array_elements(journal_lines)
    LOOP
      -- Get account code for this line
      SELECT code INTO line_account_code
      FROM accounts
      WHERE id = (line->>'account_id')::UUID;
      
      IF line_account_code = '1000' AND COALESCE((line->>'credit')::NUMERIC, 0) > 0 THEN
        RAISE EXCEPTION 'ENFORCEMENT FAILED: Non-cash refund (original payment: %) must credit clearing account, not Cash (1000). Journal entry incorrectly credits Cash. Sale ID: %', 
          payment_account_code, p_sale_id;
      END IF;
    END LOOP;
  END IF;

  -- Post reversal journal entry (post_journal_entry validates debits = credits)
  -- EXPLICIT: Use canonical 15-parameter signature with posting_source = 'system'
  -- Refunds are system-generated operations (even if supervisor-approved)
  -- CRITICAL: Use CURRENT_DATE (refund processing date) not sale date
  -- This ensures refunds appear in the correct period for Register Report reconciliation
  SELECT post_journal_entry(
    business_id_val,
    CURRENT_DATE, -- Use refund processing date (when refund was processed), not original sale date
    'Refund: Sale' || COALESCE(': ' || sale_record.description, ''),
    'refund', -- Reference type: refund (identifies this as a refund transaction)
    p_sale_id, -- Reference ID: sale_id (the refunded sale)
    journal_lines,
    FALSE,  -- p_is_adjustment
    NULL,   -- p_adjustment_reason
    NULL,   -- p_adjustment_ref
    NULL,   -- p_created_by
    NULL,   -- p_entry_type
    NULL,   -- p_backfill_reason
    NULL,   -- p_backfill_actor
    NULL,   -- p_posted_by_accountant_id (not required for system postings)
    'system'  -- EXPLICIT: Refund postings are system-generated
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_refund_to_ledger IS 
'FIXED: Creates reversal journal entry for refunded sales. 

KEY BEHAVIORS:
- Queries original sale journal entry to find payment account (Cash 1000 vs clearing 1010/1020/1030)
- Credits the SAME account that was debited in original sale
- Uses CURRENT_DATE (refund processing date) for entry_date, not original sale date
- This ensures refunds appear in correct period for Register Report reconciliation

ENFORCEMENT:
- Cash refunds MUST credit Cash (1000) - hard fail with CASH_REFUND_MUST_CREDIT_CASH if missing
- Non-cash refunds MUST NOT credit Cash (1000) - hard fail if present
- Why: Cash refunds reduce cash in drawer, so Cash account must be credited for Register Report to balance

REVERSALS:
- DEBIT Revenue (4000) = refunded net amount
- DEBIT VAT/Taxes (2100, etc.) = refunded tax amounts
- CREDIT Payment Account (1000/1010/1020/1030) = refunded gross amount
- CREDIT COGS (5000) and DEBIT Inventory (1200) if applicable

VALIDATION:
- Enforces period open check (uses refund date, not sale date)
- Double-entry balance (debits = credits)
- Idempotency (checks for existing refund journal entry)';

-- ============================================================================
-- STEP 2: Verification Queries (for testing)
-- ============================================================================

-- Query to verify refunds use correct payment accounts
-- Run this after migration to verify existing refunds
COMMENT ON FUNCTION post_sale_refund_to_ledger IS 
'FIXED: Creates reversal journal entry for refunded sales. Queries original sale to find payment account (Cash vs clearing) and credits the SAME account. Enforces: Cash refunds MUST credit Cash (1000), non-cash refunds MUST NOT credit Cash. Reverses Revenue, Taxes, COGS, and Inventory proportionally. Enforces period open check, double-entry balance, and idempotency.

VERIFICATION QUERY:
SELECT 
  s.id AS sale_id,
  original_account.code AS original_payment_account,
  refund_account.code AS refund_payment_account,
  CASE 
    WHEN original_account.code = refund_account.code THEN ''OK''
    ELSE ''ACCOUNT MISMATCH''
  END AS verification
FROM sales s
JOIN journal_entries original_je ON original_je.reference_type = ''sale'' AND original_je.reference_id = s.id
JOIN journal_entry_lines original_payment ON original_payment.journal_entry_id = original_je.id AND original_payment.debit > 0
JOIN accounts original_account ON original_account.id = original_payment.account_id AND original_account.code IN (''1000'', ''1010'', ''1020'', ''1030'')
JOIN journal_entries refund_je ON refund_je.reference_type = ''sale_refund'' AND refund_je.reference_id = s.id
JOIN journal_entry_lines refund_payment ON refund_payment.journal_entry_id = refund_je.id AND refund_payment.credit > 0
JOIN accounts refund_account ON refund_account.id = refund_payment.account_id AND refund_account.code IN (''1000'', ''1010'', ''1020'', ''1030'')
WHERE s.payment_status = ''refunded''
  AND original_account.code != refund_account.code;';
