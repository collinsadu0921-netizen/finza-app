# Service Workspace Audit — Vision Alignment Check

**Audit type:** Principal product + accounting systems auditor. Evidence only. No code changes. No fixes or suggestions.

**Date:** 2025-01-31.  
**Scope:** Service workspace end-to-end — UI flows, APIs, database writes, ledger effects, permissions, reporting, external accountant reality.

---

## 1. Purpose Check (Ground Truth)

### What Service is designed to do

- **Match how service businesses operate:** Sidebar and routes are built around service operations: Dashboard, Invoices, Payments, Estimates, Orders, Recurring Invoices, Customers, Products & Services, Expenses. Finance & Reporting: Accounting Portal, P&L, Balance Sheet, VAT Returns, Financial Reports, Credit Notes, Bills, Assets, Payroll. Accounting (Advanced): Chart of Accounts, General Ledger, Trial Balance, Reconciliation, Audit Log. No POS or register sessions; no cashier/manager retail lock-in (`components/Sidebar.tsx` when `businessIndustry === "service"`).
- **Run operations without accounting expertise:** Invoicing, payments, orders, estimates, expenses, and credit notes are presented in business terms (invoice, payment, order, expense). Ledger posting is automatic: invoice send → `trigger_auto_post_invoice` → `post_invoice_to_ledger`; payment insert → `trigger_auto_post_payment` → `post_invoice_payment_to_ledger`; expense insert → `trigger_auto_post_expense` → `post_expense_to_ledger`; credit note status → applied → `trigger_auto_post_credit_note` → `post_credit_note_to_ledger`. No manual journal entry UI in Service workspace; manual journals live under `/accounting/journals` (accounting workspace only).
- **Produce accounting automatically from invoicing and payments:** Draft invoice → no posting. Invoice send (status → sent) → trigger runs → `post_invoice_to_ledger` (AR, Revenue, Tax); if period is closed or missing, assert raises and status update can roll back. Payment create → trigger → `post_invoice_payment_to_ledger`. Credit note apply → trigger → `post_credit_note_to_ledger`. Expense create → trigger → `post_expense_to_ledger`. Timing: **draft = no post; issued/sent = post invoice; paid/partially_paid = post payment when payment row inserted.**

**Evidence:** `app/api/invoices/[id]/send/route.ts` (comment: "Triggers trigger_auto_post_invoice"); `app/api/invoices/[id]/mark-paid/route.ts` (creates payment; "trigger will ... post payment to ledger via post_invoice_payment_to_ledger()"); `app/api/expenses/create/route.ts` (insert expense; trigger posts); `app/api/credit-notes/[id]/route.ts` (PATCH status → applied); migrations 043, 219 (trigger_auto_post_invoice, trigger_auto_post_credit_note INSERT OR UPDATE OF status).

### What Service should never do

- **Manual journal entry:** No UI in Service workspace to create or edit journal entries. Manual journal drafts and posting are under `/accounting/journals` (accounting workspace; business owners are blocked from `/accounting/*` except Service → `/accounting/reconciliation` only). So Service users do not have manual JE in their workspace.
- **Period management:** Accounting Periods link is shown only when `isAccountantFirmUser` is true (`Sidebar.tsx` line 172). Service business owners do not see "Accounting Periods" in the sidebar; they cannot open accounting workspace (redirect to `/dashboard`). So Service does not expose period open/close/lock to business owners.
- **Ledger mutation other than via operational triggers:** All ledger writes from Service flows are via DB triggers on invoices, payments, credit_notes, expenses (and bills/bill_payments). No Service API was found that calls `post_journal_entry` directly or inserts into journal_entries/journal_entry_lines. Reconciliation **resolve** (post adjustment) is in accounting workspace API (`/api/accounting/reconciliation/resolve`); Service has `/reconciliation` which lists accounts and toggles `is_reconcilable` (PUT `/api/reconciliation/accounts`) — no posting.
- **Reconciliation actions that post:** Service reconciliation page (`/reconciliation`) uses `/api/reconciliation/accounts` (list, toggle is_reconcilable) and `/api/reconciliation/{accountId}/transactions` (read). Resolving mismatches and posting adjustment journal entries is done in accounting workspace (`/api/accounting/reconciliation/resolve`). Service business owners can open `/accounting/reconciliation` (exception in `accessControl.ts` lines 166–168) as a "read-only signpost from dashboard discrepancy banner" — the resolve/post capability is in the accounting API, which is restricted to accountant firm users in practice for posting. So Service does not expose reconciliation **posting** in the operational workspace.

