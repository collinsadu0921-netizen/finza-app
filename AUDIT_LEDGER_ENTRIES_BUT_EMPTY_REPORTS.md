# AUDIT — Ledger Contains Entries But Trial Balance / P&L / Balance Sheet Are Empty

**Date:** 2026-02-01  
**Auditor:** Principal Accounting Systems Auditor  
**Mode:** Read-only evidence collection  
**Objective:** Explain why ledger shows journal entries and VAT report shows values, but Trial Balance, Profit & Loss, and Balance Sheet return empty.

---

## EXECUTIVE SUMMARY

**ROOT CAUSE:** Period resolution mismatch between posting and reporting.

- **Posting:** Uses `posting_date` from invoice (`sent_at` or `issue_date`) to resolve period via `assert_accounting_period_is_open`
- **Reporting:** Uses `asOfDate` (defaults to current date) to resolve period
- **Trial Balance Generation:** Filters journal entries by `je.date >= period_start AND je.date <= period_end`
- **Result:** If `posting_date` falls in a different month than `asOfDate`, journal entries are excluded from the snapshot for the resolved period

**VAT Report Works Because:** It reads directly from `journal_entry_lines` using explicit date range (`start_date` to `end_date`), bypassing period boundaries.

---

## PART 1 — Posting Verification

### 1.1 Invoice Posting Pipeline

**Evidence:** `app/api/invoices/[id]/send/route.ts`

**Execution Chain:**
1. Route handler calls `ensureAccountingInitialized` (line 197, 249, 330)
2. Route calls `performSendTransition` (lines 204, 256, 337)
3. `performSendTransition` updates `invoices` SET `status = 'sent'`, `sent_at = NOW()` (lines 16-18)
4. Database trigger `trigger_auto_post_invoice` fires (migration 043, line 949)
5. Trigger calls `post_invoice_to_ledger(p_invoice_id)` (migration 043, line 941)

**Evidence:** `supabase/migrations/043_accounting_core.sql` (lines 948-952)
```sql
CREATE TRIGGER trigger_auto_post_invoice
  AFTER INSERT OR UPDATE OF status ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION trigger_post_invoice();
```

**Trigger Function:** `trigger_post_invoice()` (migration 043, lines 929-945)
- Checks if `NEW.status IN ('sent', 'paid', 'partially_paid')` AND `OLD.status = 'draft'`
- Calls `PERFORM post_invoice_to_ledger(NEW.id)` if not already posted

### 1.2 Posting Date Assignment

**Evidence:** `supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql` (lines 74-81)

**Posting Date Resolution:**
```sql
-- Posting date: sent_at when issued, else issue_date. Block if both null.
posting_date := COALESCE(
  (invoice_record.sent_at AT TIME ZONE 'UTC')::DATE,
  invoice_record.issue_date
);
IF posting_date IS NULL THEN
  RAISE EXCEPTION 'Invoice has no issue_date or sent_at. Cannot post to ledger. Invoice id: %', p_invoice_id;
END IF;
```

**Verdict:** ✅ **Journal entries are created**  
**Verdict:** ✅ **posting_date is written correctly** (uses `sent_at` or `issue_date`)  
**Verdict:** ✅ **posting_date source:** `sent_at` (when invoice is sent) or `issue_date` (fallback), NOT `NOW()`

**Evidence:** `supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql` (line 198)
- `post_journal_entry` is called with `posting_date` (not `CURRENT_DATE`)

---

## PART 2 — Period Resolution Path

### 2.1 Trial Balance Report Period Resolution

**Evidence:** `app/api/reports/trial-balance/route.ts` (lines 28-68)

**Period Resolution:**
```typescript
const asOfDate = searchParams.get("as_of_date") || new Date().toISOString().split("T")[0]

let { data: period, error: periodError } = await supabase
  .from("accounting_periods")
  .select("id, period_start, period_end")
  .eq("business_id", business.id)
  .lte("period_start", asOfDate)  // Period start <= asOfDate
  .gte("period_end", asOfDate)   // Period end >= asOfDate
  .maybeSingle()
```

**If Period Not Found:**
- Calls `ensure_accounting_period(p_business_id, asOfDate)` (line 43)
- `ensure_accounting_period` creates period for month containing `asOfDate` (migration 094, lines 70-71)

**Verdict:** ⚠️ **Period resolved using `asOfDate` (defaults to current date), NOT posting_date**

