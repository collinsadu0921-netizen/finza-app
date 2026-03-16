# Refund/Void Posting Paths - Complete Audit

## Executive Summary

This document enumerates ALL refund/void code paths and confirms that each one:
1. Creates a journal entry when reversing VAT/revenue
2. Credits Cash (1000) when the original payment method was cash
3. Uses the shared helper `resolve_payment_account_from_sale()` to resolve payment method from original sale journal entry (not `sales.payment_method` field)
4. Enforces hard assertion `CASH_REFUND_INCOMPLETE` if VAT is reversed AND original payment was cash AND no Cash credit exists

---

## 1. FULL REFUND

### 1.1 Code Path

**Trigger:**
- **UI/API:** `POST /api/override/refund-sale`
- **Location:** `app/api/override/refund-sale/route.ts`
- **Authorization:** Requires supervisor (manager/admin) approval
- **Self-override:** Allowed for admin/manager/owner, blocked for cashiers

**Ledger Posting:**
- **Function:** `post_sale_refund_to_ledger(p_sale_id UUID)`
- **Location:** `supabase/migrations/192_unify_refund_void_posting_paths.sql`
- **Called:** Line 549 in `refund-sale/route.ts`
- **Timing:** AFTER `payment_status` is updated to 'refunded'

**Reference Type:**
- `reference_type = 'refund'`
- `reference_id = sale_id` (UUID of refunded sale)

### 1.2 Payment Method Resolution

**Method:**
- Uses shared helper: `resolve_payment_account_from_sale(p_sale_id)`
- Queries original sale journal entry to find which account was debited
- Returns: `payment_account_id` (UUID) and `payment_account_code` (TEXT: '1000', '1010', '1020', '1030')
- **NOT** using `sales.payment_method` field (unreliable)

**Source of Truth:**
- Original sale journal entry: `journal_entry_lines` where `account_code IN ('1000', '1010', '1020', '1030')` AND `debit > 0`

### 1.3 Journal Entry Structure

**Lines Created:**
1. **Payment Account** - CREDIT = `sale.amount` (gross refund amount)
   - Cash (1000), Bank (1010), MoMo (1020), or Card (1030) - determined from original sale
2. **Revenue (4000)** - DEBIT = `subtotal` (net refund amount)
3. **COGS (5000)** - CREDIT = `total_cogs` (if COGS > 0)
4. **Inventory (1200)** - DEBIT = `total_cogs` (if COGS > 0)
5. **Tax Accounts (2100, etc.)** - DEBIT = individual tax amounts (reverses original CREDIT)

**Entry Date:**
- `CURRENT_DATE` (refund processing date, not original sale date)

### 1.4 Enforcement Rules

**Rule 1: CASH_REFUND_INCOMPLETE**
- **Condition:** VAT is reversed (DEBIT to 2100) AND original payment was cash (1000) AND no Cash credit exists
- **Action:** `RAISE EXCEPTION 'CASH_REFUND_INCOMPLETE: ...'`
- **Status:** ✅ **ENFORCED**

**Rule 2: CASH_REFUND_MUST_CREDIT_CASH**
- **Condition:** Original payment was cash (1000) AND no Cash credit exists
- **Action:** `RAISE EXCEPTION 'CASH_REFUND_MUST_CREDIT_CASH: ...'`
- **Status:** ✅ **ENFORCED**

**Rule 3: Non-Cash Refunds Must NOT Credit Cash**
- **Condition:** Original payment was non-cash (1010/1020/1030) AND Cash (1000) is credited
- **Action:** `RAISE EXCEPTION 'ENFORCEMENT FAILED: Non-cash refund must credit clearing account, not Cash'`
- **Status:** ✅ **ENFORCED**

### 1.5 Verification

**Test Case:**
1. Create cash sale: ₵100
2. Process refund
3. Verify journal entry:
   - `reference_type = 'refund'`
   - `entry_date = refund processing date`
   - Cash (1000) CREDIT = ₵100
   - Revenue (4000) DEBIT = net amount
   - VAT (2100) DEBIT = tax amount

**Expected Result:**
- ✅ Journal entry created
- ✅ Cash (1000) credited
- ✅ Register Report shows `cash_paid = ₵100`

**Status:** ✅ **VERIFIED**

---

## 2. VOID SALE

### 2.1 Code Path

**Trigger:**
- **UI/API:** `POST /api/override/void-sale`
- **Location:** `app/api/override/void-sale/route.ts`
- **Authorization:** Requires supervisor (manager/admin) approval
- **Self-override:** Blocked (cashier cannot void their own sale)

**Ledger Posting:**
- **Function:** `post_sale_void_to_ledger(p_sale_id UUID)`
- **Location:** `supabase/migrations/192_unify_refund_void_posting_paths.sql`
- **Called:** Line 334 in `void-sale/route.ts` (BEFORE deleting sale)
- **Timing:** BEFORE sale deletion (requires sale to exist)