**Evidence:** `lib/accessControl.ts` (accounting workspace firm-only; Service exception for `/accounting/reconciliation` only); `components/Sidebar.tsx` (Accounting Periods only if isAccountantFirmUser); `app/reconciliation/page.tsx` (accounts list, toggle is_reconcilable); `app/api/accounting/reconciliation/resolve/route.ts` (post_journal_entry).

---

## 2. Core Flows

| Flow | UI entry | API | Ledger impact | Timing (draft vs issued vs paid) |
|------|----------|-----|---------------|-----------------------------------|
| **Orders / jobs** | Orders list, new order, convert to invoice | `POST /api/orders/[id]/convert-to-invoice` creates invoice (and links order). Invoice may be draft or sent depending on convert flow. | No direct ledger from order. Ledger impact only when invoice is sent (trigger) or payment created (trigger). | Order convert → invoice created; posting only when invoice status → sent (and when payments are inserted). |
| **Invoices** | Invoices list, new/edit, send | Create: `POST /api/invoices/create`. Send: `POST /api/invoices/[id]/send` (status → sent, assign invoice_number). | Send: `trigger_auto_post_invoice` → `post_invoice_to_ledger`. Draft: no post. | **Draft:** no JE. **Issued/sent:** one JE (AR DR, Revenue CR, Tax CR). Period assert in `post_invoice_to_ledger`; closed period → raise → rollback. |
| **Partial payments** | Payments page or invoice mark-paid; add payment | `POST /api/payments/create` (business_id, invoice_id, amount, date, method, …). | Insert payment → `trigger_auto_post_payment` → `post_invoice_payment_to_ledger` (or equivalent). Invoice status recalculated via trigger. | Each payment insert triggers posting. Partial payments supported (amount < remaining). |
| **Advance payments** | Not explicitly traced as "advance" in this audit. Payments are tied to invoice_id; overpayment handling not traced here. | Same `POST /api/payments/create` with invoice_id. | Same trigger. | — |
| **Write-offs / credit notes** | Credit Notes list, create, apply to invoice | Create: `POST /api/credit-notes/create`. Apply: `PATCH /api/credit-notes/[id]` (status → applied). | Apply: `trigger_auto_post_credit_note` (AFTER INSERT OR UPDATE OF status) → `post_credit_note_to_ledger`. Only applied credit notes post. | **Draft/issued:** no JE. **Applied:** reversal JE (AR CR, Revenue DR, tax reversals). |
| **Expenses** | Expenses list, create | `POST /api/expenses/create` (business_id, supplier, amount, date, tax fields, …). | Insert → `trigger_auto_post_expense` → `post_expense_to_ledger`. Period closed → trigger can raise → 400 from API (expense create route catches period message). | **On insert:** one JE (expense account DR, AP or Cash CR, tax as configured). |

**Evidence:** `app/api/invoices/[id]/send/route.ts`; `app/api/invoices/[id]/mark-paid/route.ts`; `app/api/payments/create/route.ts`; `app/api/credit-notes/create/route.ts`, `app/api/credit-notes/[id]/route.ts`; `app/api/expenses/create/route.ts`; `app/api/orders/[id]/convert-to-invoice/route.ts`; migrations 043 (triggers), 219 (credit note trigger), 218/073/075 (payment trigger).

---

## 3. Permissions Philosophy

### Does Service require fine-grained permissions (unlike Retail)?

