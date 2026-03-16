# Track C1.4 — Business COA Bootstrap: Implementation Summary

**Date:** 2025-01-17  
**Status:** ✅ COMPLETE

---

## OBJECTIVE

Provide an explicit, idempotent way to initialize a business so it can transact:
- Populate `chart_of_accounts` from existing `accounts` table
- Create required control account mappings (AR, AP, CASH, BANK)
- WITHOUT weakening ledger safeguards
- WITHOUT auto-running during posting

---

## IMPLEMENTATION

### Function Created

**File:** `supabase/migrations/176_business_coa_bootstrap.sql`

**Function:** `initialize_business_chart_of_accounts(p_business_id UUID)`

**Behavior:**
1. **Syncs accounts** from `accounts` table → `chart_of_accounts` (idempotent)
   - Maps type `'income'` → `'revenue'` (chart_of_accounts uses 'revenue')
   - Uses `ON CONFLICT DO UPDATE` to ensure accounts stay in sync

2. **Creates control mappings** (idempotent):
   - `AR` → `1100` (Accounts Receivable)
   - `AP` → `2000` (Accounts Payable)
   - `CASH` → `1000` (Cash)
   - `BANK` → `1010` (Bank)

3. **Idempotent guards:**
   - `ON CONFLICT DO NOTHING` for mappings
   - `ON CONFLICT DO UPDATE` for accounts (keeps in sync)

---

## CONTROL MAPPINGS CREATED

| Control Key | Account Code | Account Name |
|-------------|--------------|--------------|
| `AR` | `1100` | Accounts Receivable |
| `AP` | `2000` | Accounts Payable |
| `CASH` | `1000` | Cash |
| `BANK` | `1010` | Bank |

**Mappings stored in:** `chart_of_accounts_control_map` table

---

## USAGE

**Explicit call (manual):**
```sql
SELECT initialize_business_chart_of_accounts(business_id);
```

**NOT auto-run:**
- No triggers added
- Does NOT run during sale/invoice posting
- Must be called explicitly when needed

---

## IDEMPOTENCY

**Safe to call multiple times:**
- Accounts: `ON CONFLICT DO UPDATE` keeps accounts in sync
- Mappings: `ON CONFLICT DO NOTHING` prevents duplicates

**No side effects:**
- Does NOT create new accounts
- Does NOT modify existing mappings
- Only syncs existing data

---

## FILES CHANGED

1. `supabase/migrations/176_business_coa_bootstrap.sql` - New migration with bootstrap function

---

## RESTRICTIONS COMPLIANCE

✅ **MUST NOT (all satisfied):**
- ❌ Modify ledger schema - No changes
- ❌ Modify posting functions - No changes
- ❌ Auto-run during posting - No triggers added
- ❌ Create new account definitions - Only syncs existing accounts
- ❌ Invent account codes - Uses existing codes from `accounts` table
- ❌ Add UI - SQL function only
- ❌ Change accounting rules - No logic changes

✅ **MAY (all used appropriately):**
- ✅ Create ONE explicit SQL function - `initialize_business_chart_of_accounts`
- ✅ Seed `chart_of_accounts` from existing `accounts` - Implemented
- ✅ Seed `chart_of_accounts_control_map` - Implemented
- ✅ Add idempotency guards - `ON CONFLICT` used throughout
- ✅ Add documentation - Function comment added

---

## RELATIONSHIP TO OTHER FIXES

**Track C1.4 complements:**
- **Migration 175** (`ensure_retail_control_account_mapping`): Runtime helper that syncs on-demand during posting
- **Migration 176** (`initialize_business_chart_of_accounts`): One-time bootstrap for full COA initialization

**Difference:**
- **175**: Ensures CASH mapping exists before posting (defensive, minimal)
- **176**: Initializes entire COA structure (proactive, complete)

Both functions are idempotent and can coexist safely.

---

**END OF TRACK C1.4 SUMMARY**
