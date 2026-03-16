# FINZA Immutable Accounting Contract v1.0

**Role:** Principal Accounting Systems Architect  
**Scope:** Ledger, posting, periods, snapshots, statements (P&L/BS/TB), VAT, AR/AP, cash.  
**Status:** Authoritative spec + repo-backed audit + gap list + implementation plan. No code changes in this deliverable.

---

## 1) CONTRACT v1.0 (Authoritative Spec)

### A. Ledger as single source of truth

- All monetary position and movement SHALL be derivable from `journal_entries` + `journal_entry_lines` + `accounts` (and `period_opening_balances` for opening balances). No report SHALL read operational tables (invoices, payments, expenses, bills, sales) for amounts used in financial statements.
- Posting SHALL be append-only: no UPDATE or DELETE on `journal_entries` or `journal_entry_lines` from application or triggers (except governance-approved backfill/repair paths with audit).
- Every journal entry SHALL have `business_id`, `date`, `reference_type`, and balanced lines (SUM(debit) = SUM(credit)).

### B. Posting date contract (per event type)

- **Invoice (revenue recognition):** Posting date SHALL be `COALESCE(sent_at::date, issue_date)`. Draft invoices SHALL NOT post to the ledger.
- **Payment (invoice):** Posting date SHALL be the payment’s `date` (payment record date).
- **Expense:** Posting date SHALL be the expense’s `date`.
- **Sale (POS/retail):** Posting date SHALL be the sale’s `created_at::date` (or equivalent transaction date).
- **Refund / void:** Posting date SHALL be the processing date (e.g. `CURRENT_DATE` at posting time), not the original sale date.
- **Bills / supplier payments / credit notes / adjustments:** SHALL be defined in the same way (one canonical rule per event type, documented in migrations).

### C. Period assignment contract

- Every `journal_entries` row SHALL have a non-null `period_id` referencing `accounting_periods(id)` for the period that contains the entry’s `date`.
- Period SHALL be derived at posting time from `accounting_periods` where `period_start <= date <= period_end` for the business; if no such period exists, posting SHALL fail (no auto-creation of periods in the write path).
- Open/lock: Posting SHALL be blocked for dates that fall in a period with status `locked` (or equivalent); `assert_accounting_period_is_open(business_id, date)` SHALL be invoked before inserting journal entries.

### D. System accounts & CoA uniqueness

- Uniqueness SHALL be enforced per business for active accounts: at most one row per `(business_id, code)` with `deleted_at IS NULL`.
- Enforcement SHALL be by a unique constraint or unique index on `accounts` that supports that predicate (e.g. partial unique index on `(business_id, code) WHERE deleted_at IS NULL`).
- `create_system_accounts(business_id)` SHALL be idempotent and SHALL NOT depend on `ON CONFLICT (business_id, code)` unless the target constraint/index exists at run time; it MAY use `WHERE NOT EXISTS` or equivalent to avoid reliance on conflict targets.
- Soft delete: Accounts SHALL be soft-deleted (`deleted_at` set); ledger lines SHALL continue to reference the account; no hard delete of accounts that are referenced by `journal_entry_lines` or `period_opening_balances`.

### E. Journal entry balance and numeric precision

- For every journal entry, `SUM(jel.debit) = SUM(jel.credit)` SHALL hold at insert time (enforced in `post_journal_entry` with a tolerance of 0.01 or stricter).
- Monetary columns (`journal_entry_lines.debit`, `journal_entry_lines.credit`, and all statement/snapshot amounts) SHALL use `NUMERIC` (or equivalent fixed-precision type); floating point SHALL NOT be used for money.
- A single, documented rounding policy SHALL apply (e.g. round to 2 decimal places at line level or at snapshot level); tiny residuals (e.g. 0.00000000000001) from floating or inconsistent rounding SHALL be eliminated (e.g. by rounding before persist or by a single canonical rounding step).

### F. Snapshot contract (trial_balance_snapshots)

