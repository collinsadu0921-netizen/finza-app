# Partial Refund & Cross-Period Posting Audit

## Executive Summary

This document audits partial refund handling, cross-period refund posting rules, and enforcement mechanisms. Includes verification queries and test cases.

---

## 1. PARTIAL REFUNDS AUDIT

### 1.1 Current State

**Status:** ⚠️ **NOT SUPPORTED**
- Current `post_sale_refund_to_ledger()` always refunds full sale amount
- No proportional calculation for partial refunds
- Refund API route does not accept partial refund amount

**Issue:**
- System only supports full refunds
- Partial refunds would require proportional reversal of:
  - Revenue (proportional to refund amount)
  - VAT (proportional to refund amount)
  - COGS (if applicable)
  - Inventory (if applicable)

### 1.2 Expected Behavior for Partial Refunds

When a partial refund is issued:

1. **Calculate Refund Ratio:**
   ```
   refund_ratio = refund_amount / original_sale_amount
   ```

2. **Proportional Reversals:**
   - Revenue DEBIT = original_revenue_credit × refund_ratio
   - VAT DEBIT = original_vat_credit × refund_ratio (per tax line)
   - COGS CREDIT = original_cogs_debit × refund_ratio (if applicable)
   - Inventory DEBIT = original_inventory_credit × refund_ratio (if applicable)
   - Payment Account CREDIT = refund_amount (actual refund, not proportional)

3. **Rounding Rules:**
   - Use same rounding as original sale (Ghana: round to 2 decimals)
   - Ensure refund amounts sum to refund_amount (no drift)
   - Validate: refund_amount = sum(revenue_debit + all_tax_debits) - sum(cogs_credit + inventory_debit)

### 1.3 Verification Queries

```sql
-- Verify proportional refund calculations
-- For each refund, check that amounts are proportional to original sale
SELECT 
  s.id AS sale_id,
  s.amount AS original_sale_amount,
  refund_je.date AS refund_date,
  -- Original sale amounts
  original_revenue.credit AS original_revenue_credit,
  original_vat.credit AS original_vat_credit,
  -- Refund amounts
  refund_revenue.debit AS refund_revenue_debit,
  refund_vat.debit AS refund_vat_debit,
  -- Calculate ratio
  CASE 
    WHEN s.amount > 0 THEN refund_revenue.debit / original_revenue.credit
    ELSE NULL
  END AS revenue_ratio,
  CASE 
    WHEN original_vat.credit > 0 THEN refund_vat.debit / original_vat.credit
    ELSE NULL
  END AS vat_ratio,
  -- Verify ratios match (should be equal for full refund, proportional for partial)
  CASE 
    WHEN ABS(
      (refund_revenue.debit / NULLIF(original_revenue.credit, 0)) - 
      (refund_vat.debit / NULLIF(original_vat.credit, 0))
    ) < 0.01 THEN 'OK'
    ELSE 'RATIO MISMATCH'
  END AS ratio_check
FROM sales s
JOIN journal_entries original_je 
  ON original_je.reference_type = 'sale' 
  AND original_je.reference_id = s.id
JOIN journal_entry_lines original_revenue 
  ON original_revenue.journal_entry_id = original_je.id
JOIN accounts revenue_account 
  ON revenue_account.id = original_revenue.account_id 
  AND revenue_account.code = '4000'
JOIN journal_entry_lines original_vat 
  ON original_vat.journal_entry_id = original_je.id
JOIN accounts vat_account 
  ON vat_account.id = original_vat.account_id 
  AND vat_account.code = '2100'
JOIN journal_entries refund_je 
  ON refund_je.reference_type = 'sale_refund' 
  AND refund_je.reference_id = s.id
JOIN journal_entry_lines refund_revenue 
  ON refund_revenue.journal_entry_id = refund_je.id
  AND refund_revenue.account_id = revenue_account.id
JOIN journal_entry_lines refund_vat 
  ON refund_vat.journal_entry_id = refund_je.id
  AND refund_vat.account_id = vat_account.id
WHERE s.payment_status = 'refunded';

-- Verify no rounding drift in tax_lines
-- Compare original tax_lines amounts vs refund tax amounts
SELECT 
  s.id AS sale_id,
  s.amount AS original_amount,
  s.tax_lines AS original_tax_lines,
  -- Extract tax amounts from original tax_lines JSONB
  (s.tax_lines->'lines'->0->>'amount')::NUMERIC AS original_vat_from_json,
  -- Sum refund VAT debits
  SUM(refund_vat.debit) AS refund_vat_total,
  -- Calculate drift
  ABS(
    (s.tax_lines->'lines'->0->>'amount')::NUMERIC - 
    SUM(refund_vat.debit)
  ) AS tax_drift
FROM sales s
JOIN journal_entries refund_je 
  ON refund_je.reference_type = 'sale_refund' 
  AND refund_je.reference_id = s.id
JOIN journal_entry_lines refund_vat 
  ON refund_vat.journal_entry_id = refund_je.id
JOIN accounts vat_account 
  ON vat_account.id = refund_vat.account_id 
  AND vat_account.code = '2100'
WHERE s.payment_status = 'refunded'
  AND s.tax_lines IS NOT NULL
GROUP BY s.id, s.amount, s.tax_lines
HAVING ABS(
  (s.tax_lines->'lines'->0->>'amount')::NUMERIC - 
  SUM(refund_vat.debit)
) > 0.01;  -- Find refunds with tax drift > 1 cent

-- Verify correct payment account credit (Cash vs clearing)
SELECT 
  s.id AS sale_id,
  s.amount AS refund_amount,
  original_payment_account.code AS original_payment_account,
  refund_payment_account.code AS refund_payment_account,
  CASE 
    WHEN original_payment_account.code = refund_payment_account.code THEN 'OK'
    ELSE 'ACCOUNT MISMATCH'
  END AS account_check
FROM sales s
JOIN journal_entries original_je 
  ON original_je.reference_type = 'sale' 
  AND original_je.reference_id = s.id
JOIN journal_entry_lines original_payment 
  ON original_payment.journal_entry_id = original_je.id
  AND original_payment.debit > 0
JOIN accounts original_payment_account 
  ON original_payment_account.id = original_payment.account_id 
  AND original_payment_account.code IN ('1000', '1010', '1020', '1030')
JOIN journal_entries refund_je 
  ON refund_je.reference_type = 'sale_refund' 
  AND refund_je.reference_id = s.id
JOIN journal_entry_lines refund_payment 
  ON refund_payment.journal_entry_id = refund_je.id
  AND refund_payment.credit > 0
JOIN accounts refund_payment_account 
  ON refund_payment_account.id = refund_payment.account_id 
  AND refund_payment_account.code IN ('1000', '1010', '1020', '1030')
WHERE s.payment_status = 'refunded'
  AND original_payment_account.code != refund_payment_account.code;  -- Find mismatches
```

