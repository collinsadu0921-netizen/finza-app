# Refund / Void / Credit Flows - Complete Audit

## Executive Summary

This document catalogs all refund, void, and credit note flows in the system, including their triggers, journal entry creation, reference types, and affected accounts. Includes specific audits for cash vs non-cash refunds.

---

## 1. RETAIL REFUNDS (Full / Partial)

### 1.1 Flow Details

**Trigger:**
- **UI/API:** `POST /api/override/refund-sale`
- **Location:** `app/api/override/refund-sale/route.ts`
- **Authorization:** Requires supervisor (manager/admin) approval
- **Self-override:** Allowed for admin/manager/owner, blocked for cashiers

**Creates Journal Entry?**
- ✅ **YES** - Creates reversal journal entry via `post_sale_refund_to_ledger()`

**Reference Type / Reference ID:**
- `reference_type = 'sale_refund'`
- `reference_id = sale_id` (UUID of refunded sale)

**Affected Accounts:**
1. **Cash Account (1000)** - CREDIT (reverses original DEBIT)
2. **Revenue Account (4000)** - DEBIT (reverses original CREDIT)
3. **COGS Account (5000)** - CREDIT (reverses original DEBIT, if COGS > 0)
4. **Inventory Account (1200)** - DEBIT (reverses original CREDIT, if COGS > 0)
5. **Tax Accounts (2100, 2110, 2120, etc.)** - DEBIT (reverses original CREDIT for output taxes)

**Journal Entry Function:**
- `post_sale_refund_to_ledger(p_sale_id UUID)`
- **Location:** `supabase/migrations/174_track_a_refund_posting_and_sale_idempotency.sql`
- **Idempotency:** Checks for existing `reference_type='sale_refund'` entry before creating
- **Validation:** Requires `sales.payment_status = 'refunded'` and original sale journal entry must exist

**Posting Source:**
- `posting_source = 'system'` (explicitly set)

**Date:**
- Uses `sale.created_at::DATE` (same date as original sale)

---

## 2. VOIDS (Same-Day)

### 2.1 Flow Details

**Trigger:**
- **UI/API:** `POST /api/override/void-sale`
- **Location:** `app/api/override/void-sale/route.ts`
- **Authorization:** Requires supervisor (manager/admin) approval
- **Self-override:** Blocked (cashier cannot void their own sale)

**Creates Journal Entry?**
- ❌ **NO** - Sale is deleted from database, no journal entry created

**Reference Type / Reference ID:**
- N/A (no journal entry)

**Affected Accounts:**
- N/A (no ledger posting)

**Operational Impact:**
- Sale record deleted from `sales` table
- Sale items deleted from `sale_items` table
- Stock restored to `products_stock` table
- Stock movement created with `type = 'adjustment'`
- Override record created in `overrides` table

**⚠️ ISSUE IDENTIFIED:**
- Voids do NOT create reversal journal entries
- Original sale journal entry remains in ledger
- Creates reconciliation gap: ledger shows revenue that was voided
- **Recommendation:** Implement `post_sale_void_to_ledger()` function similar to refunds

---

## 3. CREDIT NOTES (Service Mode)

### 3.1 Flow Details

**Trigger:**
- **Auto-trigger:** Database trigger `trigger_auto_post_credit_note`
- **Location:** `supabase/migrations/043_accounting_core.sql` (line 989)
- **Condition:** When `credit_notes.status = 'applied'`

**Creates Journal Entry?**
- ✅ **YES** - Creates reversal journal entry via `post_credit_note_to_ledger()`

**Reference Type / Reference ID:**
- `reference_type = 'credit_note'`
- `reference_id = credit_note_id` (UUID of credit note)

**Affected Accounts:**
1. **Accounts Receivable (AR control account)** - CREDIT (reduces receivable)
2. **Revenue Account (4000)** - DEBIT (reverses original CREDIT)
3. **Tax Accounts (2100, 2110, etc.)** - DEBIT (reverses original CREDIT, side-flipped)

