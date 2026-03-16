# ROOT CAUSE DIAGNOSTIC REPORT: RETAIL LEDGER POSTING CREDIT=0

## Step 1: Active Function Versions & Signatures

### A. Function Definitions

#### `post_sale_to_ledger`
- **File**: `supabase/migrations/179_retail_system_accountant_posting.sql`
- **Line**: 218
- **Signature**:
```sql
CREATE OR REPLACE FUNCTION post_sale_to_ledger(
  p_sale_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL,
  p_posted_by_accountant_id UUID DEFAULT NULL
)
RETURNS UUID
```

**Migration History**:
- Migration 179 (latest): `179_retail_system_accountant_posting.sql` - Current active version
- Migration 178: `178_retail_tax_inclusive_posting_fix.sql`
- Migration 175: `175_retail_control_account_mapping.sql`
- Migration 174: `174_track_a_refund_posting_and_sale_idempotency.sql`
- Migration 171: `171_phase12_backfill_legacy_data.sql`
- Migration 162: `162_complete_sale_ledger_postings.sql`
- Migration 100: `100_control_account_resolution.sql`
- Migration 094: `094_accounting_periods.sql`
- Migration 043: `043_accounting_core.sql` (original)

#### `post_journal_entry`
- **File**: `supabase/migrations/179_retail_system_accountant_posting.sql`
- **Line**: 29
- **Signature**:
```sql
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB,
  p_is_adjustment BOOLEAN DEFAULT FALSE,
  p_adjustment_reason TEXT DEFAULT NULL,
  p_adjustment_ref TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL,
  p_posted_by_accountant_id UUID DEFAULT NULL
)
RETURNS UUID
```

**Migration History**:
- Migration 179 (latest): `179_retail_system_accountant_posting.sql` - Current active version (14-parameter)
- Migration 171: `171_phase12_backfill_legacy_data.sql`
- Migration 172: `172_phase12b_backfill_completion_compatibility.sql` (wrapper)
- Migration 166: `166_controlled_adjustments_soft_closed.sql`
- Migration 165: `165_period_locking_posting_guards.sql`
- Migration 043: `043_accounting_core.sql` (original)

### B. RPC Call Site

**File**: `app/api/sales/create/route.ts`
**Line**: 1071-1077

**Exact Call**:
```typescript
const { data: journalEntryId, error: ledgerError } = await supabase.rpc(
  "post_sale_to_ledger",
  {
    p_sale_id: sale.id,
    p_posted_by_accountant_id: business.owner_id, // System accountant: business owner
  }
)
```

**Parameters Passed**:
- `p_sale_id`: UUID of the created sale
- `p_posted_by_accountant_id`: Business owner ID (system accountant)
- `p_entry_type`: NOT passed (defaults to NULL)
- `p_backfill_reason`: NOT passed (defaults to NULL)
- `p_backfill_actor`: NOT passed (defaults to NULL)

---

## Step 2: Diagnostic Instrumentation Added

### Location: `supabase/migrations/179_retail_system_accountant_posting.sql`

Diagnostic `RAISE NOTICE` statements have been added at critical points to capture evidence:

#### Diagnostic Point 1: After Tax Extraction (Line ~381)
Captures variable assignments after tax_lines_jsonb parsing:
- `gross_total`, `net_total`, `total_tax_amount`
- `tax_lines_jsonb` type (NULL, object, array)

#### Diagnostic Point 2: After Initial Journal Lines Build (Line ~593)
Captures state after the base 4 journal lines are built:
- `net_total`, `total_tax_amount`
- Full `journal_lines` JSONB

#### Diagnostic Point 3: Tax Posting Branch Decision (Line ~599)
Shows which branch is taken:
- `parsed_tax_lines` array length
- `total_tax_amount` value

#### Diagnostic Point 4: After Parsed Tax Lines Loop (Line ~653)
If `parsed_tax_lines` branch is taken, shows state after loop:
- Full `journal_lines` JSONB

#### Diagnostic Point 5: After Fallback Tax Payable (Line ~675)
If fallback branch is taken, shows state:
- Full `journal_lines` JSONB

#### Diagnostic Point 6: Final Evidence Before post_journal_entry (Line ~680)
**PRIMARY EVIDENCE CAPTURE** - Immediately before calling `post_journal_entry()`:

1. **Totals**:
   - `EVIDENCE gross_total=%, net_total=%, tax_total=%, cogs=%`

2. **Tax Data**:
   - `EVIDENCE tax_lines_jsonb=%` (full JSONB)
   - `EVIDENCE parsed_tax_lines_length=%`

3. **Journal Lines**:
   - `EVIDENCE journal_lines=%` (full JSONB)

