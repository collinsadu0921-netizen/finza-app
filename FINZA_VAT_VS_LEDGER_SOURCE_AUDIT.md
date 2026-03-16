# FINZA VAT vs Ledger Source Audit

**READ ONLY — DATA FLOW TRACE — NO FIXES OR REFACTORS**

**Purpose:** Determine whether VAT reporting in Finza is derived from (1) ledger journal movements, (2) invoice/operational tax metadata, or (3) a hybrid. Evidence suggests VAT reports may not be ledger-authoritative in all surfaces.

---

## PART 1 — VAT Report Data Source Discovery

### 1.1 VAT Control Report (Ledger-Authoritative)

| Item | Detail |
|------|--------|
| **Path** | `finza-web/app/api/reports/vat-control/route.ts` |
| **HTTP** | `GET /api/reports/vat-control?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` |
| **Primary source tables** | `accounts` (VAT account code 2100), `journal_entry_lines`, `journal_entries` |
| **journal_entry_lines used?** | **Yes.** All movement from `journal_entry_lines` joined to `journal_entries`. |
| **invoices / invoice_items / tax_lines used?** | **No.** |
| **VAT values** | **Recomputed** from ledger: opening = SUM(credit − debit) before start_date; period credits = vat_collected; period debits = vat_reversed. |
| **Date field for period** | **`journal_entries.date`** — filtered `.gte("journal_entries.date", startDate)` and `.lte("journal_entries.date", endDate)`. |

**Snippet (period movement):**

```ts
// Lines 145–161
const { data: periodLines, error: periodError } = await supabase
  .from("journal_entry_lines")
  .select(`debit, credit, journal_entries!inner (date, period_id)`)
  .eq("account_id", vatAccount.id)
  .eq("journal_entries.business_id", business.id)
  .gte("journal_entries.date", startDate)
  .lte("journal_entries.date", endDate)
```

---

### 1.2 VAT Returns: Monthly List (Invoice/Expense/Bill-Authoritative)

| Item | Detail |
|------|--------|
| **Path** | `finza-web/app/api/vat-returns/monthly/route.ts` |
| **HTTP** | `GET /api/vat-returns/monthly` |
| **Primary source tables** | `invoices`, `expenses`, `bills` (no ledger tables) |
| **journal_entry_lines used?** | **No.** |
| **invoices / expenses / bills used?** | **Yes.** Columns: `invoices` (issue_date, subtotal, nhil, getfund, covid, vat, total_tax, apply_taxes, status); `expenses` (date, total, nhil, getfund, covid, vat); `bills` (issue_date, subtotal, nhil, getfund, covid, vat, total_tax). |
| **VAT values** | **Pre-calculated** from operational columns: `inv.vat`, `exp.vat`, `bill.vat` summed per month. |
| **Date field for period** | **Invoices:** `invoices.issue_date` → month key YYYY-MM. **Expenses:** `expenses.date`. **Bills:** `bills.issue_date`. |

**Snippet (invoices and grouping):**

```ts
// Lines 86–94, 145–147
const { data: invoices } = await supabase
  .from("invoices")
  .select("id, invoice_number, issue_date, subtotal, nhil, getfund, covid, vat, total_tax, apply_taxes, status")
  .eq("business_id", business.id)
  .eq("status", "paid")
  .eq("apply_taxes", true)
  ...
;(invoices || []).forEach((inv: any) => {
  const date = new Date(inv.issue_date)
  const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  ...
})
```

---

### 1.3 VAT Returns: Calculate (Invoice/Expense/Bill/Credit Note-Authoritative)

| Item | Detail |
|------|--------|
| **Path** | `finza-web/app/api/vat-returns/calculate/route.ts` |
| **HTTP** | `POST /api/vat-returns/calculate` (body: `period_start_date`, `period_end_date`) |
| **Primary source tables** | `invoices`, `credit_notes`, `expenses`, `bills` |
| **journal_entry_lines used?** | **No.** |
| **invoices / tax_lines used?** | **Yes.** Invoices filtered by `issue_date` in range, `status = 'paid'`, `apply_taxes = true`; credit notes by `date` in range, `status = 'applied'`. |
| **VAT values** | **Pre-calculated** from `inv.vat`, `inv.nhil`, etc.; `cn.vat`, etc.; `exp.vat`; `bill.vat`. |
| **Date field for period** | **Invoices:** `invoices.issue_date`. **Credit notes:** `credit_notes.date`. **Expenses:** `expenses.date`. **Bills:** `bills.issue_date`. |