---

## 2. CROSS-PERIOD REFUND POSTING

### 2.1 Period Status Rules

**Period Statuses:**
- `open` - Allows all posting
- `soft_closed` - Allows posting (no override needed)
- `locked` - Blocks all posting (hard lock)

**Current Behavior:**
- `assert_accounting_period_is_open()` only blocks `locked` periods
- `soft_closed` periods allow posting without override
- No override mechanism exists for soft_closed periods

### 2.2 Test Cases

#### Case 1: Refund in Same Open Period
**Scenario:** Sale posted in open period, refunded same day
- **Expected:** ✅ Refund posts successfully
- **Date:** Uses `sale.created_at::DATE` (same as original sale)
- **Period:** Same period as original sale
- **Validation:** `assert_accounting_period_is_open()` passes

#### Case 2: Refund After Period Soft Close
**Scenario:** Sale posted in period that is now soft_closed, refund issued
- **Current Behavior:** ✅ Refund posts (soft_closed allows posting)
- **Expected Behavior:** ⚠️ Should require supervisor override with audit trail
- **Date:** Uses `sale.created_at::DATE` (original sale date, not refund date)
- **Issue:** No override mechanism for soft_closed periods

#### Case 3: Refund After Period Lock
**Scenario:** Sale posted in period that is now locked, refund issued
- **Expected:** ❌ Refund blocked by `assert_accounting_period_is_open()`
- **Error:** "Accounting period is locked. Post an adjustment in a later open period."
- **Workaround:** Create adjustment journal in current open period

### 2.3 Required Override Mechanism

**For Soft-Closed Periods:**
- Require supervisor override to post refunds
- Audit trail: who, when, why
- Store override in `accounting_period_overrides` table (needs to be created)

**Override Fields:**
- `period_id` - Period being overridden
- `user_id` - Supervisor who approved
- `reason` - Why override is needed
- `created_at` - When override was granted
- `reference_type` - 'sale_refund'
- `reference_id` - sale_id

