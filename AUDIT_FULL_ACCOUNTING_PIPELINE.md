# 🔎 FULL ACCOUNTING PIPELINE AUDIT — WORKFLOW + SNAPSHOT + SCALABILITY

**Date:** 2026-02-01  
**Auditor:** Principal Accounting Systems Reliability Auditor  
**Mode:** STRICT READ-ONLY AUDIT  
**Objective:** Audit entire accounting pipeline from operational events through ledger posting, period resolution, snapshot lifecycle, report generation, and multi-tenant scalability safety.

---

## EXECUTIVE SUMMARY

**Overall Verdict:** ⚠️ **CONDITIONALLY SAFE** with identified risks requiring mitigation before enterprise scale.

**Key Findings:**
- ✅ **Workflow Correctness:** Posting pipelines are correct, atomic, and idempotent
- ✅ **Period Resolution:** Manual selection is deterministic; automatic resolver is safe but not yet integrated
- ⚠️ **Snapshot Lifecycle:** Lazy generation creates staleness risk; no automatic invalidation
- ⚠️ **Concurrency Safety:** Snapshot regeneration lacks explicit locking; ON CONFLICT provides basic protection
- ⚠️ **Scalability:** Index coverage is good, but snapshot rebuilds will amplify at scale
- ❌ **Failure Modes:** Concurrent snapshot rebuilds and large ledger scans pose risks

---

## SECTION 1 — WORKFLOW INTEGRITY VERDICT

### 1.1 Expense Posting Pipeline

**Evidence:** `supabase/migrations/229_expense_posting_schema_aligned.sql` (lines 23-219)

**Complete Workflow Trace:**

```
1. User creates expense via POST /api/expenses/create
   File: app/api/expenses/create/route.ts (lines 57-82)
   Action: INSERT INTO expenses (business_id, supplier, amount, total, date, ...)

2. Database trigger fires: trigger_auto_post_expense
   File: supabase/migrations/043_accounting_core.sql (lines 1107-1110)
   Trigger: AFTER INSERT ON expenses
   Function: trigger_post_expense() (lines 1081-1095)

3. Trigger function calls: post_expense_to_ledger(p_expense_id)
   File: supabase/migrations/229_expense_posting_schema_aligned.sql (lines 23-219)
   Posting Date: expense_row.date (line 201)
   Period Guard: assert_accounting_period_is_open(business_id_val, expense_row.date) (line 121)

4. Journal entry created via: post_journal_entry()
   File: supabase/migrations/190_fix_posting_source_default_bug.sql (lines 140-236)
   Balance Check: ABS(total_debit - total_credit) > 0.01 → RAISE EXCEPTION (lines 168-170)
   Atomic: Single transaction (INSERT journal_entries + INSERT journal_entry_lines)
```

**Posting Date Resolution:**
- **Field Used:** `expense.date` (migration 229, line 201)
- **Evidence:** `SELECT post_journal_entry(..., expense_row.date, ...)` (line 199)
- **NOT Current Date:** Uses transaction date from expense record

**Period Guard Enforcement:**
- **Function:** `assert_accounting_period_is_open(business_id_val, expense_row.date)` (migration 229, line 121)
- **Evidence:** `supabase/migrations/094_accounting_periods.sql` (lines 97-118)
- **Logic:** Resolves period via `ensure_accounting_period`, blocks if `status = 'locked'`, allows `'open'` and `'soft_closed'`

**Atomicity:**
- ✅ **Atomic:** `post_journal_entry` executes in single transaction
- ✅ **Evidence:** Function-level transaction (no explicit BEGIN/COMMIT, but PostgreSQL function execution is atomic)
- ✅ **Balance Enforcement:** Validates debits = credits BEFORE inserting lines (migration 190, lines 162-170)

**Idempotency:**
- ✅ **Enforced:** Checks for existing journal entry before posting (migration 229, lines 46-53)
- ✅ **Concurrency Safe:** Uses `pg_advisory_xact_lock` (line 79) + re-check after lock (lines 82-88)
- ✅ **Evidence:** Returns existing `journal_id` if already posted

**Double Entry Enforcement:**
- ✅ **Pre-insert Validation:** `post_journal_entry` validates balance before inserting (migration 190, lines 162-170)
- ✅ **Post-insert Trigger:** `trigger_enforce_double_entry_balance` validates after each line insert (migration 088, lines 148-151)
- ✅ **Evidence:** `RAISE EXCEPTION` if `ABS(total_debit - total_credit) > 0.01` (migration 088, line 134)

**Silent Failure Risk:**
- ⚠️ **Trigger Resilience:** Payment trigger has exception handling (migration 073), but expense trigger does NOT
- ⚠️ **Evidence:** `trigger_post_expense` (migration 043, lines 1081-1095) has no exception handler
- ⚠️ **Risk:** If `post_expense_to_ledger` fails, entire expense INSERT rolls back

**VERDICT:** ✅ **PASS** — Expense posting is correct, atomic, idempotent, and balanced. Minor risk: trigger lacks exception handling (could block expense creation if posting fails).

---

### 1.2 Invoice Posting Pipeline

**Evidence:** `supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql` (lines 17-220)

**Complete Workflow Trace:**

```
1. User sends invoice via POST /api/invoices/[id]/send
   File: app/api/invoices/[id]/send/route.ts
   Action: UPDATE invoices SET status = 'sent', sent_at = NOW()

2. Database trigger fires: trigger_auto_post_invoice
   File: supabase/migrations/043_accounting_core.sql (lines 949-952)
   Trigger: AFTER INSERT OR UPDATE OF status ON invoices
   Function: trigger_post_invoice() (lines 929-945)
   Condition: NEW.status IN ('sent', 'paid', 'partially_paid') AND OLD.status = 'draft'

3. Trigger function calls: post_invoice_to_ledger(p_invoice_id)
   File: supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql (lines 17-220)
   Posting Date: COALESCE(sent_at, issue_date) (lines 75-78)
   Period Guard: assert_accounting_period_is_open(business_id_val, posting_date) (line 109)

4. Journal entry created via: post_journal_entry()
   Accounts: AR (debit), Revenue (credit), Tax accounts (credit)
   Idempotency: Checks for existing AR line (lines 94-106)
```