**Snippet (output VAT from invoices):**

```ts
// Lines 82–89, 167–177
let invoiceQuery = supabase
  .from("invoices")
  .select("subtotal, nhil, getfund, covid, vat, total_tax, apply_taxes")
  .eq("business_id", business.id)
  .eq("status", "paid")
  .eq("apply_taxes", true)
  .gte("issue_date", period_start_date)
  .lte("issue_date", period_end_date)
...
const totalOutputVat = taxableInvoices.reduce((sum, inv) => sum + Number(inv.vat || 0), 0) -
  (creditNotes || []).reduce((sum, cn) => sum + Number(cn.vat || 0), 0)
```

---

### 1.4 VAT Returns: Create (Same as Calculate)

| Item | Detail |
|------|--------|
| **Path** | `finza-web/app/api/vat-returns/create/route.ts` |
| **HTTP** | `POST /api/vat-returns/create` |
| **Primary source tables** | Same as calculate: `invoices`, `credit_notes`, `expenses`, `bills`. In create, invoices use `status IN ('paid', 'partially_paid')`. |
| **journal_entry_lines used?** | **No.** |
| **VAT values** | Same arithmetic from operational columns; result stored in `vat_returns` table. |
| **Date field** | Same: `issue_date` / `date` per entity. |

---

### 1.5 Accounting VAT Export (Ledger-Authoritative)

| Item | Detail |
|------|--------|
| **Path** | `finza-web/app/api/accounting/exports/vat/route.ts` |
| **HTTP** | `GET /api/accounting/exports/vat?business_id=...&period=YYYY-MM` |
| **Primary source tables** | `accounts`, `journal_entry_lines`, `journal_entries`; RPC `calculate_account_balance_as_of`. |
| **journal_entry_lines used?** | **Yes.** Period debits/credits from `journal_entry_lines` with `journal_entries.date` in period. |
| **invoices / tax_lines used?** | **No.** |
| **VAT values** | **Recomputed**: opening via `calculate_account_balance_as_of`; period from SUM(debit), SUM(credit) on VAT account. |
| **Date field for period** | **`journal_entries.date`** — period derived from query param YYYY-MM (periodStart/periodEnd). |

**Snippet:**

```ts
// Lines 134–148
const { data: periodLines } = await supabase
  .from("journal_entry_lines")
  .select("debit, credit, journal_entries!inner (date)")
  .eq("account_id", vatAccount.id)
  .gte("journal_entries.date", periodStart)
  .lte("journal_entries.date", periodEnd)
```

---

### 1.6 RPC: extract_tax_return_from_ledger (Ledger-Only, Not Used by API)

| Item | Detail |
|------|--------|
| **Path** | `finza-web/supabase/migrations/093_step7_tax_return_extraction.sql` |
| **Primary source tables** | `accounts`, `journal_entry_lines`, `journal_entries` (accounts 2100, 2110, 2120, 2130). |
| **journal_entry_lines used?** | **Yes.** |
| **invoices / tax_lines used?** | **No.** Migration comment: "Do NOT read invoices, sales, bills, or tax_lines". |
| **Date field** | **`je.date`** — opening: `je.date < p_start_date`; period: `je.date >= p_start_date AND je.date <= p_end_date`. |
| **Used by any API?** | **No.** Grep shows no callers in app or API; only referenced in migration and `VAT_REPORT_JAN2026_AUDIT.md`. |

---

## PART 2 — Ledger VAT Source Verification

### 2.1 post_invoice_to_ledger

| Item | Detail |
|------|--------|
| **Path** | `finza-web/supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql` |
| **VAT accounts** | Tax lines from `invoice_record.tax_lines` JSONB; each line has `ledger_account_code` and `ledger_side`. System accounts (migration 251) define 2100 (VAT Payable), 2110 (NHIL), 2120 (GETFund), 2130 (COVID). |
| **Date passed to post_journal_entry** | **`posting_date`** = `COALESCE((invoice_record.sent_at AT TIME ZONE 'UTC')::DATE, invoice_record.issue_date)`. If both null, exception. |
| **Invoice posting date equals** | **sent_at date if present, else issue_date.** Not current_timestamp. |

**Snippet:**

```sql
-- Lines 74-80
posting_date := COALESCE(
  (invoice_record.sent_at AT TIME ZONE 'UTC')::DATE,
  invoice_record.issue_date
);
IF posting_date IS NULL THEN
  RAISE EXCEPTION 'Invoice has no issue_date or sent_at. Cannot post to ledger. Invoice id: %', p_invoice_id;
END IF;
```

