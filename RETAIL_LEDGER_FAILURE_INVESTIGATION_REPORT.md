# RETAIL → LEDGER FAILURE: INFORMATION GATHERING REPORT

## Executive Summary
Retail sale posting fails with journal entry imbalance: **Debit: 100, Credit: 83.34** (difference: 16.66). Root cause: Tax lines are present in `tax_lines` JSONB but missing `ledger_account_code` and `ledger_side` fields required for ledger posting. The tax amount (16.66) is not being posted as a credit line, causing the imbalance.

---

## 1. Retail Posting Call Stack

### Entry Point
- **File**: `app/api/sales/create/route.ts`
- **Function**: `POST(request: NextRequest)` (exported async function)
- **Line**: 26-1215

### Ledger Posting Call
- **Location**: `app/api/sales/create/route.ts:1063-1068`
- **Method**: Supabase RPC call
- **Function**: `post_sale_to_ledger(p_sale_id: UUID)`
- **Called after**: Sale record and sale_items are created (line 1059)
- **Error handling**: Rollback on failure (lines 1070-1114)

### Payload Structure (Fields Only)
```typescript
{
  business_id: UUID
  user_id: UUID
  store_id: UUID
  active_store_id: UUID
  cashier_session_id: UUID | null
  register_id: UUID | null
  amount: number              // Gross total (tax-inclusive)
  subtotal: number            // Same as amount (tax-inclusive)
  tax_total: number            // Always 0 (taxes already included)
  nhil: number                // Legacy field (for reporting only)
  getfund: number              // Legacy field (for reporting only)
  covid: number                // Legacy field (for reporting only)
  vat: number                  // Legacy field (for reporting only)
  description: string | null
  payment_method: string
  payment_status: string
  payments: PaymentLine[]     // Array of payment methods
  cash_amount: number
  momo_amount: number
  card_amount: number
  cash_received: number
  change_given: number
  sale_items: SaleItem[]       // Array of cart items
  tax_lines: any               // JSONB tax lines (see section 3)
  tax_engine_code: string | null
  tax_engine_effective_from: string | null  // YYYY-MM-DD format
  tax_jurisdiction: string | null
}
```

---

## 2. Expected vs Actual Tax Line Flow

### Expected Flow (Where Tax Lines Should Be Generated)
1. **Frontend Calculation**: `app/(dashboard)/pos/page.tsx:1942-1947`
   - Uses `calculateTaxes()` from `lib/taxEngine/index.ts`
   - Calculates taxes in tax-inclusive mode
   - Returns `TaxCalculationResult` with `LegacyTaxLine[]`

2. **Serialization**: `app/(dashboard)/pos/page.tsx:1950`
   - Uses `taxResultToJSONB()` from `lib/taxEngine/helpers.ts:160-173`
   - **CRITICAL ISSUE**: This function only includes: `code`, `name`, `rate`, `base`, `amount`
   - **MISSING FIELDS**: `ledger_account_code`, `ledger_side` are NOT included

3. **Storage**: `app/api/sales/create/route.ts:409`
   - Stores `tax_lines` as JSONB in `sales` table
   - Format: `{ tax_lines: [{ code, name, rate, base, amount }], subtotal_excl_tax, tax_total, total_incl_tax }`

4. **Ledger Posting**: `supabase/migrations/178_retail_tax_inclusive_posting_fix.sql:240-290`
   - Reads `tax_lines` from `sales.tax_lines` column
   - Expects `ledger_account_code` and `ledger_side` in each tax line
   - **FALLBACK**: If missing, maps tax code to account code (line 251-253)
   - **FALLBACK**: If missing, defaults `ledger_side` to 'credit' (line 257-259)

### Actual Flow (What Happens Today)
1. ✅ Tax calculation happens in frontend
2. ✅ Tax lines are serialized to JSONB
3. ❌ **`ledger_account_code` and `ledger_side` are stripped out during serialization**
4. ✅ Tax lines are stored in database
5. ⚠️ Ledger posting function has fallback mapping, but **only works if tax_lines array is present and non-empty**
6. ❌ **If tax_lines is missing/empty but tax amount > 0, fallback posts to VAT Payable (2100) but only if total_tax_amount > 0**

### Tax Engine Output (What's Available)
- **Location**: `lib/taxEngine/jurisdictions/ghana.ts:242-294`
- **Fields Generated**: `code`, `name`, `rate`, `base`, `amount`, **`ledger_account_code`**, **`ledger_side`**, `is_creditable_input`, `absorbed_to_cost`
- **Serialization Loss**: `taxResultToJSONB()` only preserves `code`, `name`, `rate`, `base`, `amount`

---

## 3. Runtime Payload Snapshot (Fields Only)