- **Build inputs:** Snapshots SHALL be built only from ledger data: `period_opening_balances` for opening balance per account, and `journal_entry_lines` joined to `journal_entries` filtered by `je.date` within the period’s `period_start`/`period_end` (and optionally by `je.period_id = period_id` when `period_id` is guaranteed).
- **Keys:** One snapshot per `(period_id)`; `period_id` SHALL be the natural key (unique).
- **Staleness:** When a journal entry is inserted, the snapshot for the period containing that entry’s date SHALL be marked stale (e.g. `is_stale = TRUE`); (re)build SHALL clear staleness. Staleness SHALL NOT block or abort the insert (trigger SHALL not raise).
- **Reconciliation invariants:** After build, `total_debits` SHALL equal `total_credits` (zero tolerance or documented tolerance); if not, build SHALL fail (RAISE) and SHALL NOT persist an unbalanced snapshot.

### G. Statement contract: P&L / BS / TB source

- Trial Balance SHALL be served from the canonical snapshot: `get_trial_balance_from_snapshot(period_id)` (which MAY regenerate the snapshot if missing or stale). No TB report SHALL read ledger by date range only, bypassing the snapshot.
- P&L and Balance Sheet SHALL be derived ONLY from the same canonical trial balance snapshot (e.g. `get_profit_and_loss_from_trial_balance(period_id)` and `get_balance_sheet_from_trial_balance(period_id)`), which in turn use `get_trial_balance_from_snapshot(period_id)`. No P&L/BS report SHALL call legacy date-range functions that read ledger directly.
- **Justification (repo evidence):** Migration 169 renames date-range `get_profit_and_loss` / `get_balance_sheet` to `_legacy` and defines canonical functions that take `period_id` and read from trial balance (234: `get_profit_and_loss_from_trial_balance`, `get_balance_sheet_from_trial_balance`). On-screen reports use `getBalanceSheetReport` / `getProfitAndLossReport` which call these period_id RPCs. Therefore the chosen rule is: **statements SHALL be derived only from snapshots** (TB snapshot → P&L/BS). Legacy functions bypass the snapshot and SHALL NOT be used for canonical reporting or export.

### H. VAT contract

- One authoritative VAT report SHALL be defined: either ledger-source (VAT control account from `journal_entry_lines`) or operational-source (invoices/expenses/bills). The other SHALL be deprecated or explicitly reconciled to the authoritative one.
- If ledger is authoritative: VAT return/export SHALL be computed from ledger (e.g. account 2100 and siblings); any operational “VAT returns” flow SHALL reconcile to ledger and document the reconciliation.
- Reconciliation requirement: If both ledger and operational VAT exist, SHALL be a documented reconciliation (formula + where computed) and a check (e.g. in period close or diagnostic) that they match within tolerance.

### I. AR/AP/Cash control reconciliations

- **AR:** For each period, ledger AR SHALL be computed from `get_ar_balances_by_invoice(business_id, period_id)` (or equivalent ledger-only aggregation). Operational expected SHALL be `invoice.total - SUM(payments) - SUM(applicable credit_notes)`. Period close SHALL require that ledger AR total equals operational total (or that mismatches are resolved via reconciliation_resolutions).
- **AP:** Same idea for supplier bills and bill payments (ledger AP vs operational expected); required equations SHALL be documented and enforced at close if applicable.
- **Cash:** Cash/Bank control accounts SHALL reconcile to operational cash movements (or documented exception); required equations SHALL be defined and checked where applicable.

---

## 2) CURRENT STATE AUDIT (Repo Evidence)

### create_system_accounts and conflict target

| Check | Result | Citation |
|-------|--------|----------|
| Where create_system_accounts is defined | **PASS** | `supabase/migrations/251_create_system_accounts_without_conflict.sql` lines 13–95 |
| Conflict target in current version | **PASS** | Migration 251 does not use ON CONFLICT; uses `WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = v.business_id AND a.code = v.code AND a.deleted_at IS NULL)` (lines 29–32, 49–52, etc.) |
| Prior version (before 251) | **FAIL** | `043_accounting_core.sql` lines 77, 91, 97, etc.: `ON CONFLICT (business_id, code) DO NOTHING`. If 248/249/250 drop the table constraint and create only a partial index, and 251 is not yet applied, bootstrap fails with “no unique or exclusion constraint matching the ON CONFLICT specification” |