### 2.2 post_invoice_payment_to_ledger

| Item | Detail |
|------|--------|
| **Path** | `finza-web/supabase/migrations/217_payment_posting_period_guard.sql` |
| **Date used for journal_entries** | **`payment_record.date`** — passed to `post_journal_entry(business_id_val, payment_record.date, ...)`. |

### 2.3 post_sale_to_ledger / post_expense_to_ledger

- **Sales:** Tax postings come from sale’s tax_lines (and system account codes 2100, 2110, etc.) with posting date from sale/register logic (not re-traced here).
- **Expenses:** `post_expense_to_ledger` (migration 229) reads from `expenses` (e.g. tax_lines if present); posting date from expense date.

---

## PART 3 — Period Boundary Logic

| Surface | Grouping / period assignment | Date source |
|--------|------------------------------|-------------|
| **VAT Control** (`/api/reports/vat-control`) | Client-supplied `start_date` / `end_date`; filter `journal_entries.date` IN [start_date, end_date]. | **Ledger:** `journal_entries.date` |
| **VAT Returns monthly** (`/api/vat-returns/monthly`) | Group by month key YYYY-MM from invoice issue_date, expense date, bill issue_date. | **Operational:** `invoices.issue_date`, `expenses.date`, `bills.issue_date` |
| **VAT Returns calculate/create** | Request body `period_start_date` / `period_end_date`; filter invoices/credit_notes/expenses/bills by their respective date columns in range. | **Operational:** `invoices.issue_date`, `credit_notes.date`, `expenses.date`, `bills.issue_date` |
| **Accounting VAT export** | Query param `period=YYYY-MM` → periodStart/periodEnd; filter `journal_entries.date` in that range. | **Ledger:** `journal_entries.date` |
| **extract_tax_return_from_ledger** | Parameters `p_start_date`, `p_end_date`; SQL uses `je.date < p_start_date` for opening and `je.date >= p_start_date AND je.date <= p_end_date` for period. | **Ledger:** `journal_entries.date` |

**Conclusion:** Ledger-based VAT uses **journal_entries.date** only. VAT Returns (monthly/calculate/create) use **invoice/expense/bill/credit_note date fields** only. No shared “accounting period resolver” for VAT Returns; they do not use `accounting_periods` or period_id.

---

## PART 4 — Reconciliation Integrity Test

**Question:** Does Finza contain any logic that enforces **VAT Report Totals == Ledger VAT Payable Movements**?

**Findings:**

1. **run_business_accounting_audit** (`supabase/migrations/170_accounting_invariant_audit.sql`): Invariants checked are — sale↔JE completeness, ledger line completeness, period guard, period state, opening balance rollforward, **trial_balance_balance**, **statement_reconciliation** (P&L/BS vs trial balance), and existence of canonical reporting functions. **There is no invariant that compares VAT report totals (from any surface) to ledger VAT (e.g. account 2100) movements.**

2. **CI workflow** (`.github/workflows/accounting-invariants.yml`): Runs `accounting-ci-audit.ts` (which calls `run_business_accounting_audit`), `detect-report-bypass.ts`, and `detect-non-ledger-reports.ts`. None of these compare VAT report to ledger.

3. **detect-non-ledger-reports.ts**: Scans only `app/api/reports`, `app/reports`, `app/admin/retail/analytics`, `app/analytics`. It does **not** scan `app/api/vat-returns`, so the invoice/expense/bill-based VAT Returns API is not flagged as non-ledger.

4. **Validation RPCs / silent auditor / reconciliation routines:** No RPC or script was found that (a) fetches VAT from ledger (e.g. 2100) and (b) compares it to VAT from invoices/expenses/bills or to vat_returns table.

**Explicit confirmation:** **No logic was found that enforces VAT Report Totals == Ledger VAT Payable Movements.** The two families (ledger-based VAT Control/export vs operational VAT Returns) run in parallel with no cross-check.

---

## PART 5 — Backdating Behaviour

**Scenario:** Invoice created with past `issue_date` and a later posting timestamp (e.g. sent_at or actual post time).

1. **Will ledger VAT move to invoice period?**  
   Ledger uses **posting_date** = `COALESCE(sent_at::DATE, issue_date)`. If the user backdates `issue_date` and does not set `sent_at`, the journal entry date is the (backdated) `issue_date`, so **yes** — ledger VAT will be in the period of the invoice’s issue_date. If `sent_at` is set to “now”, the posting date is today, so VAT goes to today’s period.