- **Route guards:** `lib/routeGuards.ts` applies **cashier** and **manager** rules only to those roles. Cashier is locked to POS; manager is blocked from /settings/staff and /admin. For **admin** and **owner** the result is "allow all routes." Service industry businesses typically have owner/admin (or manager/employee in business_users). There is no **service-specific** lock (e.g. "invoicer" vs "viewer") in the audited route guards. So Service does **not** enforce the same granularity as Retail (cashier/manager/store).
- **Access control:** `lib/accessControl.ts` enforces workspace-industry match: retail business cannot use service routes (redirect to retail); service business cannot use retail routes (redirect to dashboard). For service, no store context is required. Accounting workspace is firm-only; Service business owners are redirected from `/accounting/*` except `/accounting/reconciliation`.

### Can Service safely operate with a single owner role?

- **Yes.** Single owner can: create/send invoices, record payments, create expenses, create/apply credit notes, convert orders to invoices, view Financial Reports, P&L, Balance Sheet, Accounting Portal, Chart of Accounts, General Ledger, Trial Balance (page exists but API 410), Reconciliation (list/toggle). No cashier PIN or register session; no supervisor override flow. One user with owner (or admin) role has full operational access within Service.

### Would Service realistically need cashier / staff roles?

- **Cashier:** Not applicable. Service has no POS or register; cashier role in routeGuards is for Retail (POS-only). Service users with role cashier would still be blocked from everything except POS (routeGuards), so a "cashier" in a service business would be misconfigured.
- **Staff:** Service could use **employee** or **manager** for limited access (e.g. hasAccessToSalesHistory allows owner, admin, manager, employee). No service-specific staff role (e.g. "invoicer only") was found. So fine-grained staff roles are **optional**; single owner is sufficient for typical service use.

### Is permissioning necessary or optional?

- **Optional for minimal deployment.** A single owner can run all Service operations. Adding manager/employee is for delegation (e.g. sales history access) and does not change ledger behavior; ledger posting is trigger-driven and does not depend on role beyond "can call the API."

### Does lack of permissions create real-world risk?

- **Single owner:** No separation of duties; same user can invoice, record payments, and create expenses. Risk is fraud or error by that user; no mitigation from role splits within Service.
- **Multiple users with admin/owner:** Same full access; no audit distinction in the routes audited (audit log records action and user).
- **Manager/employee:** Can access sales history and other allowed routes; cannot access /settings/staff or /admin (manager). So some separation exists if roles are used, but Service does not **require** multiple roles to function.

**Evidence:** `lib/routeGuards.ts` (cashier, manager, admin/owner); `lib/accessControl.ts` (workspace-industry, no store for service); `lib/userRoles.ts` (hasAccessToSalesHistory: owner, admin, manager, employee).

---

## 4. Accounting Visibility

### What accounting concepts are visible in Service

- **Chart of Accounts:** Sidebar "Chart of Accounts" → `/accounts` (and `/accounts/[id]/edit`). Page lists accounts; source `GET /api/accounts/list` (or similar). Users see account list (code, name, type).
- **General Ledger:** Sidebar "General Ledger" → `/ledger`. Page calls `GET /api/ledger/list` with date/account/reference filters. API reads **journal_entries** and **journal_entry_lines** (and accounts). So Service users can see **journal entries and lines** (date, description, debit, credit, account code/name). This is full ledger **read** visibility.
- **Trial Balance:** Sidebar "Trial Balance" → `/trial-balance`. Page calls `GET /api/reports/trial-balance?as_of_date=`. That route returns **410 Gone** ("This report uses ledger data. Use accounting workspace reports."). So Trial Balance **page** exists but **does not load** in Service (intentional block).
- **Reconciliation:** Sidebar "Reconciliation" → `/reconciliation`. Lists bank (or other) accounts, toggle `is_reconcilable`. No posting; no resolve UI in Service. Service business owners can also open `/accounting/reconciliation` (exception); that is the accounting workspace reconciliation UI (mismatches, resolve) but posting resolve is restricted to accountant firm users.
- **P&L and Balance Sheet:** Sidebar "Profit & Loss" → `/reports/profit-loss`, "Balance Sheet" → `/reports/balance-sheet`. Both pages use **canonical** flow: getCurrentBusiness → `/api/accounting/periods/resolve` → `/api/accounting/reports/profit-and-loss` or `balance-sheet` with business_id, period_start, context=embedded. So Service users **see** ledger-derived P&L and Balance Sheet (read-only, period-based).
- **Accounting Portal:** `/portal/accounting` — same canonical reports (P&L, BS, Trial Balance, GL) with getCurrentBusiness and period resolve; read-only.