**Reference Type:**
- `reference_type = 'void'`
- `reference_id = sale_id` (UUID of voided sale)

### 2.2 Payment Method Resolution

**Method:**
- Uses shared helper: `resolve_payment_account_from_sale(p_sale_id)`
- Same logic as refunds: queries original sale journal entry
- **NOT** using `sales.payment_method` field

**Source of Truth:**
- Original sale journal entry (same as refunds)

### 2.3 Journal Entry Structure

**Lines Created:**
1. **Payment Account** - CREDIT = `sale.amount` (gross void amount)
2. **Revenue (4000)** - DEBIT = `subtotal` (net void amount)
3. **COGS (5000)** - CREDIT = `total_cogs` (if COGS > 0)
4. **Inventory (1200)** - DEBIT = `total_cogs` (if COGS > 0)
5. **Tax Accounts (2100, etc.)** - DEBIT = individual tax amounts

**Entry Date:**
- `CURRENT_DATE` (void processing date)

### 2.4 Enforcement Rules

**Same as refunds:**
- ✅ CASH_REFUND_INCOMPLETE enforced
- ✅ CASH_REFUND_MUST_CREDIT_CASH enforced
- ✅ Non-cash voids must NOT credit Cash enforced

### 2.5 Verification

**Test Case:**
1. Create cash sale: ₵100
2. Process void (BEFORE deletion)
3. Verify journal entry:
   - `reference_type = 'void'`
   - `entry_date = void processing date`
   - Cash (1000) CREDIT = ₵100
   - Revenue (4000) DEBIT = net amount
   - VAT (2100) DEBIT = tax amount

**Expected Result:**
- ✅ Journal entry created
- ✅ Cash (1000) credited
- ✅ Register Report shows `cash_paid = ₵100`

**Status:** ✅ **VERIFIED** (NEW - previously voids did NOT post to ledger)

---

## 3. PARTIAL REFUND

### 3.1 Current Status

**Support:** ❌ **NOT CURRENTLY SUPPORTED**

**Current Behavior:**
- `post_sale_refund_to_ledger()` always refunds full sale amount
- No `refund_amount` parameter
- No proportional reversal logic

**Future Enhancement:**
- Add `p_refund_amount` parameter to `post_sale_refund_to_ledger()`
- Implement proportional reversal:
  - Revenue reversal = `(refund_amount / sale.amount) * original_revenue`
  - VAT reversal = `(refund_amount / sale.amount) * original_vat`
  - Payment account credit = `refund_amount` (gross)

### 3.2 Payment Method Resolution

**When Implemented:**
- Will use same shared helper: `resolve_payment_account_from_sale(p_sale_id)`
- Same enforcement rules apply

**Status:** ⚠️ **PENDING IMPLEMENTATION**

---

## 4. SHARED HELPER FUNCTION

### 4.1 Function Details

**Name:** `resolve_payment_account_from_sale(p_sale_id UUID)`

**Location:** `supabase/migrations/192_unify_refund_void_posting_paths.sql`

**Returns:**
- `payment_account_id` (UUID)
- `payment_account_code` (TEXT: '1000', '1010', '1020', '1030')

**Logic:**
```sql
SELECT a.id, a.code
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
JOIN accounts a ON a.id = jel.account_id
WHERE je.reference_type = 'sale'
  AND je.reference_id = p_sale_id
  AND a.code IN ('1000', '1010', '1020', '1030')
  AND jel.debit > 0
LIMIT 1;
```

**Why Not Use `sales.payment_method`?**
- `sales.payment_method` field may be unreliable or missing
- Journal entry is the source of truth for what actually happened
- Ensures consistency: refund credits the same account that was debited

**Status:** ✅ **IMPLEMENTED**

---

## 5. HARD ASSERTIONS

### 5.1 CASH_REFUND_INCOMPLETE

**Condition:**
- VAT is reversed (DEBIT to account 2100) AND
- Original payment was cash (account 1000) AND
- No Cash (1000) credit exists in journal entry

**Error Code:** `CASH_REFUND_INCOMPLETE`

**Message:**
```
CASH_REFUND_INCOMPLETE: Cash refund must credit Cash (1000) when VAT is reversed. 
Journal entry missing Cash CREDIT line. Sale ID: <sale_id>
```

**Enforcement Location:**
- `post_sale_refund_to_ledger()` - Line ~290
- `post_sale_void_to_ledger()` - Line ~580

**Status:** ✅ **ENFORCED**

### 5.2 CASH_REFUND_MUST_CREDIT_CASH

**Condition:**
- Original payment was cash (account 1000) AND
- No Cash (1000) credit exists in journal entry

**Error Code:** `CASH_REFUND_MUST_CREDIT_CASH`

**Message:**
```
CASH_REFUND_MUST_CREDIT_CASH: Cash refund must credit Cash account (1000). 
Journal entry missing Cash CREDIT line. Sale ID: <sale_id>
```

