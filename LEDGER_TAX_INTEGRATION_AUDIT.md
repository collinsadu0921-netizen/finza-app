# Ledger Tax Integration Audit (Read-Only)

**Date**: 2025-01-27  
**Status**: READ-ONLY ANALYSIS - NO CODE CHANGES

---

## 1. Ledger Architecture

### How Journal Entries Are Created

- **Function**: `post_journal_entry()` in `supabase/migrations/043_accounting_core.sql` (lines 138-186)
- **Input Format**: Takes `p_lines JSONB` array with structure:
  ```json
  [
    {
      "account_id": "UUID",
      "debit": NUMERIC,
      "credit": NUMERIC,
      "description": TEXT
    }
  ]
  ```
- **Validation**: Enforces debits = credits (tolerance: 0.01)
- **Tables**:
  - `journal_entries`: Header (id, business_id, date, description, reference_type, reference_id)
  - `journal_entry_lines`: Lines (id, journal_entry_id, account_id, debit, credit, description)

### How Debit/Credit Is Represented

- **Structure**: Two separate numeric columns (`debit`, `credit`) in `journal_entry_lines` table
- **Format**: Both columns are `NUMERIC`, default 0
- **Usage**: Exactly one column has a value per line (not both)
- **Reference**: `supabase/migrations/043_accounting_core.sql` lines 49-57

### Control Accounts (2100-2130) Handling

- **Current State**: Only account **2100** (VAT Payable) exists
- **Location**: Created in `create_system_accounts()` function (line 82)
- **Missing Accounts**: 
  - **2110** (NHIL Payable) - DOES NOT EXIST
  - **2120** (GETFund Payable) - DOES NOT EXIST  
  - **2130** (COVID Payable) - DOES NOT EXIST
- **Reference**: `supabase/migrations/043_accounting_core.sql` lines 66-113
- **Other Tax Account**: Account **2200** ("Other Tax Liabilities") exists but is NOT used in current posting functions

---

## 2. Current Tax Handling

### Where Taxes Touch the Ledger

**Invoices** (`post_invoice_to_ledger`):
- **Location**: `supabase/migrations/043_accounting_core.sql` lines 191-257
- **Tax Posting**: Single line posting all taxes to account 2100
  ```sql
  jsonb_build_object(
    'account_id', vat_account_id,  -- Always '2100'
    'credit', total_tax,            -- Aggregated total_tax
    'description', 'VAT payable'
  )
  ```
- **Source**: Reads `i.total_tax` from invoices table (aggregated)

**Bills** (`post_bill_to_ledger`):
- **Location**: `supabase/migrations/043_accounting_core.sql` lines 413-474
- **Tax Posting**: Single line posting to account 2100 (as debit for input tax)
  ```sql
  jsonb_build_object(
    'account_id', vat_input_account_id,  -- Always '2100'
    'debit', bill_record.total_tax,       -- Aggregated total_tax
    'description', 'VAT input tax'
  )
  ```
- **Source**: Reads `b.total_tax` from bills table (aggregated)

**Expenses** (`post_expense_to_ledger`):
- **Location**: `supabase/migrations/043_accounting_core.sql` lines 556-617
- **Tax Posting**: Single line posting to account 2100 (as debit for input tax)
  ```sql
  jsonb_build_object(
    'account_id', vat_input_account_id,  -- Always '2100'
    'debit', expense_record.total_tax,    -- Aggregated total_tax
    'description', 'VAT input tax'
  )
  ```
- **Source**: Reads `e.total_tax` from expenses table (aggregated)

**Sales** (Retail/POS):
- **Status**: **NO LEDGER POSTING FUNCTION EXISTS**
- **Location**: `app/api/sales/create/route.ts` - Creates sale record but no ledger posting
- **Impact**: Sales transactions are NOT posted to ledger, so output taxes from sales are NOT recorded

### Whether Taxes Are Inferred, Hardcoded, or Metadata-Driven

- **Current State**: **HARDCODED**
- **Evidence**:
  - All posting functions hardcode account code '2100' via `get_account_by_code(business_id_val, '2100')`
  - Tax amounts come from aggregated `total_tax` column
  - No reading of `tax_lines` JSONB column (exists but unused for posting)
  - No use of `TaxLine.ledger_account_code` or `TaxLine.ledger_side` metadata

### Existing Netting or Shortcuts

- **Aggregation**: All tax types (NHIL, GETFund, COVID, VAT) are summed into single `total_tax` value
- **Single Account**: All taxes post to single account 2100, regardless of tax type
- **No Separation**: Individual tax components (NHIL, GETFund, COVID) are NOT posted separately
- **No Control Accounts**: GRA control accounts 2110-2130 don't exist in system accounts

---

## 3. Compatibility Check

### Can Ledger Accept `ledger_account_code`?

- **Current Schema**: `journal_entry_lines` table has:
  - `id` (UUID)
  - `journal_entry_id` (UUID)
  - `account_id` (UUID) - **References accounts table by UUID, not code**
  - `debit` (NUMERIC)
  - `credit` (NUMERIC)
  - `description` (TEXT)
  - `created_at` (TIMESTAMP)
- **Gap**: Table uses `account_id` (UUID), not `ledger_account_code` (string)
- **Resolution**: Must convert code → UUID via `get_account_by_code()` function
- **Status**: ✅ **COMPATIBLE** (via conversion function)

### Can Ledger Accept `ledger_side`?

- **Current Schema**: Uses separate `debit` and `credit` columns
- **Gap**: No `ledger_side` column exists; must map 'debit'/'credit' → `debit`/`credit` columns
- **Resolution**: Map `ledger_side: 'debit'` → set `debit` column, `ledger_side: 'credit'` → set `credit` column
- **Status**: ✅ **COMPATIBLE** (via mapping logic)