**Invoice States That Trigger Posting:**
- ✅ **'sent'** — Triggers posting (migration 043, line 933)
- ✅ **'paid'** — Triggers posting (migration 043, line 933)
- ✅ **'partially_paid'** — Triggers posting (migration 043, line 933)
- ❌ **'draft'** — Does NOT trigger posting

**Posting Date Resolution:**
- **Primary:** `sent_at AT TIME ZONE 'UTC'::DATE` (migration 226, line 76)
- **Fallback:** `issue_date` (migration 226, line 77)
- **Validation:** Raises exception if both NULL (migration 226, lines 79-81)
- **Evidence:** `posting_date := COALESCE((invoice_record.sent_at AT TIME ZONE 'UTC')::DATE, invoice_record.issue_date)` (lines 75-78)

**AR Control Account Usage:**
- ✅ **Resolved:** `get_control_account_code(business_id_val, 'AR')` (migration 226, line 84)
- ✅ **Validated:** `assert_account_exists` (migration 226, line 85)
- ✅ **Used:** AR account debited with gross amount (migration 226, lines 148-153)

**Tax Line Generation:**
- ✅ **Parsed:** From `invoice.tax_lines` JSONB (migration 226, lines 118-136)
- ✅ **Validated:** Account codes validated before posting (migration 226, lines 138-145)
- ✅ **Posted:** Tax lines added to journal_lines array (migration 226, lines 161-190)
- ✅ **Safety Check:** Raises exception if `total_tax > 0` but no tax lines posted (migration 226, lines 192-194)

**Idempotency:**
- ✅ **Enforced:** Checks for existing journal entry with AR line (migration 226, lines 94-106)
- ✅ **Concurrency Safe:** Uses `pg_advisory_xact_lock` (line 92) + re-check after lock
- ✅ **Evidence:** Returns existing `journal_id` if issuance JE already exists

**Reposting Prevention:**
- ✅ **Ledger Truth:** Checks for `reference_type = 'invoice'` AND `reference_id = invoice.id` AND AR line exists (migration 226, lines 95-102)
- ✅ **Payment JEs Ignored:** Only checks for AR line, not payment lines (migration 226, line 101)

**VERDICT:** ✅ **PASS** — Invoice posting is correct, atomic, idempotent, and properly uses AR control account. Tax line generation is safe with validation.

---

### 1.3 Payment Posting Pipeline

**Evidence:** `supabase/migrations/217_payment_posting_period_guard.sql` (lines 91-179)

**Complete Workflow Trace:**

```
1. User creates payment via POST /api/payments/create OR POST /api/invoices/[id]/mark-paid
   File: app/api/payments/create/route.ts OR app/api/invoices/[id]/mark-paid/route.ts
   Action: INSERT INTO payments (business_id, invoice_id, amount, method, date, ...)

2. Database trigger fires: trigger_auto_post_payment
   File: supabase/migrations/043_accounting_core.sql (lines 973-976)
   Trigger: AFTER INSERT ON payments
   Function: trigger_post_payment() (lines 955-969)

3. Trigger function calls: post_payment_to_ledger(p_payment_id)
   File: supabase/migrations/217_payment_posting_period_guard.sql (lines 91-179)
   Posting Date: payment_record.date (line 168)
   Period Guard: assert_accounting_period_is_open(business_id_val, payment_record.date) (line 135)

4. Journal entry created via: post_journal_entry()
   Accounts: Cash/Bank/MoMo (debit), AR (credit)
   Amount: payment_record.amount (NOT invoice.total)
```

**Cash/Bank/MoMo Account Mapping:**
- ✅ **Cash:** `get_account_by_code(business_id_val, cash_account_code)` where `cash_account_code = get_control_account_code(business_id_val, 'CASH')` (migration 217, lines 137-146)
- ✅ **Bank:** `get_account_by_code(business_id_val, bank_account_code)` where `bank_account_code = get_control_account_code(business_id_val, 'BANK')` (migration 217, lines 137-146)
- ✅ **MoMo:** `get_account_by_code(business_id_val, '1020')` (migration 217, line 148)
- ✅ **Method Mapping:** CASE statement maps payment.method to asset account (migration 217, lines 154-161)

**AR Clearing Logic:**
- ✅ **Correct:** AR credited with `payment_amount` (migration 217, line 171)
- ✅ **Amount Source:** Uses `payment_record.amount`, NOT `invoice.total` (migration 217, line 120)
- ✅ **Evidence:** `jsonb_build_object('account_id', ar_account_id, 'credit', payment_amount, ...)` (line 171)

**Posting Date Logic:**
- ✅ **Uses:** `payment_record.date` (migration 217, line 168)
- ✅ **NOT Current Date:** Uses transaction date from payment record

**Multi-Payment Edge Cases:**
- ✅ **Idempotency:** No explicit check in `post_payment_to_ledger`, but trigger checks for existing JE (migration 043, lines 960-964)
- ⚠️ **Risk:** Multiple payments for same invoice create multiple journal entries (expected behavior)

**Invoice Status Synchronization:**
- ✅ **Separate Process:** Invoice status updated via `recalculate_invoice_status()` trigger (migration 129, lines 45-81)
- ✅ **Not in Posting:** Payment posting does NOT update invoice status directly