### At API Entry (`/api/sales/create`)
| Field | Present | Format | Source |
|-------|---------|--------|--------|
| `tax_lines` | ✅ YES | JSONB object | Frontend `taxResultToJSONB()` |
| `tax_engine_code` | ✅ YES | string | `getTaxEngineCode(jurisdiction)` |
| `tax_engine_effective_from` | ✅ YES | string (YYYY-MM-DD) | Current date |
| `tax_jurisdiction` | ✅ YES | string | Business country code |
| `amount` | ✅ YES | number | Cart total (tax-inclusive) |
| `subtotal` | ✅ YES | number | Same as amount |
| `tax_total` | ✅ YES | number | Always 0 (taxes included) |

### Tax Lines Structure (What's Stored)
```json
{
  "tax_lines": [
    {
      "code": "VAT",
      "name": "VAT",
      "rate": 0.15,
      "base": 83.34,
      "amount": 16.66
      // ❌ MISSING: ledger_account_code
      // ❌ MISSING: ledger_side
    }
  ],
  "subtotal_excl_tax": 83.34,
  "tax_total": 16.66,
  "total_incl_tax": 100.00
}
```

### At Ledger Posting (`post_sale_to_ledger`)
| Field | Present | Value | Source |
|-------|---------|-------|--------|
| `sale_record.tax_lines` | ✅ YES | JSONB | From `sales` table |
| `parsed_tax_lines` | ✅ YES | Array | Parsed from JSONB |
| `tax_line_item->>'ledger_account_code'` | ❌ NO | NULL | Missing from JSONB |
| `tax_line_item->>'ledger_side'` | ❌ NO | NULL | Missing from JSONB |
| `tax_line_item->>'code'` | ✅ YES | "VAT" | Present in JSONB |
| `tax_line_item->>'amount'` | ✅ YES | 16.66 | Present in JSONB |
| `total_tax_amount` | ✅ YES | 16.66 | Sum of tax line amounts |
| `gross_total` | ✅ YES | 100.00 | `sale_record.amount` |
| `net_total` | ✅ YES | 83.34 | `gross_total - total_tax_amount` |

### Field Presence Matrix
| Field | Frontend | API Payload | Database | Ledger Function |
|-------|----------|-------------|----------|-----------------|
| `tax_lines` | ✅ | ✅ | ✅ | ✅ |
| `tax_lines[].code` | ✅ | ✅ | ✅ | ✅ |
| `tax_lines[].amount` | ✅ | ✅ | ✅ | ✅ |
| `tax_lines[].ledger_account_code` | ✅ (in engine) | ❌ | ❌ | ❌ (fallback used) |
| `tax_lines[].ledger_side` | ✅ (in engine) | ❌ | ❌ | ❌ (fallback used) |
| `tax_engine_code` | ✅ | ✅ | ✅ | N/A |
| `tax_engine_effective_from` | ✅ | ✅ | ✅ | ✅ (used for date) |
| `tax_jurisdiction` | ✅ | ✅ | ✅ | N/A |

---

## 4. Versioning Signals Present / Missing

### Present Fields
| Field | Location | Value Example | Purpose |
|-------|----------|--------------|---------|
| `tax_engine_code` | `sales.tax_engine_code` | "ghana" | Identifies tax engine used |
| `tax_engine_effective_from` | `sales.tax_engine_effective_from` | "2025-01-15" | Effective date for tax calculation |
| `tax_jurisdiction` | `sales.tax_jurisdiction` | "GH" | Country/jurisdiction code |

### Missing Fields
| Field | Expected Location | Purpose | Impact |
|-------|-------------------|---------|--------|
| `tax_lines[].ledger_account_code` | `sales.tax_lines[].ledger_account_code` | Maps tax code to ledger account | **CRITICAL**: Required for posting tax liability |
| `tax_lines[].ledger_side` | `sales.tax_lines[].ledger_side` | Indicates debit/credit side | **CRITICAL**: Required for correct posting direction |
| `tax_lines.meta.engine_version` | `sales.tax_lines.meta.engine_version` | Tax engine version used | Low: Used for audit trail only |

### Versioning Metadata in Tax Lines
- **Current Format**: `{ tax_lines: [...], subtotal_excl_tax, tax_total, total_incl_tax }`
- **Expected Format** (per `lib/taxEngine/serialize.ts:23-38`): `{ lines: [...], meta: { jurisdiction, effective_date_used, engine_version }, pricing_mode }`
- **Mismatch**: POS uses `taxResultToJSONB()` which produces legacy format, not canonical format

---

## 5. Exact Failure Boundary

### Failure Location
- **Function**: `post_journal_entry()`
- **File**: `supabase/migrations/043_accounting_core.sql`
- **Line**: 164-166
- **Error Message**: `"Journal entry must balance. Debit: %, Credit: %"`

### Error Throw Site
```sql
-- Line 157-166 in 043_accounting_core.sql
FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
LOOP
  total_debit := total_debit + COALESCE((line->>'debit')::NUMERIC, 0);
  total_credit := total_credit + COALESCE((line->>'credit')::NUMERIC, 0);
END LOOP;

IF ABS(total_debit - total_credit) > 0.01 THEN
  RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
END IF;
```