### 2.2 Profit & Loss Report Period Resolution

**Evidence:** `app/api/reports/profit-loss/route.ts` (lines 28-74)

**Period Resolution:**
```typescript
const startDate = searchParams.get("start_date")
const endDate = searchParams.get("end_date")

let { data: period, error: periodError } = await supabase
  .from("accounting_periods")
  .select("id, period_start, period_end")
  .eq("business_id", business.id)
  .lte("period_start", startDate)  // Period start <= startDate
  .gte("period_end", endDate)      // Period end >= endDate
  .maybeSingle()
```

**Verdict:** ⚠️ **Period resolved using `startDate`/`endDate` query params, NOT posting_date**

### 2.3 Balance Sheet Report Period Resolution

**Evidence:** `app/api/reports/balance-sheet/route.ts` (lines 28-68)

**Period Resolution:**
```typescript
const asOfDate = searchParams.get("as_of_date") || new Date().toISOString().split("T")[0]

let { data: period, error: periodError } = await supabase
  .from("accounting_periods")
  .select("id, period_start, period_end")
  .eq("business_id", business.id)
  .lte("period_start", asOfDate)  // Period start <= asOfDate
  .gte("period_end", asOfDate)    // Period end >= asOfDate
  .maybeSingle()
```

**Verdict:** ⚠️ **Period resolved using `asOfDate` (defaults to current date), NOT posting_date**

### 2.4 RPC Called to Resolve Period

**Evidence:** `app/api/reports/trial-balance/route.ts` (line 43)
- Calls `supabase.rpc("ensure_accounting_period", { p_business_id, p_date: asOfDate })`

**Evidence:** `supabase/migrations/094_accounting_periods.sql` (lines 59-92)
- `ensure_accounting_period(p_business_id, p_date)` resolves period for month containing `p_date`
- Creates period if it doesn't exist

**Verdict:** ✅ **RPC is `ensure_accounting_period`**  
**Verdict:** ⚠️ **Period resolved using report date (`asOfDate`/`startDate`), NOT posting_date**

---

## PART 3 — Trial Balance Data Source

### 3.1 Complete Chain: UI → API → RPC → Snapshot → Ledger

**Evidence:** `app/api/reports/trial-balance/route.ts` (line 71)

**Chain:**
1. **UI:** Requests Trial Balance with `as_of_date` param (defaults to current date)
2. **API:** Resolves period using `as_of_date` (lines 34-40)
3. **API:** Calls `get_trial_balance_from_snapshot(p_period_id)` (line 71)
4. **RPC:** `get_trial_balance_from_snapshot` checks for snapshot (migration 169, line 234)
5. **If snapshot missing:** Calls `generate_trial_balance(p_period_id, NULL)` (migration 169, line 240)
6. **Snapshot Generation:** `generate_trial_balance` reads from `journal_entry_lines` filtered by period boundaries (migration 169, lines 106-111)
7. **Snapshot Storage:** Inserts into `trial_balance_snapshots` (migration 169, lines 170-193)
8. **Return:** Reads from `snapshot_data` JSONB (migration 169, lines 248-259)

### 3.2 Does generate_trial_balance Read journal_entry_lines?

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 101-111)

**YES:**
```sql
-- Calculate period activity from ledger (ledger-only source)
SELECT 
  COALESCE(SUM(jel.debit), 0),
  COALESCE(SUM(jel.credit), 0)
INTO period_debit, period_credit
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE jel.account_id = account_record.id
  AND je.business_id = period_record.business_id
  AND je.date >= period_record.period_start
  AND je.date <= period_record.period_end;
```

**Verdict:** ✅ **YES — Reads from `journal_entry_lines`**

### 3.3 Does it Filter by accounting_periods?

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 76-83, 110-111)

**YES:**
- Function receives `p_period_id UUID` (line 56)
- Resolves `period_record` from `accounting_periods` WHERE `id = p_period_id` (lines 77-79)
- Filters journal entries by `je.date >= period_record.period_start AND je.date <= period_record.period_end` (lines 110-111)

**Verdict:** ✅ **YES — Filters by period boundaries (`period_start` to `period_end`)**

### 3.4 Does it Require Snapshot Rows to Exist?

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 233-245)