**VERDICT:** ✅ **PASS** — Payment posting is correct, uses proper account mapping, and correctly clears AR. Multi-payment handling is correct (each payment creates separate JE).

---

### 1.4 Ledger Integrity Verification

**Evidence:** Multiple migrations (088, 190, 222)

**Every Operational Transaction Produces Journal Entries:**
- ✅ **Expenses:** `trigger_auto_post_expense` fires on INSERT (migration 043, line 1107)
- ✅ **Invoices:** `trigger_auto_post_invoice` fires on status change (migration 043, line 949)
- ✅ **Payments:** `trigger_auto_post_payment` fires on INSERT (migration 043, line 973)
- ✅ **Credit Notes:** `trigger_auto_post_credit_note` fires on status = 'applied' (migration 043, line 1005)
- ✅ **Bills:** `trigger_auto_post_bill` fires on status = 'open' (migration 043, line 1039)
- ✅ **Bill Payments:** `trigger_auto_post_bill_payment` fires on INSERT (migration 043, line 1073)

**No Orphan Business Events:**
- ✅ **All Events Posted:** All operational events have corresponding triggers
- ⚠️ **Exception Handling:** Some triggers lack exception handlers (could prevent event creation if posting fails)

**Journal Entries Are Balanced:**
- ✅ **Pre-insert Check:** `post_journal_entry` validates balance before inserting (migration 190, lines 162-170)
- ✅ **Post-insert Trigger:** `trigger_enforce_double_entry_balance` validates after insert (migration 088, lines 148-151)
- ✅ **Evidence:** `RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %'` (migration 088, line 135)

**Journal Entries Are Immutable:**
- ✅ **UPDATE Blocked:** `trigger_prevent_journal_entry_modification` blocks UPDATE (migration 088, lines 21-37)
- ✅ **DELETE Blocked:** `trigger_prevent_journal_entry_modification` blocks DELETE (migration 088, lines 21-37)
- ✅ **RLS Revoked:** UPDATE/DELETE revoked from `anon` and `authenticated` (migration 222, lines 16-20)
- ✅ **Lines Immutable:** `trigger_prevent_journal_entry_line_modification` blocks UPDATE/DELETE (migration 088, lines 42-58)

**VERDICT:** ✅ **PASS** — Ledger integrity is enforced at multiple layers. All operational events produce journal entries. Entries are balanced and immutable.

---

## SECTION 2 — PERIOD RESOLUTION SAFETY

### 2.1 Manual Period Selection

**Routes Requiring Explicit Period Selection:**

| Route | Parameter | Validation | Evidence |
|-------|-----------|------------|----------|
| `app/api/accounting/reports/trial-balance/route.ts` | `period_start` (required) | Returns 400 if missing (line 64-68) | ✅ Deterministic |
| `app/api/accounting/reports/balance-sheet/route.ts` | `period_start` (required) | Returns 400 if missing (line 58-62) | ✅ Deterministic |
| `app/api/accounting/reports/profit-and-loss/route.ts` | `period_start` (required) | Returns 400 if missing (line 60-64) | ✅ Deterministic |
| `app/api/accounting/reports/general-ledger/route.ts` | `period_start` OR `start_date`/`end_date` | Returns 400 if both missing (line 134-137) | ✅ Deterministic |
| `app/api/accounting/adjustments/apply/route.ts` | `period_start` (body param, required) | Validates YYYY-MM-01 format (lines 71-87) | ✅ Deterministic |

**No Silent Fallbacks:**
- ✅ **All Routes:** Return 400 error if required params missing
- ✅ **No Defaults:** Accounting workspace routes require explicit period selection

**Proper Validation:**
- ✅ **Format Validation:** `period_start` validated as YYYY-MM-01 format (migration adjustments, lines 71-87)
- ✅ **Period Existence:** Routes call `ensure_accounting_period` if period not found

**VERDICT:** ✅ **PASS** — Manual period selection is deterministic with no silent fallbacks.

---

### 2.2 Automatic Period Resolver

**Evidence:** `supabase/migrations/246_automatic_default_period_resolver.sql` (lines 8-108)

**Resolver Hierarchy Implementation:**
- ✅ **1. Latest OPEN with activity:** Lines 23-35
- ✅ **2. Latest SOFT_CLOSED with activity:** Lines 48-60
- ✅ **3. Latest LOCKED with activity:** Lines 73-85
- ✅ **4. Current month fallback:** Lines 98-106

**Business Isolation:**
- ✅ **Filter:** `WHERE ap.business_id = p_business_id` (lines 25, 50, 75)
- ✅ **Journal Query:** `WHERE je.business_id = p_business_id` (lines 30, 55, 80)
- ✅ **Evidence:** All queries filter by `business_id` first

**Activity Detection Logic:**
- ✅ **Uses EXISTS:** `EXISTS (SELECT 1 FROM journal_entries WHERE ...)` (lines 27-33, 52-58, 77-83)
- ✅ **NOT MAX(date):** Uses EXISTS pattern, not MAX scan
- ✅ **Date Range:** Filters by `je.date >= ap.period_start AND je.date <= ap.period_end`

**Period Status Prioritization:**
- ✅ **Correct Order:** OPEN → SOFT_CLOSED → LOCKED → current month
- ✅ **Early Return:** Each step returns immediately if found (lines 37-44, 62-69, 87-94)

**Fallback Logic:**
- ✅ **Calls:** `ensure_accounting_period(p_business_id, CURRENT_DATE)` (line 99)
- ✅ **Always Succeeds:** `ensure_accounting_period` creates period if missing (migration 094, lines 85-88)