**Journal Entry Function:**
- `post_credit_note_to_ledger(p_credit_note_id UUID)`
- **Location:** `supabase/migrations/190_fix_posting_source_default_bug.sql` (line 1267)
- **Validation:** Requires `credit_notes.status = 'applied'` and invoice must exist

**Posting Source:**
- `posting_source = 'system'` (explicitly set)

**Date:**
- Uses `credit_notes.date`

**Note:**
- Credit notes do NOT affect cash/bank accounts (settlement handled separately)
- Only affects AR, Revenue, and Tax accounts

---

## 4. MANUAL REVERSALS / ADJUSTMENTS

### 4.1 Flow Details

**Trigger:**
- **UI/API:** Accounting Mode adjustment journal workflow
- **Location:** `app/api/accounting/adjustments/route.ts`
- **Authorization:** Requires accountant/admin role

**Creates Journal Entry?**
- ✅ **YES** - Creates adjusting journal entry via `apply_adjusting_journal()`

**Reference Type / Reference ID:**
- `reference_type = 'adjustment'`
- `reference_id = NULL` (adjustments are standalone entries)

**Affected Accounts:**
- **Any accounts** - Determined by accountant when creating adjustment
- Must balance (debits = credits)
- Minimum 2 lines required

**Journal Entry Function:**
- `apply_adjusting_journal(p_business_id, p_period_start, p_entry_date, p_description, p_lines, p_created_by)`
- **Location:** `supabase/migrations/137_adjusting_journals_phase2e.sql`
- **Validation:** 
  - Period must be 'open' (not soft_closed or locked)
  - Entry date must be within period
  - All accounts must exist
  - Entry must balance

**Posting Source:**
- Uses default `post_journal_entry()` (not explicitly set, may be NULL)

**Date:**
- Uses `p_entry_date` (provided by accountant)

---

## 5. CASH REFUNDS AUDIT

### 5.1 Expected Journal Entry Structure

For cash refunds, the journal entry should:

1. **CREDIT Cash Account (1000)**
   - Amount = refunded cash amount
   - Description: "Refund: Sale receipt reversed"

2. **DEBIT Revenue Account (4000)**
   - Amount = subtotal (gross - taxes)
   - Description: "Refund: Sales revenue reversed"

3. **DEBIT Tax Accounts (2100, 2110, 2120, etc.)**
   - Amount = tax amount per tax line
   - Description: "Refund: [Tax Code] tax reversed"
   - Side: DEBIT (reverses original CREDIT)

4. **CREDIT COGS Account (5000)** - if COGS > 0
   - Amount = total COGS
   - Description: "Refund: Cost of goods sold reversed"

5. **DEBIT Inventory Account (1200)** - if COGS > 0
   - Amount = total COGS
   - Description: "Refund: Inventory restored"

### 5.2 Verification Queries

