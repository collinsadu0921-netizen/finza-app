# Architecture Critical Q&A: Data Integrity & Failure Handling

**Document Version:** 1.0  
**Date:** 2025-01-17  
**Classification:** Technical architecture documentation  
**Audience:** Technical team, auditors

---

## EXECUTIVE SUMMARY

This document addresses critical architectural questions about data integrity, failure handling, and system guarantees in the Finza accounting system.

---

## Q1: What Guarantees That Every Operational Transaction Has Exactly One Journal Entry?

### Answer

**Multiple layers prevent duplicate journal entries:**

#### Layer 1: Application-Level Guards (Existence Checks)

**Invoices:**
- **File:** `supabase/migrations/043_accounting_core.sql` (lines 929-945)
- **Trigger Function:** `trigger_post_invoice()`
- **Check:**
  ```sql
  IF NOT EXISTS (
    SELECT 1 FROM journal_entries 
    WHERE reference_type = 'invoice' 
      AND reference_id = NEW.id
  ) THEN
    PERFORM post_invoice_to_ledger(NEW.id);
  END IF;
  ```
- **Enforcement:** Database trigger checks before posting

**Payments:**
- **File:** `supabase/migrations/043_accounting_core.sql` (lines 955-969)
- **Trigger Function:** `trigger_post_payment()`
- **Check:**
  ```sql
  IF NOT EXISTS (
    SELECT 1 FROM journal_entries 
    WHERE reference_type = 'payment' 
      AND reference_id = NEW.id
  ) THEN
    PERFORM post_payment_to_ledger(NEW.id);
  END IF;
  ```
- **Enforcement:** Database trigger checks before posting

**Sales (Explicit Call):**
- **File:** `app/api/sales/create/route.ts` (lines 1008-1013)
- **Process:** `post_sale_to_ledger()` is called explicitly (not via trigger)
- **Guard:** `post_sale_to_ledger()` function checks for existing journal entry internally (not visible in migration 162, but should be added)

#### Layer 2: Database Function Guards (Should Have Existence Checks)

**Current State:** Sales posting function (`post_sale_to_ledger`) does NOT check for existing journal entry before posting.

**Recommendation:** Add existence check to `post_sale_to_ledger()`:
```sql
-- Check if already posted (prevent duplicates)
IF EXISTS (
  SELECT 1 FROM journal_entries
  WHERE reference_type = 'sale'
    AND reference_id = p_sale_id
) THEN
  -- Return existing journal entry ID
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'sale'
    AND reference_id = p_sale_id;
  RETURN journal_id;
END IF;
```

#### Layer 3: Reconciliation Validation (Post-Posting)

**File:** `app/api/sales/create/route.ts` (lines 1061-1138)
- **Function:** `validate_sale_reconciliation(p_sale_id)`
- **Purpose:** Validates operational data matches ledger data
- **Action:** Rolls back sale if reconciliation fails

**Current Gap:** No database-level unique constraint prevents duplicates if application logic fails.

### Summary

| Transaction Type | Duplicate Prevention | Enforcement Level |
|-----------------|---------------------|-------------------|
| Invoices | ✅ EXISTS check in trigger | Database trigger |
| Payments | ✅ EXISTS check in trigger | Database trigger |
| Sales | ⚠️ **MISSING** (explicit call, no existence check) | Application logic only |
| Credit Notes | ✅ EXISTS check in trigger | Database trigger |

**Recommendation:** Add existence check to `post_sale_to_ledger()` function or add database unique constraint on `(reference_type, reference_id)` where `reference_id IS NOT NULL`.

---

## Q2: What Happens on Network Failure After Sale Insert But Before RPC Posting?

### Answer

**Manual rollback logic (NOT database transaction):**

#### Current Implementation

**File:** `app/api/sales/create/route.ts` (lines 1007-1059)