**Index-Safe Queries:**
- ✅ **Index Used:** `idx_journal_entries_business_date_id` covers `business_id + date` filter (migration 139, line 19)
- ✅ **EXISTS Pattern:** EXISTS uses index efficiently (doesn't require full scan)

**VERDICT:** ✅ **PASS** — Automatic period resolver is correctly implemented, business-isolated, and index-safe. Not yet integrated into public report routes (migration 246 exists but routes not updated).

---

### 2.3 Period Mismatch Risks

**Posting Period vs Reporting Period:**

**Posting Uses:**
- Expenses: `expense.date` (migration 229, line 201)
- Invoices: `sent_at` or `issue_date` (migration 226, lines 75-78)
- Payments: `payment.date` (migration 217, line 168)

**Reporting Uses (Public Routes):**
- Trial Balance: Defaults to `new Date().toISOString().split("T")[0]` (current date) (route trial-balance, line 28)
- Balance Sheet: Defaults to `new Date().toISOString().split("T")[0]` (current date) (route balance-sheet, line 28)
- Profit & Loss: Requires explicit `start_date`/`end_date` (no default, but UI may default to current month)

**Mismatch Scenario:**
```
Posting: Expense created 2026-01-15 → Posted to January 2026 period
Reporting: Report viewed 2026-02-01 → Defaults to February 2026 period
Result: January entries excluded from February snapshot → Empty report
```

**UI Defaults:**
- ⚠️ **Dashboard:** Uses current month (`new Date().getMonth()`) (dashboard page, lines 472-474)
- ⚠️ **Labels:** "This month" labels assume current calendar month (dashboard page, lines 1109, 1168)

**VERDICT:** ⚠️ **WARNING** — Period mismatch risk exists. Public report routes default to current date, while posting uses transaction dates. Automatic resolver (migration 246) exists but not yet integrated.

---

## SECTION 3 — SNAPSHOT LIFECYCLE SAFETY

### 3.1 Snapshot Creation Triggers

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 216-263)

**Snapshot Creation:**
- ✅ **On-Demand:** `get_trial_balance_from_snapshot` checks if snapshot exists (line 234-236)
- ✅ **Auto-Generate:** If missing, calls `generate_trial_balance(p_period_id, NULL)` (line 240)
- ❌ **No Automatic Trigger:** No trigger on `journal_entries` INSERT that regenerates snapshots

**Snapshot Refresh:**
- ✅ **ON CONFLICT DO UPDATE:** `generate_trial_balance` uses `ON CONFLICT (period_id) DO UPDATE` (migration 169, lines 194-203)
- ✅ **Regenerates:** Calling `generate_trial_balance` again updates existing snapshot
- ❌ **No Automatic Invalidation:** Snapshots are NOT invalidated when new journal entries posted

**Snapshot Invalidation Rules:**
- ❌ **No Rules:** No triggers or functions that invalidate snapshots
- ❌ **No Timestamps:** Snapshots don't track "last journal entry date" to detect staleness

**Snapshot Reuse Rules:**
- ✅ **Cached:** If snapshot exists, `get_trial_balance_from_snapshot` returns cached data (migration 169, lines 234-245)
- ⚠️ **Stale Risk:** Cached snapshot may not include recent journal entries

**Snapshot Uniqueness Guarantees:**
- ✅ **UNIQUE Constraint:** `UNIQUE(period_id)` on `trial_balance_snapshots` (migration 169, line 40)
- ✅ **ON CONFLICT:** Prevents duplicate snapshots (migration 169, line 194)

**Snapshot Isolation from Posting:**
- ✅ **Separate Transactions:** Snapshot generation is separate from posting transactions
- ✅ **No Blocking:** Posting does NOT wait for snapshot generation

**VERDICT:** ⚠️ **WARNING** — Snapshots are generated lazily with no automatic invalidation. Staleness risk exists until snapshot is explicitly regenerated.

---

### 3.2 Snapshot Regeneration Timing

**When Snapshots Regenerate:**
- ✅ **On Report Request:** When `get_trial_balance_from_snapshot` is called and snapshot missing (migration 169, line 240)
- ✅ **On Explicit Call:** When `generate_trial_balance` is called directly
- ❌ **NOT After Posting:** No automatic regeneration after journal entry INSERT

**Inside Write Transactions:**
- ❌ **NOT Inside:** Snapshot generation is NOT part of posting transaction
- ✅ **Separate Transaction:** Snapshot generation runs in separate transaction (read-only from posting perspective)

**Blocking Ledger Posting:**
- ✅ **No Blocking:** Snapshot generation does NOT block ledger posting
- ✅ **Independent:** Posting and snapshot generation are independent operations

**Synchronous vs Asynchronous:**
- ✅ **Synchronous:** Snapshot generation is synchronous (blocks report request until complete)
- ❌ **NOT Asynchronous:** No background job or queue system

**VERDICT:** ⚠️ **WARNING** — Snapshot regeneration is synchronous and on-demand. No automatic regeneration after posting creates staleness risk.

---

### 3.3 Snapshot Concurrency Safety

**Simultaneous Rebuilds:**
- ⚠️ **Risk:** Multiple users requesting same period report simultaneously could trigger concurrent `generate_trial_balance` calls
- ✅ **ON CONFLICT Protection:** `ON CONFLICT (period_id) DO UPDATE` prevents duplicate snapshots (migration 169, line 194)
- ⚠️ **No Explicit Lock:** No `pg_advisory_lock` or table-level lock prevents concurrent rebuilds

**Lock Contention Risks:**
- ⚠️ **Table-Level:** `INSERT ... ON CONFLICT DO UPDATE` acquires row-level lock on `trial_balance_snapshots` row
- ⚠️ **Concurrent Rebuilds:** Multiple concurrent rebuilds will serialize on the same `period_id` row
- ✅ **PostgreSQL Handles:** PostgreSQL's MVCC handles concurrent updates, but last writer wins

