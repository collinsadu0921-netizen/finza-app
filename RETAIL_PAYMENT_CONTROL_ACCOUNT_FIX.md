# Retail Payment → Control Account Mapping Fix

**Date:** 2025-01-17  
**Issue:** "Missing control account mapping: CASH" error when creating Retail sales

---

## TASK 1 — Payment → Control Account Mapping Location

### Current Mapping Logic

**File:** `supabase/migrations/162_complete_sale_ledger_postings.sql`

**Line 150:** `post_sale_to_ledger` function uses:
```sql
cash_account_code := get_control_account_code(business_id_val, 'CASH');
```

**Function:** `get_control_account_code` (from `migrations/098_chart_of_accounts_validation.sql`)

**Behavior:**
- Reads from `chart_of_accounts_control_map` table
- Requires mapping: `control_key = 'CASH'` → `account_code`
- Raises "Missing control account mapping: CASH" if mapping not found
- Also validates that mapped account exists in `chart_of_accounts` (not `accounts`)

**Current Mapping:**
- `post_sale_to_ledger` ONLY uses `'CASH'` control key (hardcoded)
- Does NOT resolve different accounts based on payment method (cash/momo/card)
- All sales post to CASH account regardless of actual payment method

---

## TASK 2 — Existing Accounts Inspection

### Account Codes Expected

Based on `create_system_accounts` (migration 162):
- `1000` - Cash (asset) in `accounts` table
- `1010` - Bank (asset) in `accounts` table
- `1020` - Mobile Money (asset) in `accounts` table

### Control Keys Required

For Retail sales posting (`post_sale_to_ledger`):
- `'CASH'` - Required (currently only control key used)

### Account Table System Mismatch

**Two Account Systems:**
1. **Legacy system:** `accounts` table (used by `get_account_by_code`, Retail)
2. **New system:** `chart_of_accounts` + `chart_of_accounts_control_map` (used by `get_control_account_code`, Accounting Mode)

**Problem:** 
- Retail businesses have accounts in `accounts` table (via `create_system_accounts`)
- But `get_control_account_code` requires accounts in `chart_of_accounts` table
- Retail businesses may not have accounts in `chart_of_accounts` or control mappings

---

## TASK 3 — Fix: Ensure Control Mapping Exists

### Minimal Fix Strategy

1. **Create helper function** `ensure_retail_control_account_mapping` that:
   - Checks if account code '1000' exists in `chart_of_accounts`
   - If not, checks if it exists in `accounts` table (legacy)
   - If exists in `accounts`, syncs it to `chart_of_accounts` (minimal fix - syncing existing accounts, not creating new)
   - If doesn't exist in either, throws clear error
   - Creates mapping `'CASH' -> '1000'` in `chart_of_accounts_control_map` if not exists

2. **Call helper in `post_sale_to_ledger`** before `get_control_account_code`

3. **Rules:**
   - Mapping must be **explicit** (created by helper, not auto-inferred)
   - No silent fallback to CASH (mapping must exist)
   - If account missing → throw clear error

### Implementation

**File:** `supabase/migrations/175_retail_control_account_mapping.sql`

**Function:** `ensure_retail_control_account_mapping(p_business_id, 'CASH', '1000')`
- Checks `chart_of_accounts` for account code '1000'
- If not found, checks `accounts` table and syncs to `chart_of_accounts` (if exists)
- Creates mapping `'CASH' -> '1000'` if not already present
- If account doesn't exist in either table, raises exception

**Call Location:** `post_sale_to_ledger` function (before `get_control_account_code` call)

**Syncing Logic:**
- IF account exists in `accounts` but not `chart_of_accounts` → sync to `chart_of_accounts`
- This is NOT auto-creating - it's syncing existing accounts between two systems
- Type mapping: `'income'` → `'revenue'` (chart_of_accounts uses 'revenue', accounts uses 'income')

---

## Files Changed

1. `supabase/migrations/175_retail_control_account_mapping.sql` - New migration with helper function and updated `post_sale_to_ledger`

---

## Error Handling

If account '1000' doesn't exist in either `accounts` or `chart_of_accounts`:
- **Error Message:** "Cannot create control account mapping: Account code 1000 does not exist in accounts or chart_of_accounts for business {business_id}. Please ensure default accounts are created first."
- **Do NOT:** Auto-create account
- **Do NOT:** Fall back to other accounts

---

## Mapping Configuration

**Explicit Mapping:**
```sql
CASH → 1000 (Cash account)
```

**Created by:** `ensure_retail_control_account_mapping` function
**Stored in:** `chart_of_accounts_control_map` table

---

**END OF FIX DOCUMENTATION**