```sql
-- Find all cash refunds (sales with payment_status = 'refunded')
SELECT 
  s.id AS sale_id,
  s.amount AS refund_amount,
  s.created_at AS refund_date,
  s.payment_status,
  je.id AS journal_entry_id,
  je.date AS journal_entry_date,
  je.reference_type,
  je.reference_id
FROM sales s
LEFT JOIN journal_entries je 
  ON je.reference_type = 'sale_refund' 
  AND je.reference_id = s.id
WHERE s.payment_status = 'refunded'
ORDER BY s.created_at DESC;

-- Verify journal entry exists for each refund
SELECT 
  s.id AS sale_id,
  s.amount AS refund_amount,
  CASE 
    WHEN je.id IS NULL THEN 'MISSING JOURNAL ENTRY'
    ELSE 'OK'
  END AS status
FROM sales s
LEFT JOIN journal_entries je 
  ON je.reference_type = 'sale_refund' 
  AND je.reference_id = s.id
WHERE s.payment_status = 'refunded'
  AND je.id IS NULL;  -- Find refunds without journal entries

-- Verify journal entry date matches refund date
SELECT 
  s.id AS sale_id,
  s.created_at::DATE AS refund_date,
  je.date AS journal_entry_date,
  CASE 
    WHEN je.date = s.created_at::DATE THEN 'OK'
    ELSE 'DATE MISMATCH'
  END AS date_check
FROM sales s
JOIN journal_entries je 
  ON je.reference_type = 'sale_refund' 
  AND je.reference_id = s.id
WHERE s.payment_status = 'refunded';

-- Verify Cash (1000) CREDIT amount equals refund amount
SELECT 
  s.id AS sale_id,
  s.amount AS refund_amount,
  SUM(jel.credit) AS cash_credit_total,
  CASE 
    WHEN ABS(SUM(jel.credit) - s.amount) < 0.01 THEN 'OK'
    ELSE 'AMOUNT MISMATCH'
  END AS amount_check
FROM sales s
JOIN journal_entries je 
  ON je.reference_type = 'sale_refund' 
  AND je.reference_id = s.id
JOIN journal_entry_lines jel 
  ON jel.journal_entry_id = je.id
JOIN accounts a 
  ON a.id = jel.account_id 
  AND a.code = '1000'
WHERE s.payment_status = 'refunded'
GROUP BY s.id, s.amount;

-- Verify Revenue (4000) DEBIT exists
SELECT 
  s.id AS sale_id,
  s.amount AS refund_amount,
  SUM(jel.debit) AS revenue_debit_total,
  CASE 
    WHEN SUM(jel.debit) > 0 THEN 'OK'
    ELSE 'MISSING REVENUE DEBIT'
  END AS revenue_check
FROM sales s
JOIN journal_entries je 
  ON je.reference_type = 'sale_refund' 
  AND je.reference_id = s.id
JOIN journal_entry_lines jel 
  ON jel.journal_entry_id = je.id
JOIN accounts a 
  ON a.id = jel.account_id 
  AND a.code = '4000'
WHERE s.payment_status = 'refunded'
GROUP BY s.id, s.amount;

-- Verify VAT (2100) DEBIT exists
SELECT 
  s.id AS sale_id,
  s.amount AS refund_amount,
  SUM(jel.debit) AS vat_debit_total,
  CASE 
    WHEN SUM(jel.debit) > 0 THEN 'OK'
    ELSE 'MISSING VAT DEBIT'
  END AS vat_check
FROM sales s
JOIN journal_entries je 
  ON je.reference_type = 'sale_refund' 
  AND je.reference_id = s.id
JOIN journal_entry_lines jel 
  ON jel.journal_entry_id = je.id
JOIN accounts a 
  ON a.id = jel.account_id 
  AND a.code = '2100'
WHERE s.payment_status = 'refunded'
GROUP BY s.id, s.amount;
```

### 5.3 Audit Results Template

For each cash refund, verify:
- [ ] Journal entry exists (`reference_type='sale_refund'`, `reference_id=sale_id`)
- [ ] Journal entry date = refund date (within same day)
- [ ] Cash (1000) CREDIT amount = refund amount
- [ ] Revenue (4000) DEBIT exists
- [ ] VAT (2100) DEBIT exists (if sale had VAT)
- [ ] Entry balances (total debits = total credits)

---

## 6. NON-CASH REFUNDS AUDIT (Card / MoMo / Bank)

### 6.1 Expected Journal Entry Structure

For non-cash refunds, the journal entry should:

1. **CREDIT Clearing Account (1010 Bank, 1020 MoMo, 1030 Card, etc.)**
   - Amount = refunded amount
   - Description: "Refund: [Payment method] payment reversed"

2. **DEBIT Revenue Account (4000)**
   - Amount = subtotal (gross - taxes)
   - Description: "Refund: Sales revenue reversed"

3. **DEBIT Tax Accounts (2100, 2110, 2120, etc.)**
   - Amount = tax amount per tax line
   - Description: "Refund: [Tax Code] tax reversed"

4. **CREDIT COGS Account (5000)** - if COGS > 0
5. **DEBIT Inventory Account (1200)** - if COGS > 0

### 6.2 Critical Verification