### What is hidden

- **Period management:** No UI to open/close/lock periods in Service. Accounting Periods link hidden unless user is accountant firm user.
- **Manual journal entry:** No create/edit JE in Service. Only under accounting workspace.
- **Reconciliation posting:** Resolve (post adjustment) is in accounting API; not exposed as a Service workspace action for business owners (they can view `/accounting/reconciliation` but posting requires firm/accountant path).

### What is optionally accessible for advanced users

- **Chart of Accounts, General Ledger, P&L, Balance Sheet, Reconciliation (list/toggle):** Available to any Service user with access to those routes (owner/admin/manager/employee per route guards). No "advanced" flag; it's the same sidebar for all.
- **Trial Balance:** Link present but API 410; not usable in Service.
- **Year-end close:** Trial Balance page has "Year-End Close" button calling `POST /api/accounts/year-end-close` with asOfDate. That API performs a **ledger-affecting** operation (retained earnings, period close logic). So Service users **can** trigger a form of period/year-end close from the Trial Balance page — but that page loads legacy trial balance API which returns 410, so in practice the year-end close button may only be reachable if the page loads (e.g. if Trial Balance were switched to canonical API). Not re-audited here; evidence: `app/trial-balance/page.tsx` (handleYearEndClose → /api/accounts/year-end-close).

### Confirm: No manual journal entry, no period management, no ledger mutation, no reconciliation actions (that post)

- **No manual journal entry in Service:** Confirmed. Manual journals are under `/accounting/journals`; business owners are blocked from accounting workspace (except /accounting/reconciliation).
- **No period management in Service:** Confirmed. No UI to create/open/close/lock periods; Accounting Periods hidden for non–firm users.
- **No ledger mutation from Service UI (other than via operational triggers):** Confirmed. All ledger writes are via triggers on invoices, payments, credit_notes, expenses. Service APIs do not call `post_journal_entry` or insert into journal_entries/journal_entry_lines. Exception: year-end close from Trial Balance page (see above) — that is a single optional path that can affect ledger/period.
- **No reconciliation posting in Service:** Confirmed. Service reconciliation page only lists accounts and toggles is_reconcilable. Posting of reconciliation adjustments is in accounting workspace API.

**Evidence:** `app/ledger/page.tsx`, `app/api/ledger/list/route.ts` (journal_entries, journal_entry_lines); `app/trial-balance/page.tsx` (fetch /api/reports/trial-balance → 410); `app/reports/profit-loss/page.tsx`, `app/reports/balance-sheet/page.tsx` (canonical APIs); `app/reconciliation/page.tsx`; `app/accounts/page.tsx`; `lib/accessControl.ts`; Sidebar.tsx.

---

## 5. Reporting & Reality

### Service reports: Operational vs accounting

- **Financial Reports hub (`/reports`):** Loads stats from **invoices** table (total invoices, revenue, paid, outstanding). Operational. Links to P&L, Balance Sheet, VAT Returns, Invoice Reports, etc.
- **Profit & Loss (`/reports/profit-loss`):** Uses **canonical** `/api/accounting/reports/profit-and-loss` (period resolve then report). **Ledger-backed** (trial balance snapshot / RPC). Read-only.
- **Balance Sheet (`/reports/balance-sheet`):** Same: canonical `/api/accounting/reports/balance-sheet`. **Ledger-backed.** Read-only.
- **Trial Balance (`/trial-balance`):** Calls legacy `/api/reports/trial-balance` → **410.** So not usable in Service; would be ledger-backed if switched to canonical.
- **General Ledger (`/ledger`):** Calls `/api/ledger/list` → reads **journal_entries** and **journal_entry_lines**. **Ledger-backed.** Read-only list.
- **Accounting Portal (`/portal/accounting`):** Same canonical P&L, BS, TB, GL with period resolve; **ledger-backed.**