### accounts uniqueness (business_id, code)

| Check | Result | Citation |
|-------|--------|----------|
| Original table constraint | **PASS** | `043_accounting_core.sql` line 18: `UNIQUE(business_id, code)` on `accounts` |
| After 248/249/250 | **FAIL** | `250_coa_fk_integrity_patch.sql` lines 273–279: `ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_business_id_code_key`; `DROP INDEX IF EXISTS accounts_unique_business_code_active_idx`; then `CREATE UNIQUE INDEX accounts_unique_business_code_active_idx ON accounts (business_id, code) WHERE deleted_at IS NULL`. So the **table constraint** is dropped; only a **partial unique index** exists. |
| Match for ON CONFLICT (business_id, code) | **CONDITIONAL** | PostgreSQL allows ON CONFLICT to use a unique index on the same columns; the partial index qualifies. If 248/249/250 run successfully, create_system_accounts (pre-251) would work. If 248/249/250 fail before creating the index (or are skipped), create_system_accounts (pre-251) fails. 251 removes the dependency. |

### Posting date for invoices and payments

| Check | Result | Citation |
|-------|--------|----------|
| Invoice posting date | **PASS** | `228_revenue_recognition_guards.sql` lines 333–338: `posting_date := COALESCE((invoice_record.sent_at AT TIME ZONE 'UTC')::DATE, invoice_record.issue_date)`; passed to `post_journal_entry(..., posting_date, ...)` (lines 446–448). |
| Payment posting date | **PASS** | `227_payment_draft_invoice_guard.sql` lines 88–89: `post_journal_entry(business_id_val, payment_record.date, ...)`. So payment uses `payment_record.date`. |
| Legacy invoice posting (pre-226) | **FAIL** | `220_invoice_tax_lines_parse_canonical_format.sql` line 159: uses `invoice_record.issue_date` only (no sent_at). Replaced by 226/228. |

### journal_entries.period_id

| Check | Result | Citation |
|-------|--------|----------|
| Column exists | **PASS** | `148_manual_journal_draft_posting_hardening.sql` line 31: `ADD COLUMN IF NOT EXISTS period_id UUID REFERENCES accounting_periods(id)`. |
| Set by post_journal_entry | **FAIL** | `228_revenue_recognition_guards.sql` lines 172–186: INSERT into `journal_entries` does **not** include `period_id`. Only manual draft posting (148) and opening balance (151, 189) set `period_id`. Invoice, payment, expense, sale, refund postings do not set it. |
| generate_trial_balance filter | **PASS** | `247_snapshot_engine_v2_stale_aware.sql` lines 284–294: TB is built from `journal_entry_lines` joined to `journal_entries` with `je.date >= period_record.period_start AND je.date <= period_record.period_end` (by date range). It does **not** filter by `je.period_id`. So TB remains correct even when `period_id` is null, but period_id is not populated for system postings. |

### generate_trial_balance / get_trial_balance_from_snapshot

| Check | Result | Citation |
|-------|--------|----------|
| generate_trial_balance selects by period | **PASS** | `247_snapshot_engine_v2_stale_aware.sql` lines 267–294: Gets period from `accounting_periods` by `p_period_id`; sums JEL by `jel.account_id` and `je.date` within `period_record.period_start`/`period_end`. |
| get_trial_balance_from_snapshot | **PASS** | Same file lines 127–162: Returns snapshot if fresh; else calls `generate_trial_balance(p_period_id, NULL)` then reads snapshot. |
| Stale marking on JE insert | **PASS** | `247_snapshot_engine_v2_stale_aware.sql` trigger `invalidate_snapshot_on_journal_entry` (lines 89–121) calls `mark_trial_balance_snapshot_stale`; wrapped in exception handler so it does not abort insert. |