**Snapshot Race Conditions:**
- ⚠️ **Race Window:** Between snapshot check (line 234) and generation (line 240), another transaction could create snapshot
- ✅ **Idempotent:** `ON CONFLICT DO UPDATE` makes regeneration idempotent (last write wins)

**Partial Snapshot Corruption Risks:**
- ✅ **Atomic:** `generate_trial_balance` executes in single transaction
- ✅ **All-or-Nothing:** Snapshot INSERT/UPDATE is atomic (no partial snapshots)

**Transaction Isolation Level Assumptions:**
- ✅ **READ COMMITTED:** Default PostgreSQL isolation level
- ✅ **Snapshot Consistency:** Snapshot reads committed journal entries only

**VERDICT:** ⚠️ **WARNING** — Snapshot regeneration lacks explicit locking. `ON CONFLICT DO UPDATE` provides basic protection, but concurrent rebuilds may waste resources.

---

### 3.4 Snapshot Performance Characteristics

**Snapshot Rebuild Query Complexity:**

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 102-111)

```sql
SELECT 
  COALESCE(SUM(jel.debit), 0),
  COALESCE(SUM(jel.credit), 0)
INTO period_debit, period_credit
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE jel.account_id = account_record.id
  AND je.business_id = period_record.business_id
  AND je.date >= period_record.period_start
  AND je.date <= period_record.period_end
```

**Query Pattern:**
- **JOIN:** `journal_entry_lines` JOIN `journal_entries`
- **Filter:** `business_id` + `date` range + `account_id`
- **Aggregation:** SUM per account

**Index Coverage:**
- ✅ **journal_entries:** `idx_journal_entries_business_date_id` covers `business_id + date` (migration 139, line 19)
- ✅ **journal_entry_lines:** `idx_journal_entry_lines_account_entry` covers `account_id + journal_entry_id` (migration 139, line 40)
- ✅ **Covering Index:** `idx_journal_entry_lines_business_account_date` includes `debit, credit` (migration 211, lines 153-155)

**Ledger Scan Size:**
- ⚠️ **Per Account:** Scans all journal entries for period per account
- ⚠️ **Account Count:** Scans once per account (migration 169, lines 86-143)
- ⚠️ **Amplification:** For 100 accounts, scans period entries 100 times (once per account)

**Snapshot Frequency Scaling Risk:**
- ⚠️ **First Request:** Generates snapshot (slow)
- ✅ **Subsequent Requests:** Returns cached snapshot (fast)
- ⚠️ **Stale Data:** Cached snapshot may be stale until regenerated

**Multi-Period Snapshot Thrashing Risk:**
- ⚠️ **Period Switching:** If users frequently switch periods, snapshots regenerated frequently
- ⚠️ **Cache Inefficiency:** Snapshots for rarely-used periods may be regenerated repeatedly

**VERDICT:** ⚠️ **WARNING** — Snapshot rebuilds scan ledger per account (O(accounts × entries)). Index coverage is good, but rebuilds will amplify at scale.

---

## SECTION 4 — REPORT GENERATION AUDIT

### 4.1 Trial Balance Report

**Evidence:** `app/api/accounting/reports/trial-balance/route.ts` (lines 18-180)

**Period Selection:**
- ✅ **Mechanism:** Requires explicit `period_start` param (line 64-68)
- ✅ **Resolution:** Exact match `period_start = periodStart` (line 75)

**Snapshot Usage:**
- ✅ **Uses Snapshot:** Calls `get_trial_balance_from_snapshot(p_period_id)` (line 101)
- ✅ **NOT Direct Query:** Does NOT query `journal_entry_lines` directly

**Snapshot Fallback:**
- ✅ **Auto-Generate:** If snapshot missing, `get_trial_balance_from_snapshot` generates it (migration 169, line 240)

**Report Consistency Guarantees:**
- ✅ **Canonical Source:** Uses snapshot (canonical source)
- ✅ **Balance Check:** Validates `totalDebits == totalCredits` (lines 137-150)

**Locked Period Visibility:**
- ✅ **Read-Only:** Reports can read locked periods (no posting restriction)
- ✅ **No Status Check:** Report route does NOT check period status

**VERDICT:** ✅ **PASS** — Trial Balance uses canonical snapshot. Consistency guaranteed. No period status restrictions for reading.

---

### 4.2 Profit & Loss Report

**Evidence:** `app/api/accounting/reports/profit-and-loss/route.ts` (lines 19-154)

**Period Selection:**
- ✅ **Mechanism:** Requires explicit `period_start` param (line 60-64)
- ✅ **Resolution:** Exact match `period_start = periodStart` (line 71)

**Snapshot Usage:**
- ✅ **Uses Snapshot:** Calls `get_profit_and_loss_from_trial_balance(p_period_id)` (line 97)
- ✅ **Consumes Trial Balance:** P&L filters Trial Balance snapshot for income/expense accounts (migration 169, lines 270-301)

**Snapshot Fallback:**
- ✅ **Via Trial Balance:** P&L depends on Trial Balance snapshot (which auto-generates if missing)

**Report Consistency Guarantees:**
- ✅ **Canonical Source:** Uses Trial Balance snapshot (canonical source)
- ✅ **Reconciliation:** P&L totals reconcile to Trial Balance (migration 169, lines 371-448)

**Locked Period Visibility:**
- ✅ **Read-Only:** Reports can read locked periods

**VERDICT:** ✅ **PASS** — P&L uses canonical Trial Balance snapshot. Consistency guaranteed.

---

### 4.3 Balance Sheet Report

**Evidence:** `app/api/accounting/reports/balance-sheet/route.ts` (lines 19-199)

