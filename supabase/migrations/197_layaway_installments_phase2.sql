-- ============================================================================
-- MIGRATION: Layaway / Installments (Phase 2 - Retail-Bound AR, Ledger-Safe)
-- ============================================================================
-- This migration creates layaway support with Accounts Receivable.
-- AR exists ONLY for unpaid balances. Ledger is the source of truth.
--
-- GUARDRAILS:
-- - Layaway is explicit (opt-in per sale)
-- - Customer is REQUIRED
-- - No implicit credit
-- - AR exists ONLY for unpaid balances
-- - Ledger is the source of truth (no UI math)
-- ============================================================================

-- ============================================================================
-- STEP 1: Create layaway_plans table
-- ============================================================================
CREATE TABLE IF NOT EXISTS layaway_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  total_amount NUMERIC NOT NULL CHECK (total_amount > 0),
  deposit_amount NUMERIC NOT NULL CHECK (deposit_amount >= 0),
  outstanding_amount NUMERIC NOT NULL CHECK (outstanding_amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT deposit_plus_outstanding CHECK (deposit_amount + outstanding_amount = total_amount)
);

-- Indexes for layaway_plans
CREATE INDEX IF NOT EXISTS idx_layaway_plans_business_id ON layaway_plans(business_id);
CREATE INDEX IF NOT EXISTS idx_layaway_plans_customer_id ON layaway_plans(customer_id);
CREATE INDEX IF NOT EXISTS idx_layaway_plans_sale_id ON layaway_plans(sale_id);
CREATE INDEX IF NOT EXISTS idx_layaway_plans_status ON layaway_plans(status);
CREATE INDEX IF NOT EXISTS idx_layaway_plans_created_at ON layaway_plans(created_at DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_layaway_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_layaway_plans_updated_at ON layaway_plans;
CREATE TRIGGER update_layaway_plans_updated_at
  BEFORE UPDATE ON layaway_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_layaway_plans_updated_at();

-- ============================================================================
-- STEP 2: Create layaway_payments table
-- ============================================================================
CREATE TABLE IF NOT EXISTS layaway_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layaway_plan_id UUID NOT NULL REFERENCES layaway_plans(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'mobile_money', 'bank_transfer')),
  payment_reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for layaway_payments
CREATE INDEX IF NOT EXISTS idx_layaway_payments_plan_id ON layaway_payments(layaway_plan_id);
CREATE INDEX IF NOT EXISTS idx_layaway_payments_created_at ON layaway_payments(created_at DESC);

-- ============================================================================
-- STEP 3: Add layaway flag to sales table
-- ============================================================================
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS is_layaway BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC DEFAULT 0;

-- Index for layaway sales
CREATE INDEX IF NOT EXISTS idx_sales_is_layaway ON sales(is_layaway) WHERE is_layaway = TRUE;

-- ============================================================================
-- STEP 4: RLS Policies for layaway_plans
-- ============================================================================
ALTER TABLE layaway_plans ENABLE ROW LEVEL SECURITY;

-- Users can view layaway plans for their business
CREATE POLICY "Users can view layaway plans for their business"
  ON layaway_plans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = layaway_plans.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- Users can create layaway plans for their business
CREATE POLICY "Users can create layaway plans for their business"
  ON layaway_plans FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = layaway_plans.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- Users can update layaway plans for their business
CREATE POLICY "Users can update layaway plans for their business"
  ON layaway_plans FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = layaway_plans.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = layaway_plans.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- STEP 5: RLS Policies for layaway_payments
-- ============================================================================
ALTER TABLE layaway_payments ENABLE ROW LEVEL SECURITY;

-- Users can view layaway payments for their business
CREATE POLICY "Users can view layaway payments for their business"
  ON layaway_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM layaway_plans
      JOIN businesses ON businesses.id = layaway_plans.business_id
      WHERE layaway_plans.id = layaway_payments.layaway_plan_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- Users can create layaway payments for their business