2. **Will VAT report follow invoice date or ledger date?**  
   - **VAT Control / Accounting VAT export:** Use **ledger** `journal_entries.date` → they follow **ledger (posting) date**.  
   - **VAT Returns (monthly/calculate/create):** Use **invoices.issue_date** (and expense/bill/credit_note dates) → they follow **invoice (and document) dates**, not ledger date.

3. **Can VAT report and P&L diverge?**  
   **Yes.** P&L is built from **trial_balance_snapshots** (period-based, ledger). VAT Control uses **journal_entries.date** in a date range (no snapshot). VAT Returns use **operational dates** and **operational VAT columns**, not ledger. So: (a) VAT Returns can diverge from ledger because they ignore ledger; (b) VAT Control and P&L can still differ if period boundaries or snapshot vs raw ledger differ; (c) backdating invoice to a closed period can create ledger post in that period (if period was open at post time) while VAT Returns would also show it in that month by issue_date — but if posting_date is “today” and issue_date is in the past, ledger shows current period and VAT Returns show past month → **explicit divergence**.

---

## PART 6 — Multi-Source Risk Detection

**Does the same “VAT report” read from both ledger and invoice tax tables?**

- **VAT Control** and **Accounting VAT export** read **only** from ledger (`journal_entry_lines` + `journal_entries`, VAT account).
- **VAT Returns** (monthly, calculate, create) read **only** from invoices, credit_notes, expenses, bills (and stored `vat_returns` for persistence). They do **not** read ledger or snapshots.

So **no single report merges both sources**. The product exposes **two separate VAT surfaces** that can show different numbers:

1. **Ledger-based:** VAT Control (`/api/reports/vat-control`), Accounting VAT export (`/api/accounting/exports/vat`), and the unused RPC `extract_tax_return_from_ledger`.
2. **Operational:** VAT Returns (`/api/vat-returns/monthly`, `/api/vat-returns/calculate`, `/api/vat-returns/create`), which persist to `vat_returns` table.

There is **no code path that combines or reconciles** these two; hence no “conflict resolution” logic.

---

## PART 7 — Snapshot Interaction

**Are trial_balance_snapshots used in VAT reporting?**

- **VAT Control:** No. It queries `journal_entry_lines` and `journal_entries` directly with date filters. Does not read `trial_balance_snapshots`.
- **Accounting VAT export:** No. Uses `calculate_account_balance_as_of` and raw `journal_entry_lines` + `journal_entries.date`. Does not use `trial_balance_snapshots`.
- **VAT Returns:** No. Uses only operational tables.
- **extract_tax_return_from_ledger:** No. Uses only `journal_entry_lines` and `journal_entries`.

**Conclusion:** **trial_balance_snapshots are not used in any VAT reporting.** VAT is calculated outside the canonical ledger snapshot system (period-based trial balance → P&L/BS/TB). VAT reporting uses either (a) direct ledger date-filtered queries, or (b) operational tables. So VAT can diverge from period-closed financial statements that are snapshot-based, and there is no single “VAT from snapshot” path.

---

## PART 8 — Frontend Consumption

| UI | API endpoint(s) | Frontend calculations? | Merges multiple backend sources? |
|----|------------------|---------------------------|----------------------------------|
| **VAT Control (Accounting)** | `GET /api/reports/vat-control?start_date=...&end_date=...` | No; displays opening_balance, vat_collected, vat_reversed, closing_balance, invariant_check from response. Date range chosen in UI. | No; single endpoint. |
| **VAT Returns list** | `GET /api/vat-returns/monthly` | No; displays monthlyReturns, grandTotalNetVat. Month grouping done on backend. | No; single endpoint. |
| **VAT Return create** | `POST /api/vat-returns/calculate` then `POST /api/vat-returns/create` | No; create uses same operational logic as calculate (replicated in create route). | No; single source (operational). |
| **VAT Return detail** | `GET /api/vat-returns/${returnId}` | No; displays stored vat_returns row. | No. |

**Evidence:**

- `app/reports/vat/page.tsx`: Calls `fetch(\`/api/reports/vat-control?start_date=${startDate}&end_date=${endDate}\`)` (lines 65–66). No client-side VAT math; no merge of multiple APIs.
- `app/vat-returns/page.tsx`: Calls `fetch("/api/vat-returns/monthly")` (line 44). No client-side aggregation; no merge.
- `app/vat-returns/create/page.tsx`: Calls `/api/vat-returns/calculate` and `/api/vat-returns/create`. No ledger API called.
- `app/vat-returns/[id]/page.tsx`: Fetches `/api/vat-returns/${returnId}` and optionally `/api/vat-returns/calculate` for comparison; both are operational-source.

