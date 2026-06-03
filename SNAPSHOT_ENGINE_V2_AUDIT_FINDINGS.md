# 🔍 SNAPSHOT ENGINE V2 — AUDIT FINDINGS

**Date:** 2026-02-01  
**Purpose:** Pre-implementation audit for Snapshot Engine v2 (stale-aware, lock-safe, non-blocking)  
**Mode:** READ-ONLY AUDIT

> **Source contract (2026-06):** Live P&L and Balance Sheet no longer consume Trial Balance snapshots. Trial Balance remains snapshot-based. See [docs/REPORTING_SOURCE_CONTRACT.md](docs/REPORTING_SOURCE_CONTRACT.md). Route tables below reflect the 2026-02 audit; live app paths are updated in the contract doc.

---

## TASK A — SNAPSHOT READ ENTRY POINTS

### Direct Snapshot Read Functions

| Function | File | Lines | Purpose | Calls Snapshot? |
|----------|------|-------|---------|-----------------|
| `get_trial_balance_from_snapshot` | `supabase/migrations/169_trial_balance_canonicalization.sql` | 216-263 | Returns trial balance from snapshot; generates if missing | ✅ Reads `trial_balance_snapshots` (line 234-236) |
| `get_profit_and_loss_from_trial_balance` | `supabase/migrations/169_trial_balance_canonicalization.sql` | 270-301 | Returns P&L filtered from trial balance | ✅ Calls `get_trial_balance_from_snapshot` (line 286) |
| `get_balance_sheet_from_trial_balance` | `supabase/migrations/169_trial_balance_canonicalization.sql` | 308-338 | Returns Balance Sheet filtered from trial balance | ✅ Calls `get_trial_balance_from_snapshot` (line 325) |
| `generate_trial_balance` | `supabase/migrations/169_trial_balance_canonicalization.sql` | 56-207 | Generates snapshot from ledger | ✅ Writes to `trial_balance_snapshots` (lines 170-203) |

### API Routes Calling Snapshot Functions

| Route | File | Line | RPC Called | Snapshot Dependency |
|-------|------|------|------------|---------------------|
| Trial Balance (Accounting) | `app/api/accounting/reports/trial-balance/route.ts` | 101 | `get_trial_balance_from_snapshot` | ✅ Direct |
| Trial Balance (Public) | `app/api/reports/trial-balance/route.ts` | 108 | `get_trial_balance_from_snapshot` | ✅ Direct |
| Trial Balance (Legacy) | `app/api/accounting/trial-balance/route.ts` | 116 | `get_trial_balance_from_snapshot` | ✅ Direct |
| P&L (Accounting) | `app/api/accounting/reports/profit-and-loss/route.ts` | 97 | `getProfitAndLossReport` → `get_profit_and_loss_movement` | ❌ Ledger movement (not snapshot) |
| P&L (Public) | `app/api/reports/profit-loss/route.ts` | 77 | Same | ❌ Ledger movement |
| Balance Sheet (Accounting) | `app/api/accounting/reports/balance-sheet/route.ts` | 95 | `getBalanceSheetReport` → ledger as-of | ❌ Cumulative as-of (not snapshot) |
| Balance Sheet (Public) | `app/api/reports/balance-sheet/route.ts` | 110 | Same | ❌ Cumulative as-of |
| Trial Balance CSV Export | `app/api/accounting/reports/trial-balance/export/csv/route.ts` | 100 | `get_trial_balance_from_snapshot` | ✅ Direct |

### Confirmation: Live P&L and Balance Sheet vs snapshot (2026-06)

**Trial Balance** routes still depend solely on `get_trial_balance_from_snapshot`.

**Live P&L and Balance Sheet** (application layer) use journal movement and cumulative ledger as-of respectively — not TB `closing_balance`. Legacy DB functions `get_profit_and_loss_from_trial_balance` and `get_balance_sheet_from_trial_balance` remain in migrations for historical/audit reference.

---

## TASK B — SNAPSHOT SCHEMA

### Current Table Schema

**Table:** `trial_balance_snapshots`  
**Migration:** `supabase/migrations/169_trial_balance_canonicalization.sql` (lines 19-41)