**⚠️ NO Cash (1000) Movement:**
- Non-cash refunds must NOT affect Cash account
- Only clearing accounts (Bank, MoMo, Card) should be credited

### 6.3 Verification Queries

```sql
-- Identify original payment method from original sale journal entry
-- Original sale debits Cash (1000) for cash payments, or clearing accounts (1010/1020/1030) for non-cash
SELECT 
  s.id AS sale_id,
  s.amount AS sale_amount,
  original_account.code AS original_payment_account,
  original_account.name AS original_payment_account_name,
  CASE 
    WHEN original_account.code = '1000' THEN 'CASH'
    WHEN original_account.code IN ('1010', '1020', '1030') THEN 'NON_CASH'
    ELSE 'UNKNOWN'
  END AS payment_method
FROM sales s
JOIN journal_entries original_je 
  ON original_je.reference_type = 'sale' 
  AND original_je.reference_id = s.id
JOIN journal_entry_lines original_jel 
  ON original_jel.journal_entry_id = original_je.id
JOIN accounts original_account 
  ON original_account.id = original_jel.account_id 
  AND original_account.code IN ('1000', '1010', '1020', '1030')
  AND original_jel.debit > 0  -- Original sale DEBITS the payment account
WHERE s.payment_status = 'refunded';

-- Find non-cash refunds that incorrectly credit Cash (1000)
SELECT 
  s.id AS sale_id,
  s.amount AS refund_amount,
  original_account.code AS original_payment_account,
  refund_account.code AS refund_account,
  refund_jel.credit AS refund_credit_amount,
  CASE 
    WHEN refund_account.code = '1000' AND original_account.code != '1000' 
      THEN 'ERROR: Non-cash refund credits Cash instead of clearing account'
    ELSE 'OK'
  END AS cash_check
FROM sales s
JOIN journal_entries original_je 
  ON original_je.reference_type = 'sale' 
  AND original_je.reference_id = s.id
JOIN journal_entry_lines original_jel 
  ON original_jel.journal_entry_id = original_je.id
JOIN accounts original_account 
  ON original_account.id = original_jel.account_id 
  AND original_account.code IN ('1000', '1010', '1020', '1030')
  AND original_jel.debit > 0
JOIN journal_entries refund_je 
  ON refund_je.reference_type = 'sale_refund' 
  AND refund_je.reference_id = s.id
JOIN journal_entry_lines refund_jel 
  ON refund_jel.journal_entry_id = refund_je.id
JOIN accounts refund_account 
  ON refund_account.id = refund_jel.account_id 
  AND refund_account.code IN ('1000', '1010', '1020', '1030')
  AND refund_jel.credit > 0
WHERE s.payment_status = 'refunded'
  AND original_account.code != '1000'  -- Original was non-cash
  AND refund_account.code = '1000';  -- But refund credits Cash (ERROR)

-- Verify clearing account CREDIT exists for non-cash refunds
SELECT 
  s.id AS sale_id,
  s.amount AS refund_amount,
  a.code AS clearing_account_code,
  a.name AS clearing_account_name,
  SUM(jel.credit) AS clearing_credit_total,
  CASE 
    WHEN SUM(jel.credit) > 0 THEN 'OK'
    ELSE 'MISSING CLEARING ACCOUNT CREDIT'
  END AS clearing_check
FROM sales s
JOIN journal_entries je 
  ON je.reference_type = 'sale_refund' 
  AND je.reference_id = s.id
JOIN journal_entry_lines jel 
  ON jel.journal_entry_id = je.id
JOIN accounts a 
  ON a.id = jel.account_id 
  AND a.code IN ('1010', '1020', '1030')  -- Bank, MoMo, Card
WHERE s.payment_status = 'refunded'
GROUP BY s.id, s.amount, a.code, a.name;
```

### 6.4 Issue: Payment Method Not Stored in Sale

**⚠️ CRITICAL GAP IDENTIFIED:**
- Sales table does NOT store payment method information
- Cannot distinguish cash vs non-cash refunds from sale record alone
- Refund journal entry always credits Cash (1000) regardless of original payment method
- **This is a design flaw:** Non-cash refunds should credit clearing accounts, not Cash

