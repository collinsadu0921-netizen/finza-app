-- ============================================================================
-- MIGRATION: Phase 3 - Sale Ledger Reconciliation
-- ============================================================================
-- Enforces reconciliation between operational data and ledger data
-- Validates that:
-- 1. SUM(sale_items.cogs) == ledger COGS DEBIT
-- 2. Inventory stock reduction == ledger inventory CREDIT
-- ============================================================================

-- ============================================================================
-- FUNCTION: Validate sale reconciliation
-- ============================================================================
-- Returns TRUE if operational data matches ledger data, FALSE otherwise
-- Raises exception with details if mismatch detected
CREATE OR REPLACE FUNCTION validate_sale_reconciliation(p_sale_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  sale_record RECORD;
  business_id_val UUID;
  journal_entry_record RECORD;
  cogs_account_id UUID;
  inventory_account_id UUID;
  operational_cogs NUMERIC := 0;
  ledger_cogs_debit NUMERIC := 0;
  ledger_inventory_credit NUMERIC := 0;
  reconciliation_errors TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Get sale details
  SELECT 
    s.business_id,
    s.id
  INTO sale_record
  FROM sales s
  WHERE s.id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;

  business_id_val := sale_record.business_id;

  -- Get journal entry for this sale
  SELECT je.id INTO journal_entry_record
  FROM journal_entries je
  WHERE je.reference_type = 'sale'
    AND je.reference_id = p_sale_id
    AND je.business_id = business_id_val;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found for sale: %', p_sale_id;
  END IF;

  -- Get account IDs
  cogs_account_id := get_account_by_code(business_id_val, '5000'); -- Cost of Sales
  inventory_account_id := get_account_by_code(business_id_val, '1200'); -- Inventory

  IF cogs_account_id IS NULL THEN
    RAISE EXCEPTION 'COGS account (5000) not found for business: %', business_id_val;
  END IF;

  IF inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Inventory account (1200) not found for business: %', business_id_val;
  END IF;

  -- Calculate operational COGS from sale_items
  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0)
  INTO operational_cogs
  FROM sale_items
  WHERE sale_id = p_sale_id;

  -- Calculate ledger COGS DEBIT from journal entry lines
  SELECT COALESCE(SUM(COALESCE(debit, 0)), 0)
  INTO ledger_cogs_debit
  FROM journal_entry_lines jel
  WHERE jel.journal_entry_id = journal_entry_record.id
    AND jel.account_id = cogs_account_id;

  -- Calculate ledger Inventory CREDIT from journal entry lines
  SELECT COALESCE(SUM(COALESCE(credit, 0)), 0)
  INTO ledger_inventory_credit
  FROM journal_entry_lines jel
  WHERE jel.journal_entry_id = journal_entry_record.id
    AND jel.account_id = inventory_account_id;

  -- Validate COGS reconciliation
  IF ABS(operational_cogs - ledger_cogs_debit) > 0.01 THEN
    reconciliation_errors := array_append(
      reconciliation_errors,
      format('COGS mismatch: Operational COGS (%.2f) != Ledger COGS DEBIT (%.2f)', 
        operational_cogs, ledger_cogs_debit)
    );
  END IF;

  -- Validate Inventory reconciliation
  -- Inventory CREDIT should equal COGS (both represent the cost of inventory sold)
  IF ABS(operational_cogs - ledger_inventory_credit) > 0.01 THEN
    reconciliation_errors := array_append(
      reconciliation_errors,
      format('Inventory mismatch: Operational COGS (%.2f) != Ledger Inventory CREDIT (%.2f)', 
        operational_cogs, ledger_inventory_credit)
    );
  END IF;

  -- If there are any reconciliation errors, raise exception
  IF array_length(reconciliation_errors, 1) > 0 THEN
    RAISE EXCEPTION 'Sale reconciliation failed for sale %: %', 
      p_sale_id, 
      array_to_string(reconciliation_errors, '; ');
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Audit all sales for reconciliation mismatches
-- ============================================================================
-- Returns table of sales with reconciliation issues
CREATE OR REPLACE FUNCTION audit_sale_reconciliation(
  p_business_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  sale_id UUID,
  sale_date DATE,
  sale_amount NUMERIC,
  operational_cogs NUMERIC,
  ledger_cogs_debit NUMERIC,
  ledger_inventory_credit NUMERIC,
  cogs_mismatch NUMERIC,
  inventory_mismatch NUMERIC,
  has_mismatch BOOLEAN
) AS $$
DECLARE
  cogs_account_id UUID;
  inventory_account_id UUID;
BEGIN
  -- Get account IDs
  cogs_account_id := get_account_by_code(p_business_id, '5000'); -- Cost of Sales
  inventory_account_id := get_account_by_code(p_business_id, '1200'); -- Inventory

  IF cogs_account_id IS NULL OR inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Required accounts not found for business: %', p_business_id;
  END IF;

  RETURN QUERY
  WITH sale_operational_data AS (
    SELECT 
      s.id AS sale_id,
      s.created_at::DATE AS sale_date,
      s.amount AS sale_amount,
      COALESCE(SUM(COALESCE(si.cogs, 0)), 0) AS operational_cogs
    FROM sales s
    LEFT JOIN sale_items si ON si.sale_id = s.id
    WHERE s.business_id = p_business_id
      AND (p_start_date IS NULL OR s.created_at::DATE >= p_start_date)
      AND (p_end_date IS NULL OR s.created_at::DATE <= p_end_date)
    GROUP BY s.id, s.created_at, s.amount
  ),
  sale_ledger_data AS (
    SELECT 
      je.reference_id AS sale_id,
      COALESCE(SUM(CASE WHEN jel.account_id = cogs_account_id THEN jel.debit ELSE 0 END), 0) AS ledger_cogs_debit,
      COALESCE(SUM(CASE WHEN jel.account_id = inventory_account_id THEN jel.credit ELSE 0 END), 0) AS ledger_inventory_credit
    FROM journal_entries je
    INNER JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
    WHERE je.business_id = p_business_id
      AND je.reference_type = 'sale'
      AND (p_start_date IS NULL OR je.date >= p_start_date)
      AND (p_end_date IS NULL OR je.date <= p_end_date)
    GROUP BY je.reference_id
  )
  SELECT 
    sod.sale_id,
    sod.sale_date,
    sod.sale_amount,
    sod.operational_cogs,
    COALESCE(sld.ledger_cogs_debit, 0) AS ledger_cogs_debit,
    COALESCE(sld.ledger_inventory_credit, 0) AS ledger_inventory_credit,
    ABS(sod.operational_cogs - COALESCE(sld.ledger_cogs_debit, 0)) AS cogs_mismatch,
    ABS(sod.operational_cogs - COALESCE(sld.ledger_inventory_credit, 0)) AS inventory_mismatch,
    (ABS(sod.operational_cogs - COALESCE(sld.ledger_cogs_debit, 0)) > 0.01
     OR ABS(sod.operational_cogs - COALESCE(sld.ledger_inventory_credit, 0)) > 0.01) AS has_mismatch
  FROM sale_operational_data sod
  LEFT JOIN sale_ledger_data sld ON sld.sale_id = sod.sale_id
  ORDER BY sod.sale_date DESC, sod.sale_id;
END;
$$ LANGUAGE plpgsql;