CREATE POLICY "Users can create layaway payments for their business"
  ON layaway_payments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM layaway_plans
      JOIN businesses ON businesses.id = layaway_plans.business_id
      WHERE layaway_plans.id = layaway_payments.layaway_plan_id
      AND layaway_plans.status = 'active'
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- STEP 6: Add comments documenting layaway constraints
-- ============================================================================
COMMENT ON TABLE layaway_plans IS 
'Layaway / Installments (Phase 2 - Retail-Bound AR, Ledger-Safe).
Tracks customer payment plans. AR exists ONLY for unpaid balances.
Ledger is the source of truth - no UI math.';

COMMENT ON COLUMN layaway_plans.outstanding_amount IS 
'Outstanding amount = total_amount - payments_applied.
Updated from ledger AR balance (source of truth).';

COMMENT ON COLUMN layaway_plans.status IS 
'Plan status: active (outstanding > 0), completed (outstanding = 0), cancelled.';

COMMENT ON COLUMN sales.is_layaway IS 
'Flag indicating this sale is a layaway sale (requires customer and deposit).';

COMMENT ON COLUMN sales.deposit_amount IS 
'Deposit amount paid at sale creation (for layaway sales).';

-- ============================================================================
-- STEP 7: Helper Function to Resolve Payment Account from Method
-- ============================================================================
-- Resolves payment account ID and code from payment method string
-- ============================================================================
CREATE OR REPLACE FUNCTION resolve_payment_account_from_method(
  p_business_id UUID,
  p_payment_method TEXT
)
RETURNS TABLE (
  payment_account_id UUID,
  payment_account_code TEXT
) AS $$
DECLARE
  cash_account_id UUID;
  bank_account_id UUID;
  momo_account_id UUID;
  card_account_id UUID;
  cash_account_code TEXT;
  bank_account_code TEXT;
BEGIN
  -- Get control account codes
  cash_account_code := get_control_account_code(p_business_id, 'CASH');
  bank_account_code := get_control_account_code(p_business_id, 'BANK');
  
  -- Get account IDs
  cash_account_id := get_account_by_code(p_business_id, cash_account_code);
  bank_account_id := get_account_by_code(p_business_id, bank_account_code);
  momo_account_id := get_account_by_code(p_business_id, '1020'); -- MoMo not a control key
  card_account_id := get_account_by_code(p_business_id, '1030'); -- Card clearing (if exists)

  -- Determine account based on payment method
  CASE LOWER(p_payment_method)
    WHEN 'cash' THEN
      RETURN QUERY SELECT cash_account_id, cash_account_code;
    WHEN 'bank' THEN
      RETURN QUERY SELECT bank_account_id, bank_account_code;
    WHEN 'mobile_money' THEN
      RETURN QUERY SELECT momo_account_id, '1020';
    WHEN 'momo' THEN
      RETURN QUERY SELECT momo_account_id, '1020';
    WHEN 'card' THEN
      -- Card payments use bank clearing or dedicated card account
      IF card_account_id IS NOT NULL THEN
        RETURN QUERY SELECT card_account_id, '1030';
      ELSE
        RETURN QUERY SELECT bank_account_id, bank_account_code;
      END IF;
    WHEN 'bank_transfer' THEN
      RETURN QUERY SELECT bank_account_id, bank_account_code;
    ELSE
      -- Default to cash
      RETURN QUERY SELECT cash_account_id, cash_account_code;
  END CASE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION resolve_payment_account_from_method IS 
'Resolves payment account ID and code from payment method string.
Returns account_id and account_code for the appropriate payment account.';

-- ============================================================================
-- STEP 8: Ledger Posting Function for Layaway Sales
-- ============================================================================
-- Posts layaway sale with AR creation:
-- DEBIT Cash/Clearing = deposit_amount
-- DEBIT AR (1200) = outstanding_amount
-- CREDIT Revenue (4000) = net_base
-- CREDIT VAT (2100) = tax
-- ============================================================================
CREATE OR REPLACE FUNCTION post_layaway_sale_to_ledger(p_sale_id UUID)
RETURNS UUID AS $$
DECLARE
  sale_record RECORD;
  layaway_plan_record RECORD;
  business_id_val UUID;
  payment_account_id UUID;
  payment_account_code TEXT;
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
  total_tax_amount NUMERIC := 0;
  deposit_amount NUMERIC;
  outstanding_amount NUMERIC;