**NO:**
```sql
-- Get snapshot
SELECT * INTO snapshot_record
FROM trial_balance_snapshots
WHERE period_id = p_period_id;

-- If snapshot doesn't exist, generate it first
IF NOT FOUND THEN
  PERFORM generate_trial_balance(p_period_id, NULL);
  
  SELECT * INTO snapshot_record
  FROM trial_balance_snapshots
  WHERE period_id = p_period_id;
END IF;
```

**Verdict:** ✅ **NO — Snapshot is auto-generated if missing**

### 3.5 Does Snapshot Generation Occur Automatically?

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 238-240)

**YES:**
- `get_trial_balance_from_snapshot` checks for snapshot
- If `NOT FOUND`, calls `PERFORM generate_trial_balance(p_period_id, NULL)`
- Snapshot is generated on-demand when report is requested

**Verdict:** ✅ **YES — Snapshot generation occurs automatically on report request**

### 3.6 Conditions That Cause Snapshot Generation to Be Skipped

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 233-236)

**Snapshot generation is skipped if:**
- Snapshot already exists for `period_id`
- No explicit skip conditions — generation always occurs if snapshot missing

**Verdict:** ✅ **No skip conditions — snapshot always generated if missing**

---

## PART 4 — Snapshot Creation Triggers

### 4.1 Search Results: generate_trial_balance, trial_balance_snapshots INSERT, Snapshot Refresh Jobs

**Evidence:** Grep results show:
- `generate_trial_balance` is called from `get_trial_balance_from_snapshot` (migration 169, line 240)
- `generate_trial_balance` inserts into `trial_balance_snapshots` (migration 169, lines 170-193)
- No triggers on `journal_entries` that call `generate_trial_balance`
- No scheduled jobs found

**Verdict:** ✅ **Snapshots are NOT created on posting**  
**Verdict:** ✅ **Snapshots are created on report request** (via `get_trial_balance_from_snapshot`)  
**Verdict:** ✅ **Snapshots are NOT created manually only** (auto-generated on demand)  
**Verdict:** ✅ **Snapshots are NOT dependent on period locking** (generated regardless of period status)

---

## PART 5 — Period Alignment Audit

### 5.1 How posting_date is Compared Against accounting_periods.period_start / period_end

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 110-111)

**Comparison:**
```sql
WHERE jel.account_id = account_record.id
  AND je.business_id = period_record.business_id
  AND je.date >= period_record.period_start
  AND je.date <= period_record.period_end;
```

**Verdict:** ✅ **Journal entries filtered by `je.date` (posting_date) against `period_start` and `period_end`**

### 5.2 Whether Timezone Conversions Exist

**Evidence:** `supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql` (line 76)

**Timezone Conversion:**
```sql
posting_date := COALESCE(
  (invoice_record.sent_at AT TIME ZONE 'UTC')::DATE,
  invoice_record.issue_date
);
```

**Verdict:** ✅ **Timezone conversion exists:** `sent_at AT TIME ZONE 'UTC'::DATE` converts UTC timestamp to DATE

### 5.3 Whether Report Queries Filter by Exact Period Boundaries

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 110-111)

**Filter:**
```sql
AND je.date >= period_record.period_start
AND je.date <= period_record.period_end;
```

**Verdict:** ✅ **YES — Reports filter by exact period boundaries**

### 5.4 Exact WHERE Clauses Used in Reporting RPCs

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 106-111)

**WHERE Clause:**
```sql
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE jel.account_id = account_record.id
  AND je.business_id = period_record.business_id
  AND je.date >= period_record.period_start
  AND je.date <= period_record.period_end;
```

**Verdict:** ✅ **Exact boundaries:** `je.date >= period_start AND je.date <= period_end`

---

## PART 6 — Reporting RPC Filters

### 6.1 get_profit_and_loss_from_trial_balance

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 270-301)

**Filters:**
- Calls `get_trial_balance_from_snapshot(p_period_id)` (line 286)
- Filters by `account_type IN ('income', 'expense')` (line 287)

**Verdict:** ✅ **Required joins:** None (reads from snapshot)  
**Verdict:** ✅ **Required filters:** `account_type IN ('income', 'expense')`  
**Verdict:** ✅ **Account type filters:** YES — income/expense only  
**Verdict:** ⚠️ **Zero-balance accounts:** NOT suppressed (all accounts returned)

### 6.2 get_balance_sheet_from_trial_balance

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 308-338)