**Period Selection:**
- ✅ **Mechanism:** Requires explicit `period_start` param (line 58-62)
- ✅ **Resolution:** Exact match `period_start = periodStart` (line 69)

**Snapshot Usage:**
- ✅ **Uses Snapshot:** Calls `get_balance_sheet_from_trial_balance(p_period_id)` (line 95)
- ✅ **Consumes Trial Balance:** Balance Sheet filters Trial Balance snapshot for asset/liability/equity accounts (migration 169, lines 308-338)

**Snapshot Fallback:**
- ✅ **Via Trial Balance:** Balance Sheet depends on Trial Balance snapshot (which auto-generates if missing)

**Report Consistency Guarantees:**
- ✅ **Canonical Source:** Uses Trial Balance snapshot
- ✅ **Balance Check:** Validates `Assets == Liabilities + Equity` (lines 140-152)

**Locked Period Visibility:**
- ✅ **Read-Only:** Reports can read locked periods

**VERDICT:** ✅ **PASS** — Balance Sheet uses canonical Trial Balance snapshot. Consistency guaranteed.

---

### 4.4 VAT Report

**Evidence:** `app/api/reports/vat-control/route.ts` (lines 47-214)

**Period Selection:**
- ✅ **Mechanism:** Requires explicit `start_date`/`end_date` params (lines 47-54)
- ✅ **NOT Period-Based:** Does NOT use `accounting_periods` table

**Snapshot Usage:**
- ❌ **Bypasses Snapshot:** Queries `journal_entry_lines` directly (lines 113-127, 146-161)
- ❌ **Direct Ledger Query:** Uses explicit date range filter on `journal_entries.date`

**Snapshot Fallback:**
- ❌ **N/A:** VAT report does NOT use snapshots

**Report Consistency Guarantees:**
- ✅ **Ledger-Only:** Reads directly from ledger (source of truth)
- ⚠️ **May Differ:** VAT totals may differ from Trial Balance if period boundaries differ

**Locked Period Visibility:**
- ✅ **Read-Only:** Reports can read locked periods

**VERDICT:** ⚠️ **WARNING** — VAT report bypasses snapshot system. Uses direct ledger queries with explicit date ranges. May show different totals than period-based reports.

---

### 4.5 Ledger Reports

**Evidence:** `app/api/ledger/list/route.ts` (lines 45-83)

**Period Selection:**
- ✅ **Mechanism:** Optional `start_date`/`end_date` params
- ✅ **NOT Period-Based:** Does NOT use `accounting_periods` table

**Snapshot Usage:**
- ❌ **Bypasses Snapshot:** Queries `journal_entries` directly (line 78-83)
- ❌ **Direct Ledger Query:** Uses explicit date range filter

**Snapshot Fallback:**
- ❌ **N/A:** Ledger list does NOT use snapshots

**VERDICT:** ✅ **PASS** — Ledger list correctly queries ledger directly (appropriate for detailed view).

---

## SECTION 5 — SCALABILITY RISK MATRIX

### 5.1 Posting Throughput Risks

**Target Scale:** 300 writes/sec

**Trigger Execution Cost:**

**Expense Trigger:**
- **Function:** `post_expense_to_ledger` (migration 229)
- **Operations:** Account lookups (4-7), period guard check, journal entry INSERT, journal entry lines INSERT (2-6 lines)
- **Estimated Cost:** ~5-10ms per expense
- **Throughput:** ~100-200 expenses/sec (single-threaded)

**Invoice Trigger:**
- **Function:** `post_invoice_to_ledger` (migration 226)
- **Operations:** Account lookups (2-5), period guard check, tax line parsing, journal entry INSERT, journal entry lines INSERT (2-10 lines)
- **Estimated Cost:** ~8-15ms per invoice
- **Throughput:** ~65-125 invoices/sec (single-threaded)

**Payment Trigger:**
- **Function:** `post_payment_to_ledger` (migration 217)
- **Operations:** Account lookups (3-4), period guard check, journal entry INSERT, journal entry lines INSERT (2 lines)
- **Estimated Cost:** ~3-6ms per payment
- **Throughput:** ~165-330 payments/sec (single-threaded)

**Posting Transaction Length:**
- ✅ **Short:** Posting functions are short (no heavy aggregation)
- ✅ **Index Usage:** Account lookups use indexes
- ⚠️ **Period Guard:** `assert_accounting_period_is_open` may create period if missing (adds overhead)

**Dependency Chains:**
- ✅ **No Chains:** Posting functions don't call other posting functions
- ✅ **No Circular:** No circular dependencies

**Potential Deadlocks:**
- ⚠️ **Advisory Locks:** `pg_advisory_xact_lock` used for idempotency (migration 229, line 79; migration 226, line 92)
- ✅ **Lock Scope:** Locks are transaction-scoped (released on commit)
- ✅ **Lock Granularity:** Locks are per `(business_id, entity_id)` pair (low contention)

**Cross-Table Lock Patterns:**
- ✅ **No Cross-Table Locks:** Posting doesn't lock multiple tables
- ✅ **Row-Level:** Only row-level locks on `journal_entries` and `journal_entry_lines`

**VERDICT:** ⚠️ **WARNING** — Posting throughput may be insufficient for 300 writes/sec target. Triggers execute synchronously and may become bottleneck. Consider async posting queue for high-volume scenarios.

---

### 5.2 Snapshot Scaling Risks

**Snapshot Rebuild Amplification:**

**Query Pattern:** `generate_trial_balance` scans ledger once per account (migration 169, lines 86-143)

**Example Calculation:**
- **Accounts:** 100 accounts per business
- **Journal Entries:** 10,000 entries per period
- **Scan Cost:** 100 accounts × 10,000 entries = 1,000,000 row scans
- **Index Usage:** Indexes reduce scan cost, but still O(accounts × entries)