### Call Stack
1. `app/api/sales/create/route.ts:1063` → `supabase.rpc("post_sale_to_ledger", { p_sale_id })`
2. `post_sale_to_ledger()` → Builds `journal_lines` JSONB array
3. `post_sale_to_ledger()` → Calls `post_journal_entry(business_id, date, description, 'sale', sale_id, journal_lines, ...)`
4. `post_journal_entry()` → Validates balance (line 157-166)
5. **ERROR THROWN** → Imbalance detected: Debit 100.00 ≠ Credit 83.34

### Journal Lines Built (What Gets Posted)
```json
[
  {
    "account_id": "<cash_account_id>",
    "debit": 100.00,
    "description": "Sale receipt"
  },
  {
    "account_id": "<revenue_account_id>",
    "credit": 83.34,
    "description": "Sales revenue"
  },
  {
    "account_id": "<cogs_account_id>",
    "debit": 0.00,
    "description": "Cost of goods sold"
  },
  {
    "account_id": "<inventory_account_id>",
    "credit": 0.00,
    "description": "Inventory reduction"
  }
  // ❌ MISSING: Tax payable credit line (16.66)
]
```

### Why Tax Line Is Missing
1. `post_sale_to_ledger()` reads `tax_lines` from database (line 124)
2. Parses tax lines into `parsed_tax_lines` array (lines 135-145)
3. Iterates over `parsed_tax_lines` to build journal lines (lines 242-290)
4. **Condition Check** (line 262): `IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0`
5. **Problem**: `tax_ledger_account_code` is NULL (missing from JSONB)
6. **Fallback** (line 251-253): Maps tax code to account code using `map_tax_code_to_account_code()`
7. **BUT**: Fallback only works if `tax_code IS NOT NULL` (line 251)
8. **If tax_lines array is empty or missing**: Falls through to line 291-308 (fallback to VAT Payable)
9. **However**: If `parsed_tax_lines` array has items but `ledger_account_code` is NULL, the mapping should work
10. **Root Cause**: Need to verify if `tax_code` is present in the JSONB structure

### Detection Point
- **Before Ledger Call**: ❌ NO (validation happens in `post_journal_entry`)
- **Inside Ledger Function**: ✅ YES (`post_journal_entry` validates balance)
- **By Constraint/Trigger**: ❌ NO (validation is in function, not constraint)

### Error Propagation
1. `post_journal_entry()` throws exception
2. Exception caught by `post_sale_to_ledger()` (not explicitly caught, propagates up)
3. Exception caught by `app/api/sales/create/route.ts:1102` (catch block)
4. Sale is rolled back (lines 1105-1113)
5. Error returned to frontend (line 1107-1112)

---

## Summary of Findings

### Key Facts
1. **Tax lines ARE present** in `sales.tax_lines` JSONB column
2. **Tax lines ARE parsed** correctly by `post_sale_to_ledger()`
3. **Tax amounts ARE calculated** correctly (16.66)
4. **`ledger_account_code` and `ledger_side` are MISSING** from stored JSONB
5. **Fallback mapping exists** but may not be triggered if tax_lines structure is unexpected
6. **Failure occurs** when `post_journal_entry()` validates balance and finds Debit (100) ≠ Credit (83.34)

### Critical Gap
The serialization function `taxResultToJSONB()` in `lib/taxEngine/helpers.ts:160-173` strips out `ledger_account_code` and `ledger_side` fields that are generated by the tax engine but not preserved in the JSONB format sent to the API.

### Data Flow Issue
```
Tax Engine → LegacyTaxLine (has ledger_account_code, ledger_side)
    ↓
taxResultToJSONB() → Strips ledger fields
    ↓
API Payload → Missing ledger fields
    ↓
Database → Missing ledger fields
    ↓
post_sale_to_ledger() → Tries to use fallback mapping
    ↓
post_journal_entry() → Validates balance → FAILS (missing tax credit line)
```

---

## Appendix: File References

### Key Files
- `app/api/sales/create/route.ts` - Sale creation API endpoint
- `app/(dashboard)/pos/page.tsx` - POS frontend (tax calculation and sale creation)
- `lib/taxEngine/helpers.ts` - Tax serialization (`taxResultToJSONB`)
- `lib/taxEngine/jurisdictions/ghana.ts` - Ghana tax engine (generates ledger fields)
- `supabase/migrations/178_retail_tax_inclusive_posting_fix.sql` - Current `post_sale_to_ledger` function
- `supabase/migrations/043_accounting_core.sql` - `post_journal_entry` function (balance validation)

### Migration History
- `178_retail_tax_inclusive_posting_fix.sql` - Latest (has fallback mapping)
- `174_track_a_refund_posting_and_sale_idempotency.sql` - Previous version (no fallback)
- `162_complete_sale_ledger_postings.sql` - Original implementation

---

**Report Generated**: Information gathering only - no fixes implemented
**Status**: Ready for fix design phase