BEGIN
  -- IDEMPOTENCY GUARD: Check if journal entry already exists
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'sale'
    AND reference_id = p_sale_id
    LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  -- Get sale details
  SELECT 
    s.business_id,
    s.amount,
    s.created_at,
    s.description,
    s.tax_lines,
    s.payment_method,
    s.is_layaway,
    s.deposit_amount,
    s.payment_lines
  INTO sale_record
  FROM sales s
  WHERE s.id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;

  -- Validate sale is layaway
  IF NOT sale_record.is_layaway THEN
    RAISE EXCEPTION 'Sale % is not a layaway sale. Use post_sale_to_ledger instead.', p_sale_id;
  END IF;

  -- Get layaway plan
  SELECT 
    total_amount,
    deposit_amount AS plan_deposit,
    outstanding_amount AS plan_outstanding
  INTO layaway_plan_record
  FROM layaway_plans
  WHERE sale_id = p_sale_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Layaway plan not found for sale %', p_sale_id;
  END IF;

  business_id_val := sale_record.business_id;
  deposit_amount := COALESCE(sale_record.deposit_amount, layaway_plan_record.plan_deposit, 0);
  outstanding_amount := layaway_plan_record.plan_outstanding;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, sale_record.created_at::DATE);

  -- Parse tax_lines JSONB metadata
  tax_lines_jsonb := sale_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
          total_tax_amount := total_tax_amount + COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Calculate subtotal: total - sum of all taxes
  subtotal := COALESCE(sale_record.amount, 0) - total_tax_amount;

  -- Get account IDs
  ar_account_id := get_account_by_code(business_id_val, '1200');
  revenue_account_id := get_account_by_code(business_id_val, '4000');

  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'Accounts Receivable account (1200) not found for business: %', business_id_val;
  END IF;

  IF revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Revenue account (4000) not found for business: %', business_id_val;
  END IF;

  -- Resolve payment account from payment_method or payment_lines
  IF sale_record.payment_lines IS NOT NULL THEN
    -- Parse payment_lines to determine payment account
    DECLARE
      payment_lines_array JSONB;
      payment_line JSONB;
      payment_method_text TEXT;
    BEGIN
      payment_lines_array := CASE
        WHEN jsonb_typeof(sale_record.payment_lines) = 'string' THEN
          sale_record.payment_lines::jsonb
        ELSE
          sale_record.payment_lines
      END;

      IF jsonb_typeof(payment_lines_array) = 'array' AND jsonb_array_length(payment_lines_array) > 0 THEN
        payment_line := payment_lines_array->0;
        payment_method_text := payment_line->>'method';
      ELSE
        payment_method_text := sale_record.payment_method;
      END IF;
    END;
  ELSE
    payment_method_text := sale_record.payment_method;
  END IF;

  -- Resolve payment account using control keys
  SELECT 
    resolved.payment_account_id,
    resolved.payment_account_code
  INTO payment_account_id, payment_account_code
  FROM resolve_payment_account_from_method(business_id_val, payment_method_text) AS resolved;

  IF payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Payment account not found for method: %', payment_method_text;
  END IF;

  -- Build journal entry lines for layaway sale
  journal_lines := jsonb_build_array(
    -- DEBIT: Payment account (Cash/Clearing) for deposit
    jsonb_build_object(
      'account_id', payment_account_id,
      'debit', deposit_amount,
      'description', 'Layaway deposit: ' || COALESCE(payment_account_code, 'Payment')
    ),
    -- DEBIT: Accounts Receivable for outstanding
    jsonb_build_object(
      'account_id', ar_account_id,
      'debit', outstanding_amount,
      'description', 'Layaway: Accounts Receivable'
    ),
    -- CREDIT: Revenue
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', subtotal,
      'description', 'Layaway sale revenue'
    )
  );

  -- Add tax lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    sale_record.created_at::DATE,
    'Layaway Sale' || COALESCE(': ' || sale_record.description, ''),
    'sale',
    p_sale_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'system'
  ) INTO journal_id;

  IF journal_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create journal entry for layaway sale %', p_sale_id;
  END IF;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_layaway_sale_to_ledger IS 