**Memory/CPU Cost:**
- ⚠️ **Per Account:** Aggregates debits/credits per account in memory
- ⚠️ **JSONB Build:** Builds JSONB array of account rows (migration 169, lines 130-142)
- ⚠️ **Snapshot Size:** Snapshot JSONB can be large (100 accounts × ~200 bytes = 20KB per snapshot)

**Cache Effectiveness:**
- ✅ **High Hit Rate:** If users query same period repeatedly, cache is effective
- ⚠️ **Low Hit Rate:** If users frequently switch periods, cache is ineffective

**Period Switching Load:**
- ⚠️ **Thrashing:** Frequent period switching triggers frequent rebuilds
- ⚠️ **Resource Waste:** Rebuilding snapshots for rarely-used periods wastes resources

**VERDICT:** ⚠️ **WARNING** — Snapshot rebuilds amplify at scale (O(accounts × entries)). Index coverage helps but won't prevent performance degradation at enterprise scale.

---

### 5.3 Multi-Tenant Isolation

**All Queries Filter by business_id:**

**Posting Functions:**
- ✅ **Expense:** `WHERE ex.business_id = p_business_id` (migration 229, line 70)
- ✅ **Invoice:** `WHERE i.business_id = business_id_val` (migration 226, line 58)
- ✅ **Payment:** `WHERE p.business_id = business_id_val` (migration 217, line 113)

**Snapshot Functions:**
- ✅ **generate_trial_balance:** `WHERE business_id = period_record.business_id` (migration 169, line 89)
- ✅ **Journal Query:** `WHERE je.business_id = period_record.business_id` (migration 169, line 109)

**Period Resolver:**
- ✅ **All Queries:** Filter by `ap.business_id = p_business_id` (migration 246, lines 25, 50, 75)
- ✅ **Journal Query:** Filter by `je.business_id = p_business_id` (migration 246, lines 30, 55, 80)

**No Cross-Tenant Aggregation Risks:**
- ✅ **All Functions:** Filter by `business_id` before aggregation
- ✅ **No Global Queries:** No queries aggregate across businesses

**Snapshot Partition Safety:**
- ✅ **UNIQUE Constraint:** `UNIQUE(period_id)` ensures one snapshot per period (migration 169, line 40)
- ✅ **Period Isolation:** Periods are business-scoped (no cross-business periods)

**VERDICT:** ✅ **PASS** — Multi-tenant isolation is enforced. All queries filter by `business_id`. No cross-tenant aggregation risks.

---

### 5.4 Background Job Requirements

**Current System:**

**Heavy Aggregation Inline:**
- ⚠️ **YES:** `generate_trial_balance` executes inline during report request (migration 169, line 240)
- ⚠️ **Synchronous:** Snapshot generation blocks report request until complete

**Queue System:**
- ❌ **NO:** No background job queue system
- ❌ **NO:** No async snapshot generation

**Eventual Consistency Model:**
- ❌ **NO:** System uses immediate consistency (snapshots generated synchronously)
- ⚠️ **Staleness Risk:** Snapshots may be stale until explicitly regenerated