### Can Ledger Accept `absorbed_to_cost`?

- **Current Schema**: No column exists for this flag
- **Gap**: `absorbed_to_cost` is metadata, not a ledger field
- **Impact**: When `absorbed_to_cost = true`, tax should NOT post to control account; should be included in expense/asset cost instead
- **Resolution**: Use flag to conditionally skip posting tax line (or post to expense/asset account with base amount)
- **Status**: ✅ **COMPATIBLE** (as logic flag, not storage field)

### Minimal Gap Summary

1. **Account Code → UUID Conversion**: Must use `get_account_by_code()` to resolve code strings to UUIDs
2. **Side Mapping**: Must map `ledger_side` string to `debit`/`credit` column values
3. **Absorption Logic**: Must use `absorbed_to_cost` flag to skip control account posting when true

---

## 4. Safety Risks

### Double-Posting Risks

- **Risk**: If `tax_lines` JSONB is used for posting AND legacy `total_tax` is also posted
- **Current State**: ✅ **SAFE** - Only `total_tax` is currently used; `tax_lines` is not read
- **Future Risk**: ⚠️ **HIGH** - If new code posts from `tax_lines` without disabling legacy `total_tax` posting, taxes will be double-counted

### Skipped Posting Risks

- **Current Risk**: ✅ **LOW** - Sales don't post to ledger (already skipped, but intentionally)
- **Future Risk**: ⚠️ **MEDIUM** - If `tax_lines` contains `null` account codes (non-creditable inputs), those taxes must NOT post to control accounts; must be absorbed into cost

### Wrong Sign Risks

- **Current State**: ✅ **SAFE** - Hardcoded logic correctly uses:
  - Sales: Credit to 2100 (output tax)
  - Purchases: Debit to 2100 (input tax)
- **Future Risk**: ⚠️ **HIGH** - If `ledger_side` from `TaxLine` metadata is used incorrectly:
  - Sales should credit control accounts
  - Purchases should debit control accounts (or skip if `absorbed_to_cost = true`)
- **Specific Risk**: Ghana tax engine returns `ledger_side: 'debit'` for purchase inputs; must ensure this maps correctly in purchase context

### Multi-Jurisdiction Conflict Risks

- **Current State**: ✅ **SAFE** - Hardcoded to Ghana account 2100
- **Future Risk**: ⚠️ **CRITICAL** - If system expands to other jurisdictions:
  - Account codes will differ by jurisdiction
  - Must read `tax_lines[].ledger_account_code` per jurisdiction
  - Hardcoded '2100' will break for non-Ghana businesses

### Ghana GRA Control Accounts Conflict

- **Current State**: ⚠️ **INCOMPATIBLE**
- **Issue**: GRA requires separate control accounts:
  - 2100: VAT only
  - 2110: NHIL only
  - 2120: GETFund only
  - 2130: COVID only (pre-2026)
- **Current Behavior**: All taxes post to 2100 only
- **Impact**: Cannot generate GRA-compliant tax returns from ledger data
- **Evidence**: `lib/taxEngine/jurisdictions/ghana.ts` lines 79-201 returns correct account codes (2100, 2110, 2120, 2130), but these are NOT used in posting functions

---

## 5. Summary

### Is Ledger Currently SAFE to Accept Ghana TaxLine Metadata?

**Answer**: ❌ **NO - BLOCKERS EXIST**

### Exact Blockers (No Solutions)

1. **Missing Control Accounts**
   - Accounts 2110, 2120, 2130 do NOT exist in `create_system_accounts()`
   - Location: `supabase/migrations/043_accounting_core.sql` lines 66-113
   - Impact: Cannot post NHIL, GETFund, COVID to correct accounts

2. **Tax Aggregation Problem**
   - Current posting uses aggregated `total_tax` column
   - TaxLine metadata has individual tax components (NHIL, GETFund, COVID, VAT)
   - Impact: Cannot post taxes separately to different control accounts

3. **Hardcoded Account Logic**
   - All posting functions hardcode account '2100'
   - TaxLine metadata provides correct codes (2100, 2110, 2120, 2130) but they're ignored
   - Impact: Cannot use metadata-driven posting without refactoring all posting functions

4. **No TaxLine Metadata Reading**
   - `tax_lines` JSONB column exists on invoices/sales tables (migration 083)
   - Posting functions do NOT read `tax_lines` column
   - Impact: Must add logic to parse `tax_lines` array and post each tax line separately

5. **Absorption Logic Missing**
   - When `TaxLine.absorbed_to_cost = true`, tax should NOT post to control account
   - Current logic always posts `total_tax` to control account
   - Impact: Non-creditable input taxes (pre-2026 NHIL/GETFund purchases) will be incorrectly posted

6. **Sales Not Posted**
   - No function exists to post sales to ledger
   - Sales contain output taxes that should credit control accounts
   - Impact: Cannot post sales output taxes even with correct metadata

### Compatibility Assessment

- **Schema Compatibility**: ✅ Schema can accept metadata (via conversion functions)
- **Logic Compatibility**: ❌ Current logic cannot use metadata (hardcoded, aggregated)
- **Account Compatibility**: ❌ Required accounts do not exist (2110-2130)
- **Data Compatibility**: ⚠️ `tax_lines` column exists but is unused in posting

---

## References

- Ledger schema: `supabase/migrations/043_accounting_core.sql`
- Tax engine metadata: `lib/taxEngine/jurisdictions/ghana.ts`
- Tax types: `lib/taxEngine/types.ts`
- Tax columns migration: `supabase/migrations/083_add_generic_tax_columns.sql`
- Tax immutability: `supabase/migrations/090_final_hard_constraints.sql`
- Ledger posting rules (documentation): `docs/GHANA_LEDGER_POSTING_RULES.md`