'Posts layaway sale to ledger with AR creation.
DEBIT: Cash/Clearing (deposit), AR (1200) (outstanding)
CREDIT: Revenue (4000) (net), VAT (2100) (tax)
Revenue and VAT recognized at sale creation.';

-- ============================================================================
-- STEP 9: Ledger Posting Function for Layaway Payments
-- ============================================================================
-- Posts layaway payment:
-- DEBIT: Cash/Clearing
-- CREDIT: Accounts Receivable (1200)
-- No revenue or VAT on later payments.
-- ============================================================================
CREATE OR REPLACE FUNCTION post_layaway_payment_to_ledger(p_layaway_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record RECORD;
  layaway_plan_record RECORD;
  business_id_val UUID;
  payment_account_id UUID;
  payment_account_code TEXT;
  ar_account_id UUID;
  journal_id UUID;
  journal_lines JSONB;
BEGIN
  -- IDEMPOTENCY GUARD: Check if journal entry already exists
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'layaway_payment'
    AND reference_id = p_layaway_payment_id
    LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  -- Get payment details
  SELECT 
    lp.id,
    lp.amount,
    lp.payment_method,
    lp.payment_reference,
    lp.created_at,
    lp.layaway_plan_id,
    lp.created_by
  INTO payment_record
  FROM layaway_payments lp
  WHERE lp.id = p_layaway_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Layaway payment not found: %', p_layaway_payment_id;
  END IF;

  -- Get layaway plan
  SELECT 
    lp.business_id,
    lp.customer_id,
    lp.sale_id,
    lp.total_amount,
    lp.outstanding_amount
  INTO layaway_plan_record
  FROM layaway_plans lp
  WHERE lp.id = payment_record.layaway_plan_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Layaway plan not found for payment %', p_layaway_payment_id;
  END IF;

  IF layaway_plan_record.outstanding_amount <= 0 THEN
    RAISE EXCEPTION 'Layaway plan has no outstanding balance. Cannot post payment.';
  END IF;

  business_id_val := layaway_plan_record.business_id;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, payment_record.created_at::DATE);

  -- Get account IDs
  ar_account_id := get_account_by_code(business_id_val, '1200');

  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'Accounts Receivable account (1200) not found for business: %', business_id_val;
  END IF;

  -- Resolve payment account
  SELECT 
    resolved.payment_account_id,
    resolved.payment_account_code
  INTO payment_account_id, payment_account_code
  FROM resolve_payment_account_from_method(business_id_val, payment_record.payment_method) AS resolved;

  IF payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Payment account not found for method: %', payment_record.payment_method;
  END IF;

  -- Build journal entry lines
  journal_lines := jsonb_build_array(
    -- DEBIT: Payment account (Cash/Clearing)
    jsonb_build_object(
      'account_id', payment_account_id,
      'debit', payment_record.amount,
      'description', 'Layaway payment: ' || COALESCE(payment_account_code, 'Payment') ||
                     COALESCE(' (Ref: ' || payment_record.payment_reference || ')', '')
    ),
    -- CREDIT: Accounts Receivable
    jsonb_build_object(
      'account_id', ar_account_id,
      'credit', payment_record.amount,
      'description', 'Layaway payment: AR reduction'
    )
  );

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    payment_record.created_at::DATE,
    'Layaway Payment' || COALESCE(': ' || payment_record.payment_reference, ''),
    'layaway_payment',
    p_layaway_payment_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'system'
  ) INTO journal_id;

  IF journal_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create journal entry for layaway payment %', p_layaway_payment_id;
  END IF;

  -- Update layaway plan outstanding amount (recalculate from ledger)
  -- This is a denormalized field - ledger is source of truth
  UPDATE layaway_plans
  SET outstanding_amount = GREATEST(0, outstanding_amount - payment_record.amount),
      updated_at = NOW()
  WHERE id = payment_record.layaway_plan_id;

  -- Mark plan as completed if outstanding = 0
  UPDATE layaway_plans
  SET status = 'completed',
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = payment_record.layaway_plan_id
    AND outstanding_amount <= 0
    AND status = 'active';

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_layaway_payment_to_ledger IS 
'Posts layaway payment to ledger.
DEBIT: Cash/Clearing
CREDIT: Accounts Receivable (1200)
No revenue or VAT on later payments.';