### VAT: Returns vs control (dual truth)

| Check | Result | Citation |
|-------|--------|----------|
| VAT Control report source | **PASS** (ledger) | `app/api/reports/vat-control/route.ts` lines 111–134, 145–161: Reads from `journal_entry_lines` with `account_id = vatAccount.id`, filtered by `journal_entries.date`. Ledger-only. |
| VAT Returns / calculate source | **FAIL** (operational) | `app/api/vat-returns/calculate/route.ts` lines 81–92: Fetches from `invoices` (status = 'paid', apply_taxes = true, issue_date in range). Lines 196–207: expenses/bills for input VAT. Operational tables, not ledger. |
| Dual source | **FAIL** | Two paths: vat-control = ledger; vat-returns/calculate = invoices/expenses/bills. No single authoritative source and no documented reconciliation. |

### Reports bypassing ledger/snapshot

| Check | Result | Citation |
|-------|--------|----------|
| On-screen P&L/BS | **PASS** | Use `getProfitAndLossReport` / `getBalanceSheetReport` → `get_profit_and_loss_from_trial_balance` / `get_balance_sheet_from_trial_balance` (snapshot). `lib/accounting/reports/getProfitAndLossReport.ts` line 112; `getBalanceSheetReport.ts` uses same pattern. |
| Export PDF/CSV P&L/BS | **FAIL** | `app/api/accounting/reports/balance-sheet/export/pdf/route.ts` line 53: `supabase.rpc("get_balance_sheet", { p_business_id, p_as_of_date })`. `app/api/accounting/reports/profit-and-loss/export/pdf/route.ts` line 111: `supabase.rpc("get_profit_and_loss", { ... })`. Migration 169 renames these to `get_balance_sheet_legacy` and `get_profit_and_loss_legacy` (169 lines 478–493). So export routes call RPC names that no longer exist (or call legacy by wrong name). Either exports 500 or a wrapper exists; no wrapper found in migrations. |
| Trial balance PDF export | **INCONSISTENT** | `app/api/accounting/reports/trial-balance/export/pdf/route.ts` line 84: calls `get_trial_balance` (date-range). CSV export (line 64) calls `get_trial_balance_from_snapshot`. So TB PDF uses legacy date-range, TB CSV uses snapshot. |

### Duplicate invoice_number handling

| Check | Result | Citation |
|-------|--------|----------|
| Unique index on invoices | **PASS** | `036_complete_invoice_system_setup.sql` lines 113–115: `CREATE UNIQUE INDEX ... ON invoices(business_id, invoice_number) WHERE deleted_at IS NULL`. Partial index: only applies when `deleted_at IS NULL`. |
| Null invoice_number | **FAIL** | In PostgreSQL, unique index treats NULL as distinct; multiple rows can have `(business_id, NULL)`. Drafts can have null `invoice_number` until sent (`app/api/invoices/create/route.ts` lines 68–73). So duplicate “null” groups are allowed. |
| Assignment on send | **PASS** | `app/api/invoices/[id]/send/route.ts` lines 20–25: if no `invoice_number`, calls `generate_invoice_number_with_settings`. Same in `app/api/invoices/[id]/route.ts` (475–480). |
| Race / duplicate number | **UNKNOWN** | No lock or serialization found around `generate_invoice_number_with_settings` + update in send flow; concurrent sends could theoretically get same number if RPC is not row-locking. Not verified in repo. |

### Monetary type and rounding

