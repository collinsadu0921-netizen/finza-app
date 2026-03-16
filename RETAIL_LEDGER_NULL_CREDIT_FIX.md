# Retail Ledger NULL Credit Fix - Migration 180

## Problem Summary

Retail posting sometimes failed with:
```
Debit total: 100.00, Credit total: 0
```

**Root Cause:**
- `net_total` could remain NULL after extraction logic
- Line 387 coerced NULL to 0: `net_total := COALESCE(net_total, 0)`
- Validation failed open because `NULL <= 0` evaluates to NULL (not TRUE)
- Revenue credit became 0 → unbalanced journal entry

## Solution

### 1. Removed Silent Coercion to Zero

**Before:**
```sql
net_total := COALESCE(net_total, 0);  -- BUG: NULL becomes 0
total_tax_amount := COALESCE(total_tax_amount, 0);
```

**After:**
- Removed all `COALESCE(x, 0)` fallbacks for totals
- Totals are computed deterministically and validated explicitly

### 2. Deterministic Total Computation

Totals are now computed in a single "Finalize Totals" block with clear precedence:

1. **Authoritative Source:** `gross_total` from `sale_record.amount` (checkout charge)
2. **Primary Extraction:** Read `subtotal_excl_tax` and `tax_total` from `tax_lines_jsonb` object
3. **Derive Missing:** If one exists, calculate the other: `net_total = gross_total - total_tax_amount`
4. **Fallback:** If both missing, sum from `parsed_tax_lines` array
5. **Fail Closed:** If still NULL, raise explicit exception (no silent defaults)

### 3. Explicit NULL Guards (Fail Closed)

Added hard guards immediately after total computation:

```sql
IF net_total IS NULL THEN
  RAISE EXCEPTION 'Retail posting error: net_total is NULL (cannot post). sale_id=%', p_sale_id;
END IF;

IF total_tax_amount IS NULL THEN
  RAISE EXCEPTION 'Retail posting error: total_tax_amount is NULL (cannot post). sale_id=%', p_sale_id;
END IF;
```

These guards ensure NULL values **cannot** leak into journal entry construction.

### 4. Accounting Identity Enforcement

Added invariant check:

```sql
IF ABS(gross_total - (net_total + total_tax_amount)) > 0.01 THEN
  RAISE EXCEPTION 'Retail posting error: totals mismatch...';
END IF;
```

This ensures the accounting equation `gross = net + tax` holds within rounding tolerance.

### 5. Guaranteed Non-NULL Totals in Journal Lines

When building `journal_lines` JSONB:

**Before:**
```sql
'credit', ROUND(COALESCE(net_total, 0), 2),  -- Could be 0 if net_total was NULL
```

**After:**
```sql
'credit', net_total,  -- Guaranteed non-NULL and > 0 (validated above)
```

Totals are used directly without COALESCE because they're guaranteed non-NULL at this point.

## Why NULL Cannot Leak Into Credits Anymore

1. **Explicit NULL Guards:** The function explicitly checks for NULL and raises exceptions (fail closed)
2. **No Silent Coercion:** Removed all `COALESCE(x, 0)` that could hide NULL values
3. **Deterministic Computation:** Totals are computed in a single, clear block with explicit precedence
4. **Validation Before Use:** All totals are validated as non-NULL before being used in journal_lines construction
5. **Accounting Invariant:** The function enforces `gross = net + tax` identity, preventing inconsistent states

## Test Coverage

The test function `test_retail_ledger_null_credit_fix()` verifies:

- **Test A:** Canonical `tax_lines_jsonb` with `subtotal_excl_tax` + `tax_total` → succeeds, balanced
- **Test B:** Only `parsed_tax_lines` array (derive totals) → succeeds, balanced  
- **Test C:** NULL `tax_lines_jsonb` → fails with explicit error (not unbalanced journal)

All tests verify journal entries are balanced (debits = credits).

## Migration Files

- `180_retail_ledger_null_credit_fix.sql` - Main fix
- `180_retail_ledger_null_credit_fix_test.sql` - Test/verification

## Backward Compatibility

The function signature is unchanged. The behavior change is:
- **Before:** Could silently produce credit=0 from NULL totals
- **After:** Explicitly fails if totals cannot be determined

This is a **breaking change** for sales with invalid/missing tax_lines, but prevents silent data corruption (unbalanced journals).