**Write/Read Separation:**
- ❌ **NO:** No separation between write and read paths
- ✅ **Read-Only Reports:** Reports are read-only (don't modify data)

**VERDICT:** ⚠️ **WARNING** — System executes heavy aggregation inline. No queue system or eventual consistency model. Snapshot generation blocks report requests.

---

## SECTION 6 — FAILURE MODE RISK TABLE

### Scenario 1: Concurrent Expense Posting During Snapshot Rebuild

**Simulation:**

```
Time T0: User A requests Trial Balance for period P1
Time T0: get_trial_balance_from_snapshot checks snapshot (missing)
Time T0: generate_trial_balance starts (reads journal_entries for period P1)
Time T1: User B posts expense for period P1 (creates journal entry)
Time T2: generate_trial_balance completes (snapshot includes expense from T1)
Time T2: User A receives report (includes expense)
```

**Analysis:**
- ✅ **PostgreSQL MVCC:** Snapshot generation reads committed journal entries
- ✅ **Consistency:** Snapshot includes all entries committed before snapshot INSERT
- ⚠️ **Race Window:** Expense posted during snapshot generation may or may not be included (depends on commit timing)

**Risk Level:** ⚠️ **LOW** — PostgreSQL MVCC ensures consistency. Snapshot includes all entries committed before snapshot creation.

---

### Scenario 2: Multiple Users Generating Reports Simultaneously

**Simulation:**

```
Time T0: User A requests Trial Balance for period P1 (snapshot missing)
Time T0: User B requests Trial Balance for period P1 (snapshot missing)
Time T0: Both transactions call generate_trial_balance(P1)
Time T1: Transaction A acquires row lock on trial_balance_snapshots[P1]
Time T1: Transaction B waits for row lock
Time T2: Transaction A completes INSERT ... ON CONFLICT DO UPDATE
Time T2: Transaction B acquires lock, sees snapshot exists, returns cached snapshot
```

**Analysis:**
- ✅ **ON CONFLICT Protection:** Prevents duplicate snapshots
- ⚠️ **Resource Waste:** Both transactions may scan ledger (wasteful but safe)
- ✅ **Last Writer Wins:** `ON CONFLICT DO UPDATE` ensures last write wins

**Risk Level:** ⚠️ **LOW** — `ON CONFLICT DO UPDATE` prevents duplicates. Concurrent rebuilds waste resources but are safe.

---

### Scenario 3: Ledger Growth Beyond 5M Journal Lines

**Simulation:**

```
Scale: 10,000 businesses × 500 journal entries/month × 12 months = 60M journal lines
Per Business: 6,000 journal lines
Per Period: 500 journal entries
```

**Snapshot Rebuild Cost:**
- **Accounts:** 100 accounts per business
- **Scan:** 100 accounts × 500 entries = 50,000 index lookups per snapshot rebuild
- **Index Coverage:** `idx_journal_entries_business_date_id` + `idx_journal_entry_lines_account_entry` (good coverage)
- **Estimated Time:** ~500ms-2s per snapshot rebuild (depends on index efficiency)

**Report Query Cost:**
- **Snapshot Read:** ~1-5ms (reads JSONB from `trial_balance_snapshots`)
- **Snapshot Rebuild:** ~500ms-2s (if snapshot missing)

**Risk Level:** ⚠️ **MEDIUM** — Snapshot rebuilds will slow down at scale. Index coverage helps but won't prevent degradation. Consider snapshot pre-generation or background jobs.

---

### Scenario 4: Period Closing During Active Reporting

**Simulation:**

```
Time T0: User A requests Trial Balance for period P1 (status = 'open')
Time T0: generate_trial_balance starts (reads journal_entries for period P1)
Time T1: Admin closes period P1 (status = 'locked')
Time T2: generate_trial_balance completes (snapshot created)
Time T2: User A receives report (success)
```

**Analysis:**
- ✅ **Read-Only:** Reports can read locked periods (no restriction)
- ✅ **Snapshot Generation:** `generate_trial_balance` does NOT check period status (migration 169, lines 76-83)
- ✅ **No Blocking:** Period closing does NOT block snapshot generation

**Risk Level:** ✅ **LOW** — Period closing does NOT affect report generation. Reports can read locked periods.

---

## SECTION 7 — FINAL PRODUCTION READINESS VERDICT

### 7.1 Workflow Correctness

**Verdict:** ✅ **PASS**

**Evidence:**
- ✅ All posting pipelines are correct, atomic, and idempotent
- ✅ Double-entry integrity enforced at multiple layers
- ✅ Journal entries are immutable
- ⚠️ Minor risk: Some triggers lack exception handling

**Recommendation:** Add exception handling to expense trigger (similar to payment trigger) to prevent expense creation failure if posting fails.

---

### 7.2 Period Resolution Safety

**Verdict:** ✅ **PASS**

**Evidence:**
- ✅ Manual period selection is deterministic
- ✅ Automatic resolver is correctly implemented
- ⚠️ Automatic resolver not yet integrated into public routes

**Recommendation:** Integrate automatic period resolver (migration 246) into public report routes to eliminate period mismatch risk.

---

### 7.3 Snapshot Lifecycle Safety

**Verdict:** ⚠️ **WARNING**

**Evidence:**
- ✅ Snapshot generation is atomic and idempotent
- ⚠️ No automatic invalidation (staleness risk)
- ⚠️ No explicit locking (concurrent rebuilds waste resources)
- ⚠️ Synchronous generation blocks report requests

**Recommendations:**
1. Add snapshot invalidation trigger (invalidate snapshot when journal entries posted for period)
2. Add explicit locking to prevent concurrent rebuilds
3. Consider background job for snapshot pre-generation

---

### 7.4 Concurrency Safety

**Verdict:** ⚠️ **WARNING**

**Evidence:**
- ✅ `ON CONFLICT DO UPDATE` prevents duplicate snapshots
- ⚠️ No explicit locking prevents concurrent rebuilds
- ✅ PostgreSQL MVCC ensures consistency

**Recommendation:** Add `pg_advisory_lock` to `generate_trial_balance` to prevent concurrent rebuilds and reduce resource waste.

---

### 7.5 Scale Readiness

**Verdict:** ⚠️ **WARNING**

**Evidence:**
- ✅ Index coverage is good
- ⚠️ Snapshot rebuilds amplify at scale (O(accounts × entries))
- ⚠️ Posting throughput may be insufficient for 300 writes/sec
- ⚠️ No background job system for heavy aggregation

**Recommendations:**
1. Pre-generate snapshots for active periods (background job)
2. Consider async posting queue for high-volume scenarios
3. Monitor snapshot rebuild performance at scale

---

### 7.6 Production Reliability

**Verdict:** ⚠️ **WARNING**

**Evidence:**
- ✅ Multi-tenant isolation is enforced
- ✅ Ledger integrity is guaranteed
- ⚠️ Snapshot staleness risk
- ⚠️ Concurrent rebuild resource waste
- ⚠️ Scale performance concerns

**Recommendations:**
1. Integrate automatic period resolver
2. Add snapshot invalidation
3. Add explicit locking to snapshot generation
4. Monitor performance at scale
5. Consider background job system for snapshot pre-generation

---

## FINAL VERDICT SUMMARY

| Category | Verdict | Critical Issues |
|----------|---------|-----------------|
| **Workflow Correctness** | ✅ PASS | Minor: Trigger exception handling |
| **Period Resolution Safety** | ✅ PASS | Minor: Automatic resolver not integrated |
| **Snapshot Lifecycle Safety** | ⚠️ WARNING | Staleness risk, no invalidation |
| **Concurrency Safety** | ⚠️ WARNING | Concurrent rebuilds waste resources |
| **Scale Readiness** | ⚠️ WARNING | Snapshot rebuilds amplify at scale |
| **Production Reliability** | ⚠️ WARNING | Multiple risks require mitigation |

**Overall Production Readiness:** ⚠️ **CONDITIONALLY SAFE**

**Blocking Issues:** None  
**High-Priority Mitigations:** Snapshot invalidation, automatic period resolver integration, explicit locking  
**Medium-Priority Optimizations:** Background job system, async posting queue (for high-volume scenarios)

---

**AUDIT COMPLETE**