**Columns:**

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique row identifier |
| `period_id` | UUID | NOT NULL, REFERENCES accounting_periods(id) ON DELETE CASCADE | Period reference (UNIQUE constraint) |
| `business_id` | UUID | NOT NULL, REFERENCES businesses(id) ON DELETE CASCADE | Business isolation |
| `generated_at` | TIMESTAMPTZ | DEFAULT NOW() | Snapshot generation timestamp |
| `generated_by` | UUID | REFERENCES auth.users(id) | User who triggered generation (nullable) |
| `total_debits` | NUMERIC | NOT NULL, DEFAULT 0 | Aggregated debit total (validation) |
| `total_credits` | NUMERIC | NOT NULL, DEFAULT 0 | Aggregated credit total (validation) |
| `account_count` | INTEGER | NOT NULL, DEFAULT 0 | Number of accounts in snapshot |
| `is_balanced` | BOOLEAN | NOT NULL, DEFAULT FALSE | Balance validation flag |
| `balance_difference` | NUMERIC | NOT NULL, DEFAULT 0 | Difference if unbalanced (should be 0) |
| `snapshot_data` | JSONB | NOT NULL, DEFAULT '[]'::jsonb | Account balances array |

**Unique Constraints:**
- `UNIQUE(period_id)` — One snapshot per period (line 40)

**Indexes:**
- `idx_trial_balance_snapshots_period_id` ON `period_id` (line 43)
- `idx_trial_balance_snapshots_business_id` ON `business_id` (line 44)
- `idx_trial_balance_snapshots_generated_at` ON `generated_at` (line 45)

**Snapshot Creation/Update:**
- **Created:** `generate_trial_balance` INSERTs into `trial_balance_snapshots` (migration 169, lines 170-193)
- **Updated:** `ON CONFLICT (period_id) DO UPDATE` in `generate_trial_balance` (migration 169, lines 194-203)

---

## TASK C — JOURNAL ENTRIES WRITE SOURCES

### Posting Triggers and Date Sources

| Source | Trigger | Function | Posting Date Source | Evidence |
|--------|---------|----------|---------------------|----------|
| **Expenses** | `trigger_auto_post_expense` | `post_expense_to_ledger` | `expense.date` | Migration 229, line 201 |
| **Invoices** | `trigger_auto_post_invoice` | `post_invoice_to_ledger` | `COALESCE(sent_at, issue_date)` | Migration 226, lines 75-78 |
| **Payments** | `trigger_auto_post_payment` | `post_payment_to_ledger` | `payment.date` | Migration 217, line 168 |
| **Credit Notes** | `trigger_auto_post_credit_note` | `post_credit_note_to_ledger` | `credit_note.date` | Migration 043, line 1005 |
| **Bills** | `trigger_auto_post_bill` | `post_bill_to_ledger` | `bill.date` | Migration 043, line 1039 |
| **Bill Payments** | `trigger_auto_post_bill_payment` | `post_bill_payment_to_ledger` | `bill_payment.date` | Migration 043, line 1073 |

**Trigger Locations:**
- `trigger_auto_post_expense`: `supabase/migrations/043_accounting_core.sql` (lines 1106-1110)
- `trigger_auto_post_invoice`: `supabase/migrations/043_accounting_core.sql` (lines 948-952)
- `trigger_auto_post_payment`: `supabase/migrations/043_accounting_core.sql` (lines 972-976)

### Confirmation: Ledger Contains Missing Data (Snapshot Staleness)

✅ **CONFIRMED** — The audit confirms that:

1. **Posting is Correct:** All triggers fire correctly and create journal entries with proper dates (evidence: migrations 229, 226, 217)

2. **Snapshot Staleness is the Issue:** 
   - Snapshots are generated lazily (only when report is requested)
   - No invalidation triggers exist on `journal_entries` INSERT
   - Reports may return stale snapshots that don't include recent journal entries

3. **Evidence of Staleness:**
   - `get_trial_balance_from_snapshot` checks for snapshot existence (migration 169, line 234-236)
   - If snapshot exists, it returns cached data WITHOUT checking if ledger has changed (migration 169, lines 247-259)
   - `generate_trial_balance` is only called if snapshot is missing (migration 169, line 240)

**Conclusion:** The "expense/payment/invoice not reflecting in reports" issue is **snapshot staleness**, NOT posting failure. Ledger contains the data; snapshots are stale.

---

## AUDIT COMPLETE

**Ready for Implementation:** ✅  
**All entry points identified:** ✅  
**Schema confirmed:** ✅  
**Root cause confirmed:** ✅ (Snapshot staleness, not posting failure)