| Check | Result | Citation |
|-------|--------|----------|
| journal_entry_lines debit/credit type | **PASS** | `043_accounting_core.sql` lines 53–54: `debit NUMERIC DEFAULT 0`, `credit NUMERIC DEFAULT 0`. |
| Balance check tolerance | **PASS** | `043_accounting_core.sql` lines 164–165: `IF ABS(total_debit - total_credit) > 0.01 THEN RAISE EXCEPTION`. |
| Rounding on insert | **FAIL** | `228_revenue_recognition_guards.sql` lines 214–217: `COALESCE((jl->>'debit')::NUMERIC, 0)` — no explicit ROUND. So floating or string conversion can leave microscopic residuals. No single rounding policy applied at line insert. |
| TB balance tolerance | **PASS** | `247_snapshot_engine_v2_stale_aware.sql` lines 328–332: `IF balance_difference > 0.01 THEN RAISE EXCEPTION`. |

### Period close and run_period_close_checks

| Check | Result | Citation |
|-------|--------|----------|
| run_period_close_checks calls get_trial_balance | **FAIL** | `225_period_close_checks_rpc_and_log.sql` line 92: `FROM get_trial_balance(p_business_id, v_period_start, v_period_end)`. Migration 169 renames `get_trial_balance(UUID, DATE, DATE)` to `get_trial_balance_legacy` (169 line 465). So after 169, `get_trial_balance` no longer exists; close checks would fail unless a later migration recreated it. No such migration found. |
| AR reconciliation in close | **PASS** | `225_period_close_checks_rpc_and_log.sql` lines 109–158: Uses `get_ar_balances_by_invoice`, compares to operational (invoices - payments - credit_notes), checks for unresolved mismatches. |

### Additional citations (key functions)

- **ensure_accounting_initialized:** `245_phase13_repairable_bootstrap.sql` lines 13–66. Calls `create_system_accounts`, `initialize_business_chart_of_accounts`, then `initialize_business_accounting_period` if no period exists.
- **resolve_default_accounting_period:** `246_automatic_default_period_resolver.sql` lines 6–113.
- **mark_trial_balance_snapshot_stale:** `247_snapshot_engine_v2_stale_aware.sql` lines 48–84.
- **initialize_business_accounting_period:** `177_retail_accounting_period_initialization.sql` lines 45–96.

---

## 3) GAP LIST (Ranked)

### Blocking (system cannot initialize / posting blocked)

1. **create_system_accounts ON CONFLICT vs constraint (mitigated by 251)**  
   - If 251 is not applied and 248/249/250 have run: table unique constraint is dropped, partial index exists — ON CONFLICT in pre-251 create_system_accounts works. If 248/249/250 fail before index creation, create_system_accounts fails.  
   - **Action:** Ensure 251 is applied everywhere; no remaining code path uses ON CONFLICT for create_system_accounts (251 replaces with WHERE NOT EXISTS). Verify migration order and that no environment runs 244/245 without 251.

2. **run_period_close_checks calls missing get_trial_balance**  
   - 225 calls `get_trial_balance(p_business_id, v_period_start, v_period_end)`; 169 renames it to `get_trial_balance_legacy`.  
   - **Action:** Change run_period_close_checks to use `get_trial_balance_from_snapshot(period_id)` (resolve period_id from p_period_id) or call `get_trial_balance_legacy` by name; prefer snapshot for contract compliance.

3. **Export PDF/CSV call get_balance_sheet / get_profit_and_loss**  
   - These are renamed to _legacy in 169; export routes still call the old names.  
   - **Action:** Update export routes to resolve period from request, then call `get_balance_sheet_from_trial_balance(period_id)` and `get_profit_and_loss_from_trial_balance(period_id)` (and use same response shape or adapt).

### Data correctness (statements wrong)

4. **journal_entries.period_id not set by post_journal_entry**  
   - All system postings (invoice, payment, expense, sale, refund, etc.) leave period_id NULL.  
   - **Action:** In `post_journal_entry`, resolve period from (p_business_id, p_date) and set period_id on INSERT. Backfill existing rows (see implementation plan).

5. **Trial balance PDF export uses get_trial_balance (legacy)**  
   - TB PDF uses date-range get_trial_balance; TB CSV uses get_trial_balance_from_snapshot.  
   - **Action:** Use get_trial_balance_from_snapshot for TB PDF (with period resolution) for consistency and contract.