### 2.4 Verification Queries

```sql
-- Find refunds posted to soft_closed periods (should require override)
SELECT 
  s.id AS sale_id,
  s.created_at::DATE AS sale_date,
  refund_je.date AS refund_date,
  ap.status AS period_status,
  ap.period_start,
  ap.period_end,
  CASE 
    WHEN ap.status = 'soft_closed' THEN 'REQUIRES OVERRIDE'
    WHEN ap.status = 'locked' THEN 'BLOCKED'
    ELSE 'OK'
  END AS period_check
FROM sales s
JOIN journal_entries refund_je 
  ON refund_je.reference_type = 'sale_refund' 
  AND refund_je.reference_id = s.id
JOIN accounting_periods ap 
  ON ap.business_id = s.business_id
  AND refund_je.date >= ap.period_start
  AND refund_je.date <= ap.period_end
WHERE s.payment_status = 'refunded'
  AND ap.status IN ('soft_closed', 'locked');

-- Verify refunds in locked periods (should be ZERO)
SELECT 
  s.id AS sale_id,
  refund_je.date AS refund_date,
  ap.status AS period_status
FROM sales s
JOIN journal_entries refund_je 
  ON refund_je.reference_type = 'sale_refund' 
  AND refund_je.reference_id = s.id
JOIN accounting_periods ap 
  ON ap.business_id = s.business_id
  AND refund_je.date >= ap.period_start
  AND refund_je.date <= ap.period_end
WHERE s.payment_status = 'refunded'
  AND ap.status = 'locked';  -- Should return 0 rows
```

---

## 3. REGISTER REPORT VERIFICATION

### 3.1 Expected Results After Refund Fix

**Scenario:** 
- Sale: ₵100 cash received
- Refund: ₵70 cash paid
- Net: ₵30 cash remaining

**Expected Register Report:**
- `opening_cash_balance` = 0 (or prior balance)
- `cash_received` = ₵100 (from original sale)
- `cash_paid` = ₵70 (from refund)
- `closing_cash_balance` = ₵30
- `expected_cash` = ₵100 (opening + received)
- `variance` = ₵70 (expected - closing, but should be 0 if refund is properly tracked)

**Note:** Current variance calculation may need adjustment:
- `variance = expected_cash - closing_cash_balance`
- With refunds: `expected_cash = opening + received - paid` (refunds reduce expected)
- Should be: `variance = (opening + received - paid) - closing = 0` if balanced

### 3.2 Verification Query

```sql
-- Verify Register Report handles refunds correctly
-- For a register in a period with refunds:
SELECT 
  r.id AS register_id,
  r.name AS register_name,
  -- Cash received (from sales)
  COALESCE(SUM(CASE WHEN original_payment.debit > 0 AND original_account.code = '1000' THEN original_payment.debit ELSE 0 END), 0) AS cash_received,
  -- Cash paid (from refunds)
  COALESCE(SUM(CASE WHEN refund_payment.credit > 0 AND refund_account.code = '1000' THEN refund_payment.credit ELSE 0 END), 0) AS cash_paid,
  -- Net cash
  COALESCE(SUM(CASE WHEN original_payment.debit > 0 AND original_account.code = '1000' THEN original_payment.debit ELSE 0 END), 0) - 
  COALESCE(SUM(CASE WHEN refund_payment.credit > 0 AND refund_account.code = '1000' THEN refund_payment.credit ELSE 0 END), 0) AS net_cash
FROM registers r
LEFT JOIN sales s 
  ON s.register_id = r.id
  AND s.payment_status IN ('paid', 'refunded')
LEFT JOIN journal_entries original_je 
  ON original_je.reference_type = 'sale' 
  AND original_je.reference_id = s.id
LEFT JOIN journal_entry_lines original_payment 
  ON original_payment.journal_entry_id = original_je.id
  AND original_payment.debit > 0
LEFT JOIN accounts original_account 
  ON original_account.id = original_payment.account_id 
  AND original_account.code = '1000'
LEFT JOIN journal_entries refund_je 
  ON refund_je.reference_type = 'sale_refund' 
  AND refund_je.reference_id = s.id
LEFT JOIN journal_entry_lines refund_payment 
  ON refund_payment.journal_entry_id = refund_je.id
  AND refund_payment.credit > 0
LEFT JOIN accounts refund_account 
  ON refund_account.id = refund_payment.account_id 
  AND refund_account.code = '1000'
WHERE r.business_id = 'YOUR_BUSINESS_ID'
  AND s.created_at::DATE BETWEEN '2025-01-01' AND '2025-01-31'  -- Adjust period
GROUP BY r.id, r.name;
```