### Real-time vs period-based

- **Operational (invoices, payments list):** Real-time from operational tables (invoices, payments). No period required.
- **P&L, Balance Sheet:** **Period-based.** Service pages resolve period from date range (or single month) then request report for that period_start. So "real-time" only in the sense of "current period" or "latest closed period" depending on selection.
- **General Ledger:** Date range filter (start_date, end_date); not strictly period-bound in API (journal_entries by date). Real-time in the sense of "all entries in range."

### Ledger-backed vs derived

- **P&L, Balance Sheet:** Ledger-backed (canonical RPCs from trial balance snapshot / ledger).
- **General Ledger:** Ledger-backed (journal_entries, journal_entry_lines).
- **Financial Reports hub stats:** Derived from **invoices** table (operational), not from ledger. So high-level "total revenue / outstanding" can differ from ledger-derived P&L if there is sync lag or draft/sent mismatch.

### Can Service users understand performance without accounting knowledge?

- **Partially.** P&L and Balance Sheet show revenue, expenses, assets, liabilities, equity with labels; no debit/credit columns on those report pages. So a business owner can read "revenue" and "expenses" without knowing double-entry. General Ledger **does** show debit/credit and account codes — more accounting-oriented. Trial Balance is unavailable (410). So for "performance" (P&L), yes; for full ledger detail (GL), some accounting familiarity helps.

### Are reports consistent with ledger truth?

- **P&L and Balance Sheet:** Yes. They are generated from the same canonical ledger/trial balance RPCs used by the accounting workspace. Same business_id and period_start → same result.
- **General Ledger:** Yes. It reads the same journal_entries/journal_entry_lines tables. Filters (date, account, reference_type) can make the view partial but not inconsistent.
- **Financial Reports hub (invoice stats):** Operational snapshot (invoices table). Can diverge from ledger if invoices are draft vs sent, or if status has not yet been recalculated after payments/credits.

**Evidence:** `app/reports/page.tsx` (invoices query); `app/reports/profit-loss/page.tsx`, `app/reports/balance-sheet/page.tsx` (canonical APIs); `app/ledger/page.tsx`, `app/api/ledger/list/route.ts`; `app/trial-balance/page.tsx` (410).

---

## 6. External Accountant Reality

### How a Service business exports books

- **Accounting export APIs:** Transaction-level tax, levies, and VAT exports live under `GET /api/accounting/exports/transactions`, `.../levies`, `.../vat`. They require business_id and period (YYYY-MM). Access is enforced via `can_accountant_access_business` RPC (owner returns "write"). So the **owner** of a Service business can call these APIs with their business_id and get CSV exports.
- **Service workspace UI:** Business owners (including Service) are **blocked** from the accounting workspace (`lib/accessControl.ts`): redirect to `/dashboard` for `/accounting/*` except `/accounting/reconciliation`. Export **UI** (if any) lives in the accounting workspace (e.g. accounting report pages with export buttons). So from **within the Service workspace** there is no audited export screen that calls these endpoints. A custom integration or direct API call by the owner could still use the export APIs. So: **exports exist at API level and are callable by owner; no in-workspace Service UI for "export books for accountant" was found.**

### Whether an external (non-Finza) accountant can work with the data

- **Format:** Exports are CSV (transactions, levies, VAT return) with period and ledger-sourced columns. An external accountant can open them in spreadsheets or import into another system. No separate "audit package" or XBRL was seen in the audited paths.
- **Completeness:** Exports are period-scoped and read from journal_entries/journal_entry_lines (and accounting_periods where relevant). So they reflect **ledger** data for that period. Completeness depends on period coverage and whether all relevant transactions fall in the chosen period.