**Recommendation:**
1. Store payment method in `sales` table or `sale_payments` table
2. Update `post_sale_refund_to_ledger()` to check payment method
3. Credit appropriate account (Cash vs clearing account) based on original payment method

---

## 7. SUMMARY TABLE

| Flow | Trigger | Creates Journal Entry? | Reference Type | Reference ID | Affected Accounts | Status |
|------|---------|----------------------|----------------|--------------|-------------------|--------|
| **Retail Refund** | `POST /api/override/refund-sale` | ✅ YES | `sale_refund` | `sale_id` | Cash (1000) CREDIT, Revenue (4000) DEBIT, Taxes DEBIT, COGS/Inventory if applicable | ✅ Working |
| **Void Sale** | `POST /api/override/void-sale` | ❌ NO | N/A | N/A | N/A | ⚠️ **ISSUE: No ledger posting** |
| **Credit Note** | Auto-trigger on `status='applied'` | ✅ YES | `credit_note` | `credit_note_id` | AR CREDIT, Revenue (4000) DEBIT, Taxes DEBIT | ✅ Working |
| **Manual Adjustment** | `POST /api/accounting/adjustments` | ✅ YES | `adjustment` | `NULL` | Any accounts (accountant-defined) | ✅ Working |

---

## 8. KNOWN ISSUES

### 8.1 Voids Do Not Post to Ledger
- **Severity:** HIGH
- **Impact:** Ledger shows revenue for voided sales
- **Recommendation:** Implement `post_sale_void_to_ledger()` function

### 8.2 Non-Cash Refunds Always Credit Cash
- **Severity:** CRITICAL
- **Impact:** Cash account incorrectly credited for card/MoMo refunds
- **Root Cause:** `post_sale_refund_to_ledger()` always credits Cash (1000) regardless of original payment method
- **Current Behavior:** Function uses `get_account_by_control_key('CASH')` and always credits Cash account
- **Expected Behavior:** Should check original sale journal entry to see which account was debited, then credit the same account
- **Recommendation:** 
  1. Query original sale journal entry to find which payment account was debited
  2. Credit the same account in refund (Cash for cash, clearing account for non-cash)
  3. Update function to handle both cash and non-cash refunds correctly

### 8.3 Payment Method Not Stored
- **Severity:** MEDIUM
- **Impact:** Cannot audit cash vs non-cash refunds accurately
- **Recommendation:** Add payment method tracking to sales or create `sale_payments` table

---

## 9. RECOMMENDATIONS

1. **Implement Void Ledger Posting:**
   - Create `post_sale_void_to_ledger()` function
   - Call from void API route
   - Use `reference_type='sale_void'`

2. **Fix Non-Cash Refund Posting (CRITICAL):**
   - Update `post_sale_refund_to_ledger()` to query original sale journal entry
   - Find which payment account was debited in original sale (Cash 1000 vs clearing 1010/1020/1030)
   - Credit the SAME account in refund (not always Cash)
   - Implementation:
     ```sql
     -- In post_sale_refund_to_ledger(), before building journal_lines:
     -- Find original payment account from original sale journal entry
     SELECT a.id, a.code INTO payment_account_id, payment_account_code
     FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     JOIN accounts a ON a.id = jel.account_id
     WHERE je.reference_type = 'sale'
       AND je.reference_id = p_sale_id
       AND a.code IN ('1000', '1010', '1020', '1030')
       AND jel.debit > 0
     LIMIT 1;
     
     -- Use payment_account_id instead of cash_account_id for refund credit
     ```

3. **Add Payment Method Tracking:**
   - Create `sale_payments` table or add `payment_method` column to `sales`
   - Track which account was debited in original sale
   - Use same account for refund credit

4. **Enhance Audit Queries:**
   - Create automated audit report for refunds
   - Verify all refunds have journal entries
   - Verify cash vs non-cash refunds use correct accounts
   - Alert on missing or incorrect postings

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-27  
**Author:** System Audit