**Filters:**
- Calls `get_trial_balance_from_snapshot(p_period_id)` (line 325)
- Filters by `account_type IN ('asset', 'liability', 'equity')` (line 326)

**Verdict:** ✅ **Required joins:** None (reads from snapshot)  
**Verdict:** ✅ **Required filters:** `account_type IN ('asset', 'liability', 'equity')`  
**Verdict:** ✅ **Account type filters:** YES — asset/liability/equity only  
**Verdict:** ⚠️ **Zero-balance accounts:** NOT suppressed (all accounts returned)

### 6.3 get_trial_balance_from_snapshot

**Evidence:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 216-261)

**Filters:**
- Reads from `trial_balance_snapshots` WHERE `period_id = p_period_id` (line 235)
- Returns all accounts from `snapshot_data` JSONB (lines 248-259)

**Verdict:** ✅ **Required joins:** None (reads from snapshot)  
**Verdict:** ✅ **Required filters:** `period_id = p_period_id`  
**Verdict:** ❌ **Account type filters:** NO — returns all account types  
**Verdict:** ⚠️ **Zero-balance accounts:** NOT suppressed (all accounts returned)

---

## PART 7 — VAT Report Comparison

### 7.1 Does VAT Read Directly from journal_entry_lines?

**Evidence:** `app/api/reports/vat-control/route.ts` (lines 113-127, 146-161)

**YES:**
```typescript
const { data: openingLines, error: openingError } = await supabase
  .from("journal_entry_lines")
  .select(/* ... */)
  .eq("account_id", vatAccount.id)
  .eq("journal_entries.business_id", business.id)
  .lt("journal_entries.date", startDate)

const { data: periodLines, error: periodError } = await supabase
  .from("journal_entry_lines")
  .select(/* ... */)
  .eq("account_id", vatAccount.id)
  .eq("journal_entries.business_id", business.id)
  .gte("journal_entries.date", startDate)
  .lte("journal_entries.date", endDate)
```

**Verdict:** ✅ **YES — VAT reads directly from `journal_entry_lines`**

### 7.2 Does VAT Bypass Snapshot System?

**Evidence:** `app/api/reports/vat-control/route.ts`

**YES:**
- No calls to `get_trial_balance_from_snapshot`
- No calls to `generate_trial_balance`
- Direct queries to `journal_entry_lines` table

**Verdict:** ✅ **YES — VAT bypasses snapshot system**

### 7.3 Does VAT Ignore accounting_periods?

**Evidence:** `app/api/reports/vat-control/route.ts` (lines 160-161)

**YES:**
- Filters by `journal_entries.date >= startDate AND journal_entries.date <= endDate`
- No reference to `accounting_periods` table
- Uses explicit date range from query params

**Verdict:** ✅ **YES — VAT ignores `accounting_periods`** (uses explicit date range)

**Critical Finding:** VAT report works because it uses explicit date range (`start_date` to `end_date`), not period boundaries. If invoice was posted with `posting_date` within the VAT report's date range, it will appear in VAT report even if it falls outside the period used by Trial Balance/P&L/Balance Sheet.

---

## PART 8 — Bootstrap Interaction

### 8.1 Does ensure_accounting_initialized Affect Snapshot Availability?

**Evidence:** `supabase/migrations/245_phase13_repairable_bootstrap.sql`

**Bootstrap creates:**
- `accounts` (via `create_system_accounts`)
- `chart_of_accounts` (via `initialize_business_chart_of_accounts`)
- `chart_of_accounts_control_map` (via `initialize_business_chart_of_accounts`)
- `accounting_periods` (via `initialize_business_accounting_period`)

**Snapshot generation requires:**
- `accounting_periods` row (for `period_id`)
- `accounts` rows (to iterate over)
- `journal_entry_lines` (to calculate balances)

**Verdict:** ✅ **YES — Bootstrap creates `accounting_periods`, which is required for snapshot generation**

### 8.2 Period Creation Timing

**Evidence:** `supabase/migrations/245_phase13_repairable_bootstrap.sql` (lines 45-59)

**Period Creation:**
- Only creates period if `NOT v_period_exists` (line 51)
- Uses `business.start_date` or current month start (lines 53-56)

**Verdict:** ✅ **Period created during bootstrap if none exists**

### 8.3 Control Mapping Timing

**Evidence:** `supabase/migrations/245_phase13_repairable_bootstrap.sql` (line 43)