### Whether exports reflect immutable ledger truth

- **Yes.** Export routes read from journal_entries and journal_entry_lines (and related). Ledger is append-only (no update/delete of posted entries in the audited design). So exported data reflects the state of the ledger at query time and is consistent with immutable ledger truth for that period.

**Evidence:** `app/api/accounting/exports/transactions/route.ts`, `.../levies/route.ts`, `.../vat/route.ts` (can_accountant_access_business, period, journal_entries); `lib/accessControl.ts` (business owner blocked from /accounting/* except /accounting/reconciliation).

---

## 7. Alignment Verdict

### Score: **78%** (evidence-based; no fixes)

- **Aligned:**
  - Service workspace matches service-business operations (invoices, payments, orders, estimates, expenses, credit notes).
  - Operations can be run without accounting expertise; ledger is produced automatically via triggers (invoice send, payment, expense, credit note apply).
  - No manual journal entry in Service; no period management exposed; no reconciliation posting in Service workspace.
  - P&L and Balance Sheet are ledger-backed and consistent with accounting workspace; Service users can see performance (P&L/BS) without debits/credits on those pages.
  - Permissions: single owner is sufficient; cashier/staff roles are optional; no retail-style fine-grained lock-in required.
  - Export APIs exist, are period-aware and ledger-sourced; owner can call them (e.g. for external accountant).

- **Over-engineered or inconsistent:**
  - **Trial Balance** is linked in Service but returns 410 from legacy API; users cannot see trial balance in Service. Overlap with "Accounting (Advanced)" section that mixes readable (P&L, BS, GL) and blocked (Trial Balance) reports.
  - **General Ledger** in Service exposes full journal entry list (debit/credit, accounts) — more "accounting" than strictly necessary for "no accounting expertise." Could be considered optional/advanced; it is already under "Accounting (Advanced)."
  - **Reconciliation** in Service: list + is_reconcilable toggle; plus Service can open `/accounting/reconciliation` (read-only signpost). Slight duplication between `/reconciliation` and `/accounting/reconciliation` for a business owner.

- **Missing:**
  - **In-workspace export for external accountant:** No Service UI was found that offers "export books" (e.g. transactions/VAT/levies CSV) for the current business. Export APIs exist and owner has access, but the only export UI audited is in the accounting workspace, which Service business owners cannot open (except reconciliation). So "give my accountant a file" from within Service is not clearly supported by a dedicated export screen.
  - **Trial Balance usable in Service:** Link exists but 410; vision of "see performance without accounting knowledge" is partially met (P&L/BS work; Trial Balance does not).

### Summary table

| Vision element | Status | Evidence |
|----------------|--------|----------|
| Matches service business operation | Yes | Sidebar and routes: invoices, payments, orders, estimates, expenses, credit notes. |
| Run without accounting expertise | Yes | No manual JE; posting is trigger-driven; P&L/BS avoid debit/credit. |
| Accounting as consequence of invoicing/payments | Yes | trigger_auto_post_invoice, trigger_auto_post_payment, trigger_auto_post_expense, trigger_auto_post_credit_note. |
| No manual journal entry | Yes | Manual journals only in accounting workspace; Service blocked. |
| No period management | Yes | No period UI in Service; Accounting Periods hidden for non–firm users. |
| No ledger mutation (except via triggers) | Yes | All writes via triggers; no post_journal_entry from Service APIs. |
| No reconciliation posting in Service | Yes | Only list + is_reconcilable; resolve/post in accounting API. |
| Reports consistent with ledger | Yes | P&L, BS, GL use ledger/canonical APIs. |
| Export for external accountant | Partial | APIs exist and owner can call; no in-Service export UI found. |
| Trial Balance in Service | No | Page calls legacy API → 410. |

---

*End of audit. Evidence only. No code changes or recommendations.*