---

## 4. ENFORCEMENT: CASH REFUND VALIDATION

### 4.1 Required Enforcement

**Rule:**
```
IF refund.payment_method = 'cash'
AND journal_entry_lines lacks CREDIT to Cash (1000)
→ HARD FAIL transaction
```

**Implementation Location:**
- `post_sale_refund_to_ledger()` function
- Add validation after building journal_lines
- Before calling `post_journal_entry()`

### 4.2 Implementation

```sql
-- In post_sale_refund_to_ledger(), after building journal_lines:
-- Determine payment method from original sale journal entry
DECLARE
  payment_account_id UUID;
  payment_account_code TEXT;
  has_cash_credit BOOLEAN := FALSE;
BEGIN
  -- Find original payment account from original sale
  SELECT a.id, a.code INTO payment_account_id, payment_account_code
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE je.reference_type = 'sale'
    AND je.reference_id = p_sale_id
    AND a.code IN ('1000', '1010', '1020', '1030')
    AND jel.debit > 0
  LIMIT 1;

  -- Check if refund journal_lines includes credit to payment account
  FOR line IN SELECT * FROM jsonb_array_elements(journal_lines)
  LOOP
    IF (line->>'account_id')::UUID = payment_account_id 
       AND COALESCE((line->>'credit')::NUMERIC, 0) > 0 THEN
      has_cash_credit := TRUE;
      EXIT;
    END IF;
  END LOOP;

  -- ENFORCEMENT: If original was cash, refund MUST credit cash
  IF payment_account_code = '1000' AND NOT has_cash_credit THEN
    RAISE EXCEPTION 'Cash refund must credit Cash account (1000). Journal entry missing Cash CREDIT line.';
  END IF;

  -- ENFORCEMENT: If original was non-cash, refund MUST NOT credit cash
  IF payment_account_code != '1000' AND has_cash_credit THEN
    RAISE EXCEPTION 'Non-cash refund must credit clearing account (%), not Cash (1000).', payment_account_code;
  END IF;
END;
```

---

## 5. SUMMARY OF ISSUES

### 5.1 Partial Refunds
- **Status:** ❌ Not supported
- **Impact:** Cannot refund partial amounts
- **Recommendation:** Add partial refund support with proportional calculations

### 5.2 Cross-Period Posting
- **Status:** ⚠️ Partial support
- **Issue:** Soft_closed periods allow posting without override/audit
- **Recommendation:** Add override mechanism for soft_closed periods

### 5.3 Payment Method Enforcement
- **Status:** ❌ Missing
- **Issue:** No validation that refund credits correct account
- **Recommendation:** Add enforcement in `post_sale_refund_to_ledger()`

### 5.4 Register Report Variance
- **Status:** ⚠️ May need adjustment
- **Issue:** Variance calculation may not account for refunds correctly
- **Recommendation:** Review variance formula: `expected = opening + received - paid`

---

## 6. RECOMMENDATIONS

1. **Implement Partial Refund Support:**
   - Add `refund_amount` parameter to `post_sale_refund_to_ledger()`
   - Calculate proportional reversals
   - Validate no rounding drift

2. **Add Soft-Closed Override:**
   - Create `accounting_period_overrides` table
   - Require override for refunds to soft_closed periods
   - Audit: who, when, why

3. **Add Payment Method Enforcement:**
   - Query original sale to find payment account
   - Validate refund credits same account
   - Hard fail if mismatch

4. **Fix Register Report Variance:**
   - Update variance calculation to account for refunds
   - `expected_cash = opening + received - paid`
   - `variance = expected_cash - closing_cash_balance`

---

## 7. REGISTER REPORT TESTING AFTER REFUND FIX

### 7.1 Test Scenario

**Setup:**
1. Open register session with opening float: ₵0
2. Make sale: ₵100 cash
3. Refund: ₵70 cash
4. Expected net cash: ₵30

### 7.2 Expected Register Report Results

**For the affected period:**
- `opening_cash_balance` = ₵0 (or prior balance)
- `cash_received` = ₵100 (from original sale DEBIT to Cash 1000)
- `cash_paid` = ₵70 (from refund CREDIT to Cash 1000)
- `closing_cash_balance` = ₵30 (opening + received - paid)
- `expected_cash` = ₵30 (opening + received - paid)
- `variance` = ₵0 (expected - closing = 30 - 30 = 0)

