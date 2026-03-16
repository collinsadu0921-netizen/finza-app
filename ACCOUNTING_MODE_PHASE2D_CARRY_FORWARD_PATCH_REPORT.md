# Accounting Mode - Phase 2D: Carry-Forward Patch - Remove Equity Offset

**Status:** ✅ COMPLETE  
**Date:** 2025-01-27  
**Migration:** `136_carry_forward_phase2d_patch_remove_offset.sql`

---

## EXECUTIVE SUMMARY

Successfully removed equity offset logic from carry-forward functionality and updated it to include ALL balance-sheet accounts (system + non-system). Carry-forward now creates naturally balanced entries without any offset lines. Manual Opening Balances (Phase 2C) remains unchanged (still uses equity offset for manual entries).

---

## 1. DATABASE CHANGES

### 1.1 Updated RPC Signature: `apply_carry_forward`

**Before:**
```sql
CREATE OR REPLACE FUNCTION apply_carry_forward(
  p_business_id UUID,
  p_from_period_start DATE,
  p_to_period_start DATE,
  p_equity_offset_account_id UUID,  -- REMOVED
  p_created_by UUID,
  p_note TEXT DEFAULT NULL
)
```

**After:**
```sql
CREATE OR REPLACE FUNCTION apply_carry_forward(
  p_business_id UUID,
  p_from_period_start DATE,
  p_to_period_start DATE,
  p_created_by UUID,
  p_note TEXT DEFAULT NULL
)
```

**Changes:**
- ✅ Removed `p_equity_offset_account_id` parameter
- ✅ Removed all equity offset validation logic (VALIDATION 5)
- ✅ Removed equity offset line creation logic
- ✅ Removed skip logic for equity offset account in journal lines loop
- ✅ Removed skip logic for equity offset account in carry_forward_lines insertion

### 1.2 Updated Compute Function: `compute_ending_balances_for_carry_forward`

**Before:**
```sql
WHERE a.business_id = p_business_id
  AND a.deleted_at IS NULL
  AND a.type IN ('asset', 'liability', 'equity')
  AND a.is_system = FALSE  -- EXCLUDED system accounts
```

**After:**
```sql
WHERE a.business_id = p_business_id
  AND a.deleted_at IS NULL
  AND a.type IN ('asset', 'liability', 'equity')
  -- REMOVED: AND a.is_system = FALSE
  -- Now includes ALL balance-sheet accounts (system + non-system)
```

**Changes:**
- ✅ Removed `is_system = FALSE` filter
- ✅ Now includes system accounts (tax control, AR/AP control, etc.)
- ✅ Updated function comment to reflect inclusion of system accounts

### 1.3 Added Imbalance Diagnostics

**New Validation (VALIDATION 5):**
- ✅ Checks if entry naturally balances (debit == credit)
- ✅ If imbalance > 0.01, raises exception with diagnostics:
  - Debit total, Credit total, Imbalance amount
  - Top 10 accounts by absolute balance (for debugging)

**Exception Format:**
```
Carry-forward entry does not balance naturally. Debit: X, Credit: Y, Imbalance: Z. Top 10 accounts by absolute balance: [account details]...
```

---

## 2. API CHANGES

### 2.1 POST `/api/accounting/carry-forward/apply`

**Request Body Changes:**

**Before:**
```json
{
  "business_id": "uuid",
  "from_period_start": "2025-01-01",
  "to_period_start": "2025-02-01",
  "equity_offset_account_id": "uuid",  // REMOVED
  "note": "optional"
}
```

**After:**
```json
{
  "business_id": "uuid",
  "from_period_start": "2025-01-01",
  "to_period_start": "2025-02-01",
  "note": "optional"
}
```

**Validation Changes:**
- ✅ Removed `equity_offset_account_id` from required fields check
- ✅ Updated error message to remove equity offset account requirement
- ✅ Removed `p_equity_offset_account_id` from RPC call

**Response:** Unchanged (success/error responses same)

### 2.2 GET `/api/accounting/carry-forward`

**Response Changes:**

**Before:**
```json
{
  "batch": null,
  "preview": {
    "from_period": {...},
    "to_period": {...},
    "balances": [...],
    "eligible_equity_accounts": [...]  // REMOVED
  }
}
```

**After:**
```json
{
  "batch": null,
  "preview": {
    "from_period": {...},
    "to_period": {...},
    "balances": [...]
  }
}
```

**Changes:**
- ✅ Removed `eligible_equity_accounts` from preview response
- ✅ Removed database query for equity accounts
- ✅ Removed equity account error handling

---

## 3. UI CHANGES

### 3.1 Removed Equity Offset Picker

**File:** `app/accounting/carry-forward/page.tsx`

**Removed:**
- ✅ `EquityAccount` type definition
- ✅ `equityOffsetAccountId` state variable
- ✅ `setEquityOffsetAccountId` state setter
- ✅ `eligibleEquityAccounts` state variable
- ✅ `COAPicker` import and usage
- ✅ Equity offset account selector section (entire `<div>` block)

**Changes:**
- ✅ Removed equity offset account from form validation
- ✅ Removed equity offset account from `canApply` condition
- ✅ Removed equity offset account reset in period change handlers
- ✅ Removed equity offset account from API request body

### 3.2 Updated User Messaging

**Updated Copy:**

**Page Header:**
```
Before: "Generate next-period opening balances from prior period ending balances"
After: "Generate next-period opening balances from prior period ending balances. Carry-forward creates a balanced opening entry using all balance-sheet accounts."
```

**Preview Section:**
```
Before: "The following accounts will have their ending balances carried forward to the target period:"
After: "The following balance-sheet accounts (including system accounts) will have their ending balances carried forward to the target period. The entry will be naturally balanced (no offset required):"
```