**Enforcement Location:**
- `post_sale_refund_to_ledger()` - Line ~295
- `post_sale_void_to_ledger()` - Line ~585

**Status:** ✅ **ENFORCED**

---

## 6. REGISTER REPORT VERIFICATION

### 6.1 Expected Behavior

**After Refund/Void:**
- `cash_received` = sum of sales (debits to Cash from sales)
- `cash_paid` = sum of refunds/voids (credits to Cash from refunds/voids)
- `closing_cash_balance` = `opening + cash_received - cash_paid`
- `variance` = 0 (if balanced)

### 6.2 Test Case

**Scenario:**
1. Create Sale 1: ₵100 cash → Cash DEBIT ₵100
2. Create Sale 2: ₵70 cash → Cash DEBIT ₵70
3. Refund Sale 1: ₵100 → Cash CREDIT ₵100
4. Void Sale 2: ₵70 → Cash CREDIT ₵70

**Expected Register Report:**
- `cash_received` = ₵170 (₵100 + ₵70)
- `cash_paid` = ₵170 (₵100 + ₵70)
- `closing_cash_balance` = `opening + ₵170 - ₵170` = `opening`
- `variance` = 0

**Status:** ✅ **VERIFIED**

---

## 7. SUMMARY

### 7.1 All Refund/Void Paths

| Path | Journal Entry? | Cash Credit? | Status |
|------|----------------|-------------|--------|
| Full Refund | ✅ YES | ✅ YES (if cash) | ✅ VERIFIED |
| Void | ✅ YES | ✅ YES (if cash) | ✅ VERIFIED (NEW) |
| Partial Refund | ❌ NOT SUPPORTED | N/A | ⚠️ PENDING |

### 7.2 Enforcement Coverage

| Rule | Refunds | Voids | Status |
|------|---------|-------|--------|
| CASH_REFUND_INCOMPLETE | ✅ | ✅ | ✅ ENFORCED |
| CASH_REFUND_MUST_CREDIT_CASH | ✅ | ✅ | ✅ ENFORCED |
| Non-Cash Must NOT Credit Cash | ✅ | ✅ | ✅ ENFORCED |

### 7.3 Payment Method Resolution

| Source | Used? | Status |
|--------|-------|--------|
| `sales.payment_method` field | ❌ NO | ✅ NOT USED |
| Original sale journal entry | ✅ YES | ✅ CANONICAL SOURCE |

---

## 8. VERIFICATION STEPS

### 8.1 Test Full Refund

```sql
-- 1. Create cash sale
-- 2. Process refund via API
-- 3. Verify journal entry
SELECT 
  je.id,
  je.reference_type,
  je.reference_id,
  a.code AS account_code,
  jel.credit AS cash_credit
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
JOIN accounts a ON a.id = jel.account_id
WHERE je.reference_type = 'refund'
  AND je.reference_id = '<sale_id>'
  AND a.code = '1000'
  AND jel.credit > 0;
```

### 8.2 Test Void

```sql
-- 1. Create cash sale
-- 2. Process void via API (BEFORE deletion)
-- 3. Verify journal entry
SELECT 
  je.id,
  je.reference_type,
  je.reference_id,
  a.code AS account_code,
  jel.credit AS cash_credit
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
JOIN accounts a ON a.id = jel.account_id
WHERE je.reference_type = 'void'
  AND je.reference_id = '<sale_id>'
  AND a.code = '1000'
  AND jel.credit > 0;
```

### 8.3 Test Register Report

```sql
-- Run Register Report for period with refunds/voids
-- Verify: cash_paid = sum of refunds + voids
SELECT 
  SUM(CASE WHEN je.reference_type = 'refund' AND a.code = '1000' THEN jel.credit ELSE 0 END) AS refunds_cash,
  SUM(CASE WHEN je.reference_type = 'void' AND a.code = '1000' THEN jel.credit ELSE 0 END) AS voids_cash
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
JOIN accounts a ON a.id = jel.account_id
WHERE je.date >= '<start_date>'
  AND je.date <= '<end_date>'
  AND a.code = '1000'
  AND jel.credit > 0;
```

---

## 9. MIGRATION NOTES

**Migration:** `192_unify_refund_void_posting_paths.sql`

**Breaking Changes:**
- Voids now create journal entries (previously did not)
- Reference type changed from `'sale_refund'` to `'refund'` for refunds
- New reference type `'void'` for voids

**Backward Compatibility:**
- Existing refunds with `reference_type='sale_refund'` will still exist
- Reports may need to query both `'refund'` and `'sale_refund'` during transition

**Required Updates:**
- Register Report: Update to look for `reference_type IN ('refund', 'void')` instead of `'sale_refund'`
- VAT Control Report: Update to look for `reference_type IN ('refund', 'void')` for VAT reversals

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-27  
**Author:** System Audit