**Control Mapping:**
- Always created via `initialize_business_chart_of_accounts` (unconditional)

**Verdict:** ✅ **Control mappings created during bootstrap**

### 8.4 Whether Reporting Depends on Bootstrap Completing BEFORE Posting

**Evidence:** `app/api/invoices/[id]/send/route.ts` (lines 197, 249, 330)

**Bootstrap Order:**
1. Route calls `ensureAccountingInitialized` BEFORE `performSendTransition` (line 197)
2. `performSendTransition` triggers `post_invoice_to_ledger`
3. Posting requires period to exist (via `assert_accounting_period_is_open`)

**Verdict:** ✅ **YES — Bootstrap must complete before posting** (bootstrap called before transition)

**However:** Bootstrap creates period for current month (or `business.start_date`), not necessarily the period matching `posting_date`. If invoice has `issue_date` in a different month, posting will create that period (via `assert_accounting_period_is_open` → `ensure_accounting_period`), but reports using `asOfDate = current date` will resolve a different period.

---

## PART 9 — Failure Table

| Failure Layer | Condition | Evidence File + Line |
|---------------|-----------|----------------------|
| **Period Resolution Mismatch** | Reports resolve period using `asOfDate` (defaults to current date), but posting uses `posting_date` (from invoice `sent_at` or `issue_date`). If these dates fall in different months, journal entries are excluded from the resolved period's snapshot. | `app/api/reports/trial-balance/route.ts:28` (asOfDate defaults to current date)<br>`supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql:75-78` (posting_date from invoice) |
| **Date Range Filtering** | `generate_trial_balance` filters journal entries by `je.date >= period_start AND je.date <= period_end`. If `posting_date` falls outside the resolved period's boundaries, entries are excluded. | `supabase/migrations/169_trial_balance_canonicalization.sql:110-111` (period boundary filter) |
| **Snapshot Generation Timing** | Snapshots are generated on-demand when reports are requested, using the period resolved from `asOfDate`. If journal entries were posted to a different period, they won't be included in the snapshot. | `supabase/migrations/169_trial_balance_canonicalization.sql:238-240` (snapshot generation on report request) |
| **Period Creation During Posting** | `assert_accounting_period_is_open` calls `ensure_accounting_period`, which creates a period for the month containing `posting_date`. This period may differ from the period resolved by reports using `asOfDate`. | `supabase/migrations/094_accounting_periods.sql:59-92` (ensure_accounting_period creates period for posting_date month) |
| **VAT Report Bypass** | VAT report works because it uses explicit date range (`start_date` to `end_date`) instead of period boundaries. This allows it to include entries regardless of period alignment. | `app/api/reports/vat-control/route.ts:160-161` (explicit date range filter) |
| **Account Type Filtering** | P&L and Balance Sheet filter by account type (`income`/`expense` vs `asset`/`liability`/`equity`), but if snapshot is empty (due to period mismatch), no accounts are returned regardless of type. | `supabase/migrations/169_trial_balance_canonicalization.sql:287` (P&L filter), `326` (BS filter) |
| **Zero-Balance Suppression** | Reports do NOT suppress zero-balance accounts, but if snapshot is empty, no accounts are returned. Empty snapshot is the root cause, not zero-balance suppression. | `supabase/migrations/169_trial_balance_canonicalization.sql:248-259` (returns all accounts from snapshot) |

---

## ROOT CAUSE SUMMARY

**Primary Failure:** Period resolution mismatch between posting and reporting.

1. **Posting:** Invoice posted with `posting_date = sent_at` (or `issue_date`). Period resolved for month containing `posting_date` via `assert_accounting_period_is_open` → `ensure_accounting_period`.

2. **Reporting:** Reports resolve period using `asOfDate` (defaults to current date). If `asOfDate` is in a different month than `posting_date`, a different period is resolved.

3. **Snapshot Generation:** `generate_trial_balance` filters journal entries by `je.date >= period_start AND je.date <= period_end`. If `posting_date` falls outside the resolved period's boundaries, entries are excluded.

4. **Result:** Snapshot is generated for the wrong period (month containing `asOfDate`), which doesn't include journal entries posted to a different period (month containing `posting_date`).

**VAT Report Works Because:** It bypasses period boundaries and uses explicit date range (`start_date` to `end_date`), allowing it to include entries regardless of period alignment.

---

**AUDIT COMPLETE**
