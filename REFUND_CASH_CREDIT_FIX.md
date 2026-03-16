# Cash Refund Credit Fix - Implementation Summary

## Problem

Register Report was showing incorrect cash reconciliation after refunds:
- **Before Fix:** ₵170 cash received, ₵0 cash paid (refunds not reducing Cash)
- **After Fix:** ₵170 cash received, ₵140 cash paid, ₵30 closing cash, ₵0 variance

**Root Cause:**
- Refunds were posting to ledger but not crediting Cash account (1000)
- Refunds used sale date instead of refund processing date
- Register Report couldn't find refunds to calculate cash_paid

## Solution

**Migration:** `191_fix_refund_payment_method_and_enforcement.sql`

### Changes Made

1. **Use Refund Date (Not Sale Date)**
   - Changed `entry_date` from `sale.created_at::DATE` to `CURRENT_DATE`
   - Ensures refunds appear in correct period for Register Report reconciliation

2. **Use Correct Payment Account**
   - Queries original sale journal entry to find which account was debited
   - Credits the SAME account in refund (Cash 1000, Bank 1010, MoMo 1020, Card 1030)
   - Fixes bug where non-cash refunds incorrectly credited Cash

3. **Change Reference Type**
   - Changed from `reference_type='sale_refund'` to `reference_type='refund'`
   - Clearer identification of refund transactions

4. **Hard Guard Enforcement**
   - **Rule:** If original payment was Cash (1000), refund MUST credit Cash (1000)
   - **Error Code:** `CASH_REFUND_MUST_CREDIT_CASH`
   - **Aborts transaction** if Cash credit is missing

5. **Financial Amounts from Canonical Values**
   - Gross refund = `sale.amount` (from sale record)
   - Net refund = `sale.amount - sum(tax_lines amounts)` (from tax_lines JSONB)
   - Tax refunds = individual tax line amounts (from tax_lines JSONB)
   - All amounts come from canonical sale values, not UI calculations

## Why Cash Refunds Must Credit Cash

**Register Report Reconciliation:**
```
Opening Cash + Cash Received (sales) - Cash Paid (refunds) = Closing Cash
```

If refunds don't credit Cash:
- Register Report shows: ₵100 received, ₵0 paid → Variance ₵70 (WRONG)
- Should show: ₵100 received, ₵70 paid → Variance ₵0 (CORRECT)

**Example:**
- Sale: ₵100 cash received → Cash account DEBIT ₵100
- Refund: ₵70 cash paid → Cash account must CREDIT ₵70
- Net: ₵30 cash remaining → Register Report closing balance

Without Cash credit, the refund doesn't reduce Cash in the ledger, causing Register Report to show incorrect variance.

## Testing

### 1. Test Cash Refund Posting

**Steps:**
1. Create a cash sale: ₵100
2. Process refund: ₵70 (or full refund)
3. Verify journal entry:
   - `reference_type = 'refund'`
   - `entry_date = refund processing date` (not sale date)
   - Cash (1000) CREDIT = ₵70 (or ₵100 for full refund)
   - Revenue (4000) DEBIT = net amount
   - VAT (2100) DEBIT = tax amount

**Query:**
```sql
SELECT 
  je.id,
  je.date AS entry_date,
  je.reference_type,
  je.reference_id AS sale_id,
  a.code AS account_code,
  jel.credit AS cash_credit
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
JOIN accounts a ON a.id = jel.account_id
WHERE je.reference_type = 'refund'
  AND je.reference_id = 'YOUR_SALE_ID'
  AND a.code = '1000'
  AND jel.credit > 0;
```

### 2. Test Register Report

**Expected Results for Period 22/01/2026–23/01/2026:**
- Cash Received: ₵170 (from sales)
- Cash Paid: ₵140 (from refunds)
- Closing Cash: ₵30 (opening + received - paid)
- Variance: ₵0 (expected - closing)

**Note:** Register Report needs to be updated to look for `reference_type='refund'` instead of `'sale_refund'`

### 3. Test VAT Control Report

**Verify:** VAT Control Report remains consistent
- Refunds should reduce VAT collected (credits)
- Opening + Credits - Debits = Closing (invariant should hold)

### 4. Test Hard Guard

**Test Case:** Attempt to create refund without Cash credit
- Should fail with: `CASH_REFUND_MUST_CREDIT_CASH`
- Transaction should abort
- Sale should remain in original state

## Migration Notes

**Breaking Change:**
- Reference type changed from `'sale_refund'` to `'refund'`
- Reports need to be updated to query for `reference_type='refund'`

**Backward Compatibility:**
- Existing refunds with `reference_type='sale_refund'` will still exist
- Reports may need to query both types during transition

## Files Changed

1. `supabase/migrations/191_fix_refund_payment_method_and_enforcement.sql`
   - Updated `post_sale_refund_to_ledger()` function
   - Added hard guard enforcement
   - Changed reference_type and entry_date

## Next Steps

1. **Run Migration:** Apply `191_fix_refund_payment_method_and_enforcement.sql`
2. **Update Reports:** Update Register Report to look for `reference_type='refund'`
3. **Test:** Run validation steps above
4. **Verify:** Check Register Report shows correct cash_paid after refunds

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-27  
**Author:** System Fix