**Flow:**
1. **Sale INSERT** → Commits immediately (auto-commit)
2. **Sale Items INSERT** → Commits immediately (auto-commit)
3. **Stock Deduction** → Commits immediately (auto-commit)
4. **Ledger Posting RPC Call** → If fails, manual rollback:
   ```typescript
   if (ledgerError) {
     // Rollback: Delete sale, sale_items
     await supabase.from("sale_items").delete().eq("sale_id", sale.id)
     await supabase.from("sales").delete().eq("id", sale.id)
     return NextResponse.json({ error: ... }, { status: 500 })
   }
   ```

**Problem:** If network failure occurs AFTER sale INSERT but BEFORE ledger posting RPC completes:

1. **Sale exists in database** (already committed)
2. **No journal entry created** (RPC never completes)
3. **Manual rollback executes** (if error is caught)
4. **BUT:** If error is NOT caught (network timeout, connection drop), sale remains without journal entry

#### Network Failure Scenarios

**Scenario A: RPC Call Times Out (Error Caught)**
- **Result:** Manual rollback deletes sale and sale_items
- **State:** No orphaned sale record
- **File:** `app/api/sales/create/route.ts` (lines 1047-1058)

**Scenario B: Network Connection Drops (Error NOT Caught)**
- **Result:** Sale remains in database, no journal entry
- **State:** **Orphaned sale record** (operational data without ledger)
- **Detection:** `validate_sale_reconciliation()` would catch this on next sale creation attempt (but doesn't fix existing orphans)

**Scenario C: Partial RPC Success (Rare)**
- **Result:** Journal entry created but API response lost
- **State:** Sale exists, journal entry exists, but API returns error
- **Impact:** User sees error but transaction actually succeeded (requires manual verification)

#### Current Gap: No Transaction Boundary

**Issue:** No database transaction wraps sale creation and ledger posting:
- Each Supabase operation is auto-committed
- No `BEGIN/COMMIT/ROLLBACK` wrapper
- Manual rollback is best-effort (may fail if network drops)

**Recommendation:** Use database transactions for atomic sale creation + ledger posting:
```sql
BEGIN;
  -- Create sale
  INSERT INTO sales (...) VALUES (...);
  -- Post to ledger (same transaction)
  PERFORM post_sale_to_ledger(sale_id);
COMMIT;
```

**Alternative:** Implement idempotent posting function that checks for existing journal entry before creating.

### Summary

| Failure Point | Current Behavior | Risk |
|--------------|------------------|------|
| After sale INSERT, before RPC | Manual rollback deletes sale | ✅ Low (if error caught) |
| Network timeout during RPC | Error caught, manual rollback | ✅ Low |
| Connection drop (no error) | Sale remains, no journal entry | ⚠️ **HIGH** (orphaned sale) |
| Partial RPC success | Sale + journal entry exist, but API returns error | ⚠️ **MEDIUM** (confusing UX) |

**Mitigation:** Use database transactions or implement idempotent posting with existence checks.

---

## Q3: How Are Refunds/Returns Represented and Posted?

### Answer

**Refunds currently DO NOT create journal entries (critical gap):**

#### Current Refund Implementation

**File:** `app/api/override/refund-sale/route.ts`

**What Refunds DO:**
1. ✅ **Update sale status:** `sales.payment_status = 'refunded'`
2. ✅ **Restore inventory:** Increments `products_stock` (adds stock back)
3. ✅ **Create audit logs:** `overrides` table (refund approval), `stock_movements` table (stock restoration)
4. ❌ **DO NOT create journal entries:** No ledger posting

**What Refunds DO NOT DO:**
- ❌ Do not create reversal journal entries
- ❌ Do not reduce Revenue account
- ❌ Do not reduce Cash account
- ❌ Do not reduce COGS expense (restore inventory asset)
- ❌ Do not increase Inventory asset (should restore)

**Result:** Refunded sales remain in ledger as revenue, but inventory is restored. **Ledger and operational data become inconsistent.**

#### Intended Refund Journal Entry Structure

**Based on migration 092 (credit note reversal pattern):**
- **File:** `supabase/migrations/092_step6_credit_note_recognition_reversal.sql` (lines 194-218)
- **Pattern:** Reversal entries:
  ```
  Debit: Revenue (4000) - reduces income
  Credit: AR/Cash (1000/1100) - reduces asset (or creates refund payable)
  
  For inventory sales:
  Debit: Inventory (1200) - restores asset
  Credit: COGS (5000) - reduces expense
  ```

**Current State:** `post_refund_to_ledger()` function exists but is **NOT called** from refund API route.

#### Refund Posting Function (Exists But Unused)

**File:** `supabase/migrations/092_step6_credit_note_recognition_reversal.sql` (lines 200-218)
- **Function:** `post_refund_to_ledger(p_refund_id UUID)`
- **Status:** **NOT IMPLEMENTED** (assumes `refunds` table exists, but it doesn't)
- **Usage:** **NOT CALLED** from `app/api/override/refund-sale/route.ts`

### Summary

| Refund Action | Operational Impact | Ledger Impact |
|--------------|-------------------|---------------|
| Sale status → 'refunded' | ✅ Updated | ❌ None (revenue remains) |
| Inventory restored | ✅ Stock added back | ❌ None (COGS remains, inventory not restored) |
| Cash refunded | ⚠️ Manual process (not automated) | ❌ None (cash not reduced) |
| Journal entry created | ❌ **NO** | ❌ **NO** |

**Critical Gap:** Refunds do not post to ledger, creating reconciliation issues.

**Recommendation:** Add ledger posting to refund flow:
```typescript
// After refund approval in app/api/override/refund-sale/route.ts
const { data: journalEntryId } = await supabase.rpc("post_refund_to_ledger", {
  p_sale_id: sale.id, // or create refunds table and use refund_id
  p_refund_amount: sale.amount,
  p_refund_date: new Date().toISOString().split('T')[0],
})
```

---

## Q4: How Do You Prevent Backdating into Closed Periods (and What Is the Policy)?

### Answer

**Multi-layer enforcement prevents backdating:**

#### Policy

**Period status determines posting rules:**
- **`'open'`** - Accepts all postings (sales, invoices, payments, adjustments)
- **`'soft_closed'`** - Accepts adjustments only (no regular postings)
- **`'locked'`** - Accepts nothing (immutable forever)

**Backdating Rule:** Transactions with `date` in a locked/soft-closed period are blocked, regardless of when the transaction is created.

#### Enforcement Layers

**Layer 1: Application-Level Guards**

**File:** `supabase/migrations/165_period_locking_posting_guards.sql`
- **Function:** `assert_accounting_period_is_open(p_business_id, p_date, p_is_adjustment)` (lines 21-47)
- **Called By:**
  - `post_sale_to_ledger()` (uses `sale.created_at::DATE`)
  - `post_invoice_to_ledger()` (uses `invoice.issue_date`)
  - `post_expense_to_ledger()` (uses `expense.date`)
  - `post_journal_entry()` (uses `p_date` parameter)
- **Validation:**
  ```sql
  -- Find period by date range
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND p_date >= period_start
    AND p_date <= period_end;
  
  -- Block locked and soft-closed (for regular postings)
  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Accounting period is locked...';
  END IF;
  ```

**Layer 2: Database Function Guards**

**File:** `supabase/migrations/165_period_locking_posting_guards.sql`
- **Function:** `post_journal_entry()` (lines 109-167)
- **Validation:**
  ```sql
  PERFORM assert_accounting_period_is_open(p_business_id, p_date);
  ```
- **Enforcement:** All ledger posting functions validate period before INSERT

**Layer 3: Database Trigger Guards (Hard Enforcement)**

**File:** `supabase/migrations/088_hard_db_constraints_ledger.sql`
- **Trigger:** `trigger_enforce_period_state_on_entry` (lines 247-251)
- **Trigger Function:** `validate_period_open_for_entry()` (lines 57-100 in migration 165)
- **Fires:** BEFORE INSERT on `journal_entries` table
- **Validation:**
  ```sql
  -- Find period by date range
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE business_id = NEW.business_id
    AND NEW.date >= period_start
    AND NEW.date <= period_end;
  
  -- Block locked and soft-closed
  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Cannot insert journal entry into locked period...';
  END IF;
  ```
- **Cannot Be Bypassed:** Trigger fires on ALL INSERTs, regardless of application code

**Layer 4: Date Validation (Period Resolution)**

**File:** `supabase/migrations/165_period_locking_posting_guards.sql` (lines 65-78)
- **Period Resolution:** Finds period where `p_date >= period_start AND p_date <= period_end`
- **Hard Enforcement:** If no period exists for date, raises exception (no silent fallback):
  ```sql
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No accounting period found for date %. Period must exist before posting. Business ID: %',
      p_date, p_business_id;
  END IF;
  ```

#### Backdating Prevention Examples

**Example 1: Sale with Backdated Date**
```typescript
// Sale created on 2025-01-17 with date = '2024-12-15' (locked period)
const sale = await supabase.from("sales").insert({
  created_at: '2024-12-15', // Backdated
  amount: 1000,
  ...
})

// Ledger posting will fail
const { error } = await supabase.rpc("post_sale_to_ledger", { p_sale_id: sale.id })
// Error: "Accounting period is locked (period_start: 2024-12-01). Posting is blocked."
```

**Example 2: Invoice with Backdated Issue Date**
```sql
-- Invoice with issue_date in locked period
INSERT INTO invoices (issue_date, status, ...) VALUES ('2024-12-15', 'sent', ...);
-- Trigger fires: trigger_auto_post_invoice
-- Calls post_invoice_to_ledger()
-- Function checks period: assert_accounting_period_is_open()
-- Period found: status = 'locked'
-- Exception raised: "Accounting period is locked..."
-- Invoice INSERT succeeds, but journal entry blocked by trigger
```

#### Period Resolution (Date-to-Period Mapping)

**Process:**
1. Posting function receives `date` (from sale.created_at, invoice.issue_date, or parameter)
2. Queries `accounting_periods` for period where `date BETWEEN period_start AND period_end`
3. Validates period `status` (must be `'open'` for regular postings)
4. Blocks if period is `'locked'` or `'soft_closed'` (for regular postings)

**Key Point:** Date range matching prevents backdating because period status is checked based on transaction date, not creation timestamp.

### Summary

| Backdating Scenario | Prevention Mechanism | Enforcement Level |
|---------------------|---------------------|-------------------|
| Sale with backdated `created_at` | `assert_accounting_period_is_open()` checks `sale.created_at::DATE` | Application + Function |
| Invoice with backdated `issue_date` | `post_invoice_to_ledger()` checks `invoice.issue_date` | Function + Trigger |
| Direct SQL INSERT bypass | `validate_period_open_for_entry()` trigger blocks | **Database trigger (hard)** |
| Service role bypass | **Triggers still fire** (RLS bypassed, triggers not) | **Database trigger (hard)** |

**Result:** Backdating is prevented at **three layers** - impossible to bypass even with service role or direct SQL.

---

## Q5: Can a Service Role Bypass Triggers and Constraints?

### Answer

**Service role CAN bypass RLS, but CANNOT bypass triggers or constraints:**

#### RLS (Row Level Security) Bypass

**Service Role Key:** `SUPABASE_SERVICE_ROLE_KEY`
- **Bypasses RLS:** ✅ YES
- **Effect:** Can INSERT/UPDATE/DELETE rows that would be blocked by RLS policies
- **Usage:** Used in `app/api/sales/create/route.ts` (lines 10-16) for `stock_movements` inserts

**Example:**
```typescript
const serviceRoleClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY // Bypasses RLS
)

// This INSERT bypasses RLS policies
await serviceRoleClient.from("stock_movements").insert({...})
```

#### Database Triggers: NOT Bypassed

**Triggers ALWAYS fire, regardless of role:**
- **File:** `supabase/migrations/088_hard_db_constraints_ledger.sql`
- **Trigger:** `trigger_enforce_period_state_on_entry` (BEFORE INSERT on `journal_entries`)
- **Bypass:** ❌ **NO** - Triggers fire for ALL roles (service_role, authenticated, anon, postgres)

**Test:**
```sql
-- Even with service_role, trigger fires
SET ROLE service_role;
INSERT INTO journal_entries (business_id, date, ...) VALUES (...);
-- Trigger validates period status BEFORE INSERT completes
-- If period is locked, exception raised (trigger blocks)
```

**Result:** Service role **cannot bypass** period locking, double-entry validation, or immutability triggers.

#### Database Constraints: NOT Bypassed

**Constraints ALWAYS enforced, regardless of role:**
- **UNIQUE constraints:** Enforced for all roles
- **CHECK constraints:** Enforced for all roles
- **FOREIGN KEY constraints:** Enforced for all roles
- **EXCLUDE constraints:** Enforced for all roles

**Example:**
```sql
-- Even with service_role, constraints enforce
SET ROLE service_role;
-- Double-entry balance: enforced by trigger (cannot bypass)
-- Period locking: enforced by trigger (cannot bypass)
-- Immutability: enforced by trigger (cannot bypass)
```

#### What Service Role CANNOT Bypass

1. **Database triggers** (BEFORE/AFTER INSERT/UPDATE/DELETE)
   - `trigger_enforce_period_state_on_entry` - Period locking
   - `trigger_enforce_double_entry_balance` - Double-entry validation
   - `trigger_prevent_journal_entry_modification` - Immutability

2. **Database constraints** (CHECK, UNIQUE, FOREIGN KEY, EXCLUDE)
   - `journal_entries` adjustment metadata constraints
   - `accounting_periods` exclusion constraint (no overlapping periods)

3. **Database functions** (cannot bypass function-level guards)
   - `assert_accounting_period_is_open()` - Period status check
   - `post_journal_entry()` - Balance validation, period check

**What Service Role CAN Bypass:**
- ✅ **RLS policies** (Row Level Security)
- ✅ **Application-level authorization checks** (if code uses service role)
- ⚠️ **BUT:** Triggers and constraints still enforce accounting rules

### Summary

| Enforcement Mechanism | Service Role Bypass | Hard Guarantee |
|----------------------|-------------------|----------------|
| RLS policies | ✅ YES (bypasses RLS) | ❌ No (only access control) |
| Database triggers | ❌ **NO** (always fire) | ✅ **YES** (hard enforcement) |
| Database constraints | ❌ **NO** (always enforced) | ✅ **YES** (hard enforcement) |
| Function guards | ❌ **NO** (executed regardless) | ✅ **YES** (hard enforcement) |

**Result:** Service role can bypass **access control** (RLS), but **cannot bypass accounting integrity** (triggers, constraints, function guards).

---

## Q6: Can You Regenerate Trial Balance Snapshots Deterministically and Reconcile Them to the Ledger?

### Answer

**Yes - Trial Balance snapshots are deterministic and can be regenerated and reconciled:**

#### Deterministic Generation

**File:** `supabase/migrations/169_trial_balance_canonicalization.sql`
- **Function:** `generate_trial_balance(p_period_id)` (lines 56-209)
- **Source Data (Ledger-Only):**
  1. Opening balances: `period_opening_balances` table (per account, per period)
  2. Period activity: `journal_entry_lines` table (filtered by `journal_entries.date` within period range)
- **Calculation:**
  ```sql
  -- For each account:
  opening_balance = SELECT opening_balance FROM period_opening_balances
  period_debit = SUM(jel.debit) WHERE je.date IN [period_start, period_end]
  period_credit = SUM(jel.credit) WHERE je.date IN [period_start, period_end]
  
  -- Closing balance (based on account type)
  IF account_type IN ('asset', 'expense') THEN
    closing_balance = opening_balance + (period_debit - period_credit)
  ELSE
    closing_balance = opening_balance + (period_credit - period_debit)
  END IF;
  ```
- **Deterministic:** Same inputs (period_id, ledger data) = same outputs (trial balance)

#### Regeneration Process

**Step 1: Regenerate Snapshot**
```sql
-- Regenerate trial balance for a period
SELECT generate_trial_balance('period-uuid', NULL);
-- Output: JSONB with account balances, totals, snapshot persisted to trial_balance_snapshots
```

**Step 2: Verify Balance Invariant**
```sql
-- Function enforces: total_debits MUST equal total_credits
IF ABS(total_debits - total_credits) > 0.01 THEN
  RAISE EXCEPTION 'Trial Balance does not balance...';
END IF;
```

**Step 3: Reconcile to Ledger (Manual Query)**
```sql
-- Verify snapshot matches ledger-derived values
SELECT 
  tbs.total_debits as snapshot_debits,
  tbs.total_credits as snapshot_credits,
  -- Calculate from ledger
  (SELECT SUM(jel.debit) FROM journal_entry_lines jel
   JOIN journal_entries je ON je.id = jel.journal_entry_id
   WHERE je.date >= ap.period_start AND je.date <= ap.period_end) as ledger_debits,
  (SELECT SUM(jel.credit) FROM journal_entry_lines jel
   JOIN journal_entries je ON je.id = jel.journal_entry_id
   WHERE je.date >= ap.period_start AND je.date <= ap.period_end) as ledger_credits
FROM trial_balance_snapshots tbs
JOIN accounting_periods ap ON ap.id = tbs.period_id
WHERE tbs.period_id = 'period-uuid';
-- snapshot_debits should equal ledger_debits
-- snapshot_credits should equal ledger_credits
```

#### Reconciliation Validation Function

**File:** `supabase/migrations/169_trial_balance_canonicalization.sql`
- **Function:** `validate_statement_reconciliation(p_period_id)` (lines 371-448)
- **Purpose:** Validates P&L and Balance Sheet reconcile to Trial Balance snapshot
- **Validation:**
  1. Gets Trial Balance snapshot
  2. Calculates P&L totals from snapshot (income - expenses)
  3. Calculates Balance Sheet totals from snapshot (assets = liabilities + equity)
  4. Verifies Balance Sheet equation: `ABS(assets - (liabilities + equity)) <= 0.01`
  5. Raises exception if reconciliation fails

**Usage:**
```sql
-- Validate reconciliation
SELECT validate_statement_reconciliation('period-uuid');
-- Returns JSONB with reconciliation result
-- OR raises exception if reconciliation fails
```

#### Snapshot Regeneration (Idempotent)

**File:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 194-203)
- **Persist Logic:** `ON CONFLICT (period_id) DO UPDATE`
- **Effect:** Regenerating trial balance for the same period **overwrites** existing snapshot
- **Idempotent:** Multiple regenerations produce same result (deterministic)

**Example:**
```sql
-- First generation
SELECT generate_trial_balance('period-uuid', NULL);
-- Creates snapshot with generated_at = NOW()

-- Regenerate (same period)
SELECT generate_trial_balance('period-uuid', NULL);
-- Updates snapshot with new generated_at = NOW()
-- Account balances remain same (deterministic)
```

#### Verification Queries

**Verify Snapshot Matches Ledger:**
```sql
-- Compare snapshot totals with ledger totals
WITH ledger_totals AS (
  SELECT 
    SUM(jel.debit) as total_debits,
    SUM(jel.credit) as total_credits
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounting_periods ap ON ap.id = 'period-uuid'
  WHERE je.date >= ap.period_start
    AND je.date <= ap.period_end
)
SELECT 
  tbs.total_debits as snapshot_debits,
  tbs.total_credits as snapshot_credits,
  lt.total_debits as ledger_debits,
  lt.total_credits as ledger_credits,
  ABS(tbs.total_debits - lt.total_debits) as debit_diff,
  ABS(tbs.total_credits - lt.total_credits) as credit_diff
FROM trial_balance_snapshots tbs
CROSS JOIN ledger_totals lt
WHERE tbs.period_id = 'period-uuid';
-- debit_diff and credit_diff should be 0 (or < 0.01 for floating-point)
```

**Verify Account Balances Match:**
```sql
-- Compare snapshot account balances with ledger-derived balances
WITH ledger_accounts AS (
  SELECT 
    a.id as account_id,
    COALESCE(pob.opening_balance, 0) as opening_balance,
    SUM(jel.debit) as period_debit,
    SUM(jel.credit) as period_credit,
    CASE 
      WHEN a.type IN ('asset', 'expense') THEN
        COALESCE(pob.opening_balance, 0) + (SUM(jel.debit) - SUM(jel.credit))
      ELSE
        COALESCE(pob.opening_balance, 0) + (SUM(jel.credit) - SUM(jel.debit))
    END as closing_balance
  FROM accounts a
  LEFT JOIN period_opening_balances pob ON pob.period_id = 'period-uuid' AND pob.account_id = a.id
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounting_periods ap ON ap.id = 'period-uuid'
  WHERE je.date >= ap.period_start AND je.date <= ap.period_end
  GROUP BY a.id, pob.opening_balance, a.type
)
SELECT 
  (tbs.snapshot_data->>account_id)::jsonb->>'closing_balance' as snapshot_balance,
  la.closing_balance as ledger_balance,
  ABS((tbs.snapshot_data->>account_id)::jsonb->>'closing_balance')::NUMERIC - la.closing_balance) as difference
FROM trial_balance_snapshots tbs
CROSS JOIN ledger_accounts la
WHERE tbs.period_id = 'period-uuid';
-- difference should be 0 (or < 0.01) for all accounts
```

### Summary

| Aspect | Status | Verification |
|--------|--------|--------------|
| Deterministic Generation | ✅ YES | Same inputs → same outputs |
| Regeneratable | ✅ YES | `generate_trial_balance()` can be called multiple times |
| Idempotent | ✅ YES | ON CONFLICT DO UPDATE ensures consistency |
| Reconciles to Ledger | ✅ YES | Snapshot derived from ledger-only source |
| Balance Validation | ✅ YES | Hard invariant enforced (raises exception if imbalance) |
| Reconciliation Function | ✅ YES | `validate_statement_reconciliation()` validates P&L and Balance Sheet |

**Result:** Trial Balance snapshots are **deterministic**, **regeneratable**, and **reconcilable to ledger** with verification queries provided.

---

## SUMMARY OF CRITICAL FINDINGS

### ✅ Strong Guarantees

1. **Period Locking:** Multi-layer enforcement (application, function, trigger) prevents backdating into locked periods
2. **Trial Balance Determinism:** Snapshots are deterministic and regeneratable from ledger-only source
3. **Trigger Bypass Prevention:** Service role cannot bypass triggers or constraints (only RLS)

### ⚠️ Current Gaps

1. **Sales Duplicate Prevention:** No existence check in `post_sale_to_ledger()` function (unlike invoices/payments)
2. **Network Failure Handling:** Manual rollback only (not transactional) - orphaned sales possible
3. **Refunds Missing Ledger Posting:** Refunds do not create journal entries (reconciliation gap)

### 🔧 Recommendations

1. **Add existence check to `post_sale_to_ledger()`** to prevent duplicate journal entries
2. **Use database transactions** for atomic sale creation + ledger posting (or implement idempotent posting)
3. **Implement refund ledger posting** to restore Revenue, COGS, Inventory accounts

---

**END OF DOCUMENT**