### 7.3 Verification Steps

1. **Run Register Report** for the period containing the sale and refund
2. **Verify cash_received** = sum of all Cash (1000) debits from sales
3. **Verify cash_paid** = sum of all Cash (1000) credits from refunds
4. **Verify closing_cash_balance** = opening + received - paid
5. **Verify variance** = 0 (or within rounding tolerance)

### 7.4 Test Query

```sql
-- Verify Register Report calculations for a specific register and period
SELECT 
  r.id AS register_id,
  r.name AS register_name,
  -- Opening balance (sales - refunds before period)
  COALESCE(SUM(CASE 
    WHEN opening_je.date < '2025-01-01' AND opening_account.code = '1000' 
    THEN opening_jel.debit - opening_jel.credit 
    ELSE 0 
  END), 0) AS opening_cash_balance,
  -- Cash received (sales in period)
  COALESCE(SUM(CASE 
    WHEN period_je.reference_type = 'sale' AND period_account.code = '1000' 
    THEN period_jel.debit 
    ELSE 0 
  END), 0) AS cash_received,
  -- Cash paid (refunds in period)
  COALESCE(SUM(CASE 
    WHEN period_je.reference_type = 'sale_refund' AND period_account.code = '1000' 
    THEN period_jel.credit 
    ELSE 0 
  END), 0) AS cash_paid,
  -- Closing balance
  COALESCE(SUM(CASE 
    WHEN opening_je.date < '2025-01-01' AND opening_account.code = '1000' 
    THEN opening_jel.debit - opening_jel.credit 
    ELSE 0 
  END), 0) + 
  COALESCE(SUM(CASE 
    WHEN period_je.reference_type = 'sale' AND period_account.code = '1000' 
    THEN period_jel.debit 
    ELSE 0 
  END), 0) - 
  COALESCE(SUM(CASE 
    WHEN period_je.reference_type = 'sale_refund' AND period_account.code = '1000' 
    THEN period_jel.credit 
    ELSE 0 
  END), 0) AS closing_cash_balance
FROM registers r
LEFT JOIN sales s ON s.register_id = r.id
LEFT JOIN journal_entries opening_je ON opening_je.reference_type IN ('sale', 'sale_refund') AND opening_je.reference_id = s.id AND opening_je.date < '2025-01-01'
LEFT JOIN journal_entry_lines opening_jel ON opening_jel.journal_entry_id = opening_je.id
LEFT JOIN accounts opening_account ON opening_account.id = opening_jel.account_id AND opening_account.code = '1000'
LEFT JOIN journal_entries period_je ON period_je.reference_type IN ('sale', 'sale_refund') AND period_je.reference_id = s.id AND period_je.date >= '2025-01-01' AND period_je.date <= '2025-01-31'
LEFT JOIN journal_entry_lines period_jel ON period_jel.journal_entry_id = period_je.id
LEFT JOIN accounts period_account ON period_account.id = period_jel.account_id AND period_account.code = '1000'
WHERE r.business_id = 'YOUR_BUSINESS_ID'
GROUP BY r.id, r.name;
```

---

## 8. MIGRATION SUMMARY

### 8.1 Migration: 191_fix_refund_payment_method_and_enforcement.sql

**Changes:**
1. ✅ Fixed `post_sale_refund_to_ledger()` to query original sale for payment account
2. ✅ Changed from always using Cash (1000) to using same account as original sale
3. ✅ Added enforcement: Cash refunds MUST credit Cash (1000)
4. ✅ Added enforcement: Non-cash refunds MUST NOT credit Cash (1000)
5. ✅ Hard fail if enforcement rules violated

**Impact:**
- Existing refunds: May need to be re-posted if they incorrectly credited Cash
- New refunds: Will automatically use correct payment account
- Register Report: Now includes refunds in cash_paid calculation

### 8.2 Register Report Updates

**Changes:**
1. ✅ Include refunds (`reference_type='sale_refund'`) in period lines query
2. ✅ Track cash_paid from refunds (credits to Cash 1000)
3. ✅ Track non_cash_totals.paid from refunds
4. ✅ Updated expected_cash calculation: opening + received - paid
5. ✅ Variance should now be 0 when balanced

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-27  
**Author:** System Audit