6. **Rounding / microscopic JE imbalance**  
   - No rounding at JEL insert; tolerance 0.01 at JE and TB level can allow tiny residuals.  
   - **Action:** Define and apply single rounding policy (e.g. ROUND(..., 2) at insert for debit/credit); optionally add DB check that SUM(debit)=SUM(credit) with strict tolerance or rounded comparison.

### Consistency (dual-source VAT)

7. **VAT Returns (operational) vs VAT Control (ledger)**  
   - vat-returns/calculate uses invoices/expenses; vat-control uses journal_entry_lines.  
   - **Action:** Choose one authoritative source (recommend ledger). Either (a) make VAT returns/export derive from ledger (e.g. VAT account 2100 + siblings by period), or (b) keep operational flow but add reconciliation check and document it; enforce in period close or diagnostic.

### UX-only (React key / display)

8. **Duplicate invoice_number (including null)**  
   - Partial unique index allows multiple (business_id, NULL).  
   - **Action:** Enforce NOT NULL for invoice_number when status IN ('sent','paid') (DB or app); optionally partial unique index WHERE invoice_number IS NOT NULL to avoid duplicate nulls. Invoice creation already assigns on send; ensure no path leaves sent invoices with null.  
   - Duplicate non-null numbers: add concurrency control (e.g. advisory lock or serializable) in generate_invoice_number_with_settings + update if needed.

---

## 4) ORDERED IMPLEMENTATION PLAN (No code yet)

### Step 1: Export and period-close use canonical TB/snapshot

- **Files:**  
  - `app/api/accounting/reports/balance-sheet/export/pdf/route.ts`  
  - `app/api/accounting/reports/balance-sheet/export/csv/route.ts`  
  - `app/api/accounting/reports/profit-and-loss/export/pdf/route.ts`  
  - `app/api/accounting/reports/profit-and-loss/export/csv/route.ts`  
  - `app/api/accounting/reports/trial-balance/export/pdf/route.ts`
- **Change:** Resolve period from query params (reuse same resolver as on-screen reports: e.g. resolveAccountingPeriodForReport or period_id). Call `get_balance_sheet_from_trial_balance(period_id)`, `get_profit_and_loss_from_trial_balance(period_id)`, `get_trial_balance_from_snapshot(period_id)` instead of get_balance_sheet / get_profit_and_loss / get_trial_balance (date-range). Adapt response shape if legacy RPCs had different return format.
- **Migration:** None.
- **Test:** Hit export endpoints with period_id and as_of_date; compare totals to on-screen report for same period.

### Step 2: run_period_close_checks use snapshot TB

- **File:** New migration (e.g. `252_period_close_checks_use_snapshot_trial_balance.sql`).
- **Function:** `run_period_close_checks(p_business_id, p_period_id)`.
- **Change:** Replace call to `get_trial_balance(p_business_id, v_period_start, v_period_end)` with: get TB from `get_trial_balance_from_snapshot(p_period_id)` (or call generate_trial_balance then read snapshot). Compute total debits/credits from returned rows and keep same failure logic (TRIAL_BALANCE_UNBALANCED).
- **Test:** Run run_period_close_checks for a period; confirm it passes/fails consistently with UI; no reference to get_trial_balance.

### Step 3: post_journal_entry set period_id

- **File:** New migration (e.g. `253_post_journal_entry_set_period_id.sql`).
- **Function:** `post_journal_entry` (16-param and any wrappers).
- **Change:** Before INSERT into journal_entries, resolve period_id: `SELECT id FROM accounting_periods WHERE business_id = p_business_id AND p_date >= period_start AND p_date <= period_end LIMIT 1`. If not found, RAISE. Add period_id to INSERT column list and VALUES.
- **Test:** Post an invoice and a payment; SELECT period_id FROM journal_entries WHERE id IN (...); expect non-null. Assert accounting_period_is_open already guards; no new period creation in this path.

### Step 4: Backfill journal_entries.period_id