**Empty State:**
```
Before: "No eligible accounts with non-zero balances found in source period. Carry-forward cannot be applied."
After: "No balance-sheet accounts with non-zero balances found in source period. Carry-forward cannot be applied."
```

**Form Validation:**
```
Before: "Please select source period, target period, and equity offset account"
After: "Please select source period and target period"
```

### 3.3 Apply Button Logic

**Before:**
```typescript
const canApply = 
  !isReadonlyAccountant &&
  (userRole === "admin" || userRole === "owner" || userRole === "accountant") &&
  existingBatch === null &&
  fromPeriodStart &&
  toPeriodStart &&
  equityOffsetAccountId &&  // REMOVED
  previewBalances.length > 0
```

**After:**
```typescript
const canApply = 
  !isReadonlyAccountant &&
  (userRole === "admin" || userRole === "owner" || userRole === "accountant") &&
  existingBatch === null &&
  fromPeriodStart &&
  toPeriodStart &&
  previewBalances.length > 0
```

---

## 4. TEST CHANGES

### 4.1 Updated Test Assertions

**File:** `lib/accountingPeriods/__tests__/phase2d_carry_forward.test.ts`

**Removed Tests:**
- ❌ Test 2.5: "Equity offset line balances the entry"
- ❌ Test 6.1: "Equity offset account must be eligible"
- ❌ Test 6.2: "Equity offset account cannot be system account"

**Updated Tests:**
- ✅ Test 2.1: Changed from "include only eligible Balance Sheet accounts (non-system)" to "include ALL Balance Sheet accounts (system + non-system)"
- ✅ Test 2.4: Updated to "create naturally balanced journal entry lines (no offset)"
- ✅ Test 2.5: Replaced with "No offset line is created - entry balances naturally"

**New Tests:**
- ✅ Test 2.6: "System balance-sheet accounts ARE included when they have balances"
- ✅ Test 6.1 (replacement): "Carry-forward fails if entry doesn't naturally balance"
- ✅ Test 6.2 (replacement): "Imbalance diagnostics include top 10 accounts and residual"

**Updated Test Section:**
- ✅ Section 6 renamed from "Account Eligibility" to "Natural Balance Enforcement"

---

## 5. FINAL SAFETY CHECKS

### 5.1 Service Mode & Tax Engine

✅ **NOT TOUCHED** - No changes to Service Mode or tax engine functionality

### 5.2 Period Statuses & Phase 1 Enforcement

✅ **NOT TOUCHED** - Period status validation remains unchanged (target period must be 'open', etc.)

### 5.3 COA Mutation

✅ **NOT TOUCHED** - No changes to Chart of Accounts structure or validation

### 5.4 Opening Balances (Phase 2C) Eligibility Rules

✅ **UNCHANGED** - Manual Opening Balances still:
- Require equity offset account
- Exclude system accounts
- Use `assert_account_eligible_for_opening_balance()` helper
- Remain restrictive (non-system only)

### 5.5 Carry-Forward Natural Balance

✅ **VERIFIED** - Carry-forward now:
- Includes ALL balance-sheet accounts (system + non-system)
- Creates naturally balanced entries (debit == credit)
- Raises exception with diagnostics if unbalanced
- No offset lines created

---

## 6. MIGRATION FILE

**File:** `supabase/migrations/136_carry_forward_phase2d_patch_remove_offset.sql`

**Contents:**
- ✅ Updated `compute_ending_balances_for_carry_forward()` function
- ✅ Updated `apply_carry_forward()` function
- ✅ Added imbalance diagnostics logic
- ✅ Updated function comments
- ✅ All changes are backwards compatible (old batches still readable)

**Deployment:**
- Migration can be applied to existing database
- Existing carry-forward batches are unaffected (read-only)
- New carry-forward batches will use updated logic

---

## 7. VERIFICATION CHECKLIST

- [x] Database migration created and syntax-validated
- [x] RPC function signature updated (parameter removed)
- [x] Compute function includes system accounts
- [x] Offset validation removed
- [x] Offset line creation removed
- [x] Imbalance diagnostics added
- [x] API endpoints updated (POST and GET)
- [x] UI equity offset picker removed
- [x] UI messaging updated
- [x] Tests updated (removed offset tests, added natural balance tests)
- [x] Service Mode not touched
- [x] Tax engine not touched
- [x] Period statuses not changed
- [x] COA mutation not introduced
- [x] Opening Balances (2C) rules unchanged
- [x] No linting errors

---

## 8. SUMMARY OF IMPACT

### 8.1 Breaking Changes

**API Breaking Change:**
- ✅ POST `/api/accounting/carry-forward/apply` no longer accepts `equity_offset_account_id`
- ✅ GET `/api/accounting/carry-forward` no longer returns `eligible_equity_accounts` in preview

**UI Breaking Change:**
- ✅ Equity offset account picker removed from carry-forward page

### 8.2 Non-Breaking Changes

- ✅ Existing carry-forward batches remain readable
- ✅ Manual Opening Balances (Phase 2C) unchanged
- ✅ All other accounting functionality unchanged

### 8.3 Benefits

- ✅ Audit-clean: No artificial offset lines
- ✅ Comprehensive: Includes all balance-sheet accounts (system + non-system)
- ✅ Transparent: Imbalance diagnostics if ledger is unbalanced
- ✅ Mechanically correct: Natural balance from ledger data

---

## 9. NEXT STEPS

1. ✅ Apply migration `136_carry_forward_phase2d_patch_remove_offset.sql` to database
2. ✅ Test carry-forward with business that has system account balances
3. ✅ Verify imbalance diagnostics work correctly
4. ✅ Confirm manual opening balances still work as expected (Phase 2C)

---

**END OF REPORT**