---

## PART 9 — Evidence Summary (File / Function / Snippet / Columns)

| Finding | File path | Function / route | Key columns / logic |
|--------|-----------|-------------------|----------------------|
| VAT Control source | `app/api/reports/vat-control/route.ts` | GET handler | `journal_entry_lines` + `journal_entries.date`, `account_id` = VAT (2100) |
| VAT Returns monthly source | `app/api/vat-returns/monthly/route.ts` | GET handler | `invoices.issue_date`, `invoices.vat`, `expenses.date`, `expenses.vat`, `bills.issue_date`, `bills.vat` |
| VAT Returns calculate source | `app/api/vat-returns/calculate/route.ts` | POST handler | `invoices.issue_date`, `invoices.vat`; `credit_notes.date`, `credit_notes.vat`; `expenses.date`, `expenses.vat`; `bills.issue_date`, `bills.vat` |
| VAT Returns create source | `app/api/vat-returns/create/route.ts` | POST handler | Same as calculate; writes to `vat_returns` |
| Accounting VAT export source | `app/api/accounting/exports/vat/route.ts` | GET handler | `journal_entry_lines`, `journal_entries.date`, `calculate_account_balance_as_of` |
| Ledger RPC (unused by API) | `supabase/migrations/093_step7_tax_return_extraction.sql` | `extract_tax_return_from_ledger` | `journal_entry_lines`, `journal_entries.date`, accounts 2100–2130 |
| Invoice posting date | `supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql` | `post_invoice_to_ledger` | `posting_date := COALESCE((sent_at AT TIME ZONE 'UTC')::DATE, issue_date)` |
| Payment posting date | `supabase/migrations/217_payment_posting_period_guard.sql` | `post_invoice_payment_to_ledger` | `payment_record.date` |
| No VAT vs ledger invariant | `supabase/migrations/170_accounting_invariant_audit.sql` | `run_accounting_invariant_audit`, `run_business_accounting_audit` | Invariants: trial balance balance, statement reconciliation, etc.; no VAT comparison |
| CI does not check vat-returns | `scripts/detect-non-ledger-reports.ts` | `findReportFiles` | REPORT_DIRS = api/reports, app/reports, admin/retail/analytics, analytics; excludes api/vat-returns |
| Reports/vat page | `app/reports/vat/page.tsx` | `loadReport` | `GET /api/reports/vat-control?start_date=&end_date=` |
| Vat-returns page | `app/vat-returns/page.tsx` | `loadMonthlyReturns` | `GET /api/vat-returns/monthly` |

---

## PART 10 — Final Verdict

**VAT reporting in Finza is not a single model; it is dual-source:**

1. **Ledger-authoritative surfaces**
   - **VAT Control:** `GET /api/reports/vat-control` — 100% from `journal_entry_lines` + `journal_entries.date`, account 2100.
   - **Accounting VAT export:** `GET /api/accounting/exports/vat` — same ledger source, `journal_entries.date`.
   - **RPC:** `extract_tax_return_from_ledger` (and `get_tax_return_summary`) — ledger-only; **not used by any API**.

2. **Invoice/operational-authoritative surfaces**
   - **VAT Returns:** `GET /api/vat-returns/monthly`, `POST /api/vat-returns/calculate`, `POST /api/vat-returns/create` — 100% from `invoices`, `credit_notes`, `expenses`, `bills` (issue_date/date and vat/nhil/getfund/covid columns). No ledger or snapshots.

**Classification:** **Hybrid / dual source.** Two independent VAT reporting paths exist:

- **Ledger-authoritative:** VAT Control report and Accounting VAT export (and unused ledger RPCs).
- **Invoice/operational-authoritative:** VAT Returns (monthly, calculate, create and persisted `vat_returns`).

There is **no** reconciliation or validation that VAT Report Totals equal Ledger VAT Payable movements. Period boundaries differ (ledger uses `journal_entries.date`; VAT Returns use document dates). Backdating and differing posting vs document dates can cause explicit divergence between the two surfaces. **trial_balance_snapshots** are not used for VAT; VAT is outside the canonical snapshot-based reporting path.

---

*End of audit. No fixes or refactors proposed.*