- **File:** New migration (e.g. `254_backfill_journal_entries_period_id.sql`).
- **Strategy:**  
  - UPDATE journal_entries je SET period_id = ap.id  
  FROM accounting_periods ap  
  WHERE ap.business_id = je.business_id AND je.date >= ap.period_start AND je.date <= ap.period_end AND je.period_id IS NULL.  
  - Optionally: one period per (business_id, date) to avoid multiple matches (periods should not overlap; if they do, define rule e.g. earliest period_end >= date).  
- **Validation:** After backfill, `SELECT COUNT(*) FROM journal_entries WHERE period_id IS NULL` should be 0 (or document allowed exceptions).  
- **Rollback:** UPDATE journal_entries SET period_id = NULL WHERE ... (same predicate); no FK cascade on period delete that would break).

### Step 5: Optional — add NOT NULL period_id for new rows

- **File:** Same or later migration.
- **Change:** `ALTER TABLE journal_entries ALTER COLUMN period_id SET NOT NULL` (after backfill). If any legitimate path can create JE without period (e.g. migration/backfill), do this after all such paths set period_id.
- **Rollback:** ALTER COLUMN period_id DROP NOT NULL.

### Step 6: Rounding policy for JEL

- **File:** New migration.
- **Function:** `post_journal_entry` (and any direct INSERT into journal_entry_lines).
- **Change:** When inserting lines, use e.g. ROUND((jl->>'debit')::NUMERIC, 2) and ROUND((jl->>'credit')::NUMERIC, 2) (or scale from business currency). Document in COMMENT. Optionally add CHECK on journal_entry_lines that debit/credit are rounded to 2 decimals.
- **Test:** Post JE with fractional amounts; assert stored values are 2-decimal; run TB and confirm no 0.00000000000001 difference.

### Step 7: VAT single source and reconciliation

- **Files:**  
  - `app/api/vat-returns/calculate/route.ts` (and related vat-returns endpoints);  
  - Optionally new RPC or report that computes VAT from ledger (account 2100 etc. by period).
- **Change:** Either (A) Change vat-returns/calculate to derive from ledger (query journal_entry_lines for VAT accounts by period), or (B) Keep operational flow and add a reconciliation endpoint/check that compares ledger VAT to operational VAT and returns diff. Document which is authoritative (recommend ledger). If (B), add to period close or diagnostic.
- **Test:** For a period with VAT, compare vat-control response to vat-returns; either same source or documented reconciliation.

### Step 8: invoice_number uniqueness and nulls

- **DB:** (Optional) Add constraint or partial unique index so that for status IN ('sent','paid'), invoice_number is NOT NULL and unique per business (e.g. partial unique index WHERE status IN ('sent','paid') AND deleted_at IS NULL on (business_id, invoice_number)).  
- **App:** Ensure send flow and any transition to sent always set invoice_number (already in send/route and [id]/route); reject sent with null.  
- **Test:** Create draft, send (assign number); create another draft, try to set sent without number → expect error. Check no duplicate (business_id, invoice_number) for non-null.

### Forensic SQL checks (before/after)

- Run `scripts/forensic-accounting-verification.sql` (or equivalent) before and after each step:  
  - 2.3 (JE balanced), 4.x (snapshot coverage), and any new query for period_id NOT NULL count, TB total debits = credits, VAT ledger vs operational.
- After Step 4: `SELECT COUNT(*) FROM journal_entries WHERE period_id IS NULL` → 0.
- After Step 6: No JE with ABS(SUM(debit)-SUM(credit)) > 0.001 (or chosen tolerance).

### Rollback safety

- Each migration SHALL be reversible where possible (e.g. backfill migration: store previous period_id if needed, or reverse UPDATE).  
- Function replacements (post_journal_entry, run_period_close_checks) SHALL be in migrations so they can be reverted by re-applying previous function body.  
- Export route changes are app-only; revert by restoring previous RPC names and ensuring legacy RPCs exist (or keep legacy as wrappers if needed for rollback).

---

**End of FINZA Immutable Accounting Contract v1.0**