4. **Per-Line Details**:
   - `EVIDENCE line[N] account_id=% debit=% credit=% desc=%` (for each line)

5. **Summary Counts**:
   - `EVIDENCE line_count=%, debit_count=%, credit_count=%, debit_sum=%, credit_sum=%`

6. **Account IDs**:
   - `EVIDENCE cash_account_id=%, revenue_account_id=%, cogs_account_id=%, inventory_account_id=%`

---

## Step 3: Evidence Collection Instructions

### To Capture Evidence:

1. **Enable NOTICE logging** in your database client or application logs
2. **Create a test sale** that triggers the error
3. **Collect all `RAISE NOTICE` output** prefixed with `EVIDENCE`
4. **Look for the diagnostic output** in:
   - PostgreSQL server logs
   - Supabase dashboard logs (if using Supabase)
   - Application error logs (if NOTICE is forwarded)

### Expected Output Format:

```
NOTICE: EVIDENCE gross_total=100.00, net_total=83.34, tax_total=16.66, cogs=0.00
NOTICE: EVIDENCE tax_lines_jsonb={"tax_lines": [...], "subtotal_excl_tax": 83.34, "tax_total": 16.66, "total_incl_tax": 100.00}
NOTICE: EVIDENCE parsed_tax_lines_length=2
NOTICE: EVIDENCE journal_lines=[{"account_id": "...", "debit": 100.00, "credit": null, ...}, ...]
NOTICE: EVIDENCE line[1] account_id=... debit=100.00 credit=0.00 desc=Sale receipt
NOTICE: EVIDENCE line[2] account_id=... debit=0.00 credit=83.34 desc=Sales revenue
...
NOTICE: EVIDENCE line_count=4, debit_count=1, credit_count=1, debit_sum=100.00, credit_sum=0.00
```

---

## Step 4: Analysis Framework

Once evidence is collected, answer:

### A. Are revenue/tax credit lines missing entirely?
- **Check**: Count of lines in `journal_lines`
- **Expected**: At least 4 lines (cash debit, revenue credit, COGS debit, inventory credit)
- **If missing**: Revenue credit line was never added

### B. Are credit lines present but `credit` is NULL or 0?
- **Check**: Per-line evidence showing `credit=0.00` or `credit=null`
- **If present but 0**: Variable (`net_total` or `total_tax_amount`) was 0 when line was built

### C. Which variable fed the credit?
- **Revenue credit**: Should use `net_total` (line ~575)
- **Tax credit**: Should use `total_tax_amount` (line ~636 or ~669)
- **Check**: `after_initial_build` diagnostic shows what `net_total` and `total_tax_amount` were

### D. Which branch was taken?
- **Check**: `tax_posting_branch` diagnostic
- **If `parsed_tax_lines_length > 0`**: Individual tax lines branch
- **Else if `total_tax_amount > 0`**: Fallback VAT Payable branch
- **Else**: No tax credit line added

---

## Step 5: Root Cause Determination

After collecting evidence, the root cause will be one of:

1. **Credits Missing Entirely**: Revenue credit line never added to `journal_lines`
   - **Evidence**: `line_count=3` (only cash, COGS, inventory)
   - **Location**: Line ~567-587 (journal_lines build)

2. **Credits Present But Zero**: `net_total` or `total_tax_amount` was 0
   - **Evidence**: `credit=0.00` in per-line output, but `net_total=0` or `total_tax_amount=0` in totals
   - **Location**: Line ~575 (revenue credit) or line ~636/669 (tax credit)

3. **Tax Lines Not Parsed**: `parsed_tax_lines` is empty but `total_tax_amount > 0`
   - **Evidence**: `parsed_tax_lines_length=0` but `total_tax_amount=16.66`
   - **Location**: Line ~599 (branch decision) or line ~652 (fallback branch)

4. **Variable Assignment Error**: `net_total` or `total_tax_amount` incorrectly calculated
   - **Evidence**: `after_tax_extraction` shows wrong values
   - **Location**: Lines ~294-360 (tax extraction logic)

---

## Next Steps

1. **Run a test sale** that triggers the error
2. **Collect all diagnostic output** from logs
3. **Analyze using the framework above**
4. **Report findings** with specific evidence quotes
5. **Remove diagnostic instrumentation** after root cause is identified

---

## Diagnostic Code Removal

All diagnostic code is marked with:
- `-- DIAGNOSTIC INSTRUMENTATION (TEMPORARY - REMOVE AFTER ROOT CAUSE ANALYSIS)`
- `-- END DIAGNOSTIC INSTRUMENTATION`

Search for these markers to remove all diagnostic code after analysis is complete.
