# Workspace Architecture Audit — Finza

**Audit type:** Principal systems architect — evidence only. No fixes, no refactors, no code changes.  
**Date:** 2025-01-31.  
**Scope:** Retail, Service, and Accounting-first workspaces; alignment with stated vision.

---

## A) WORKSPACE BOUNDARIES

### Workspace determination

- **Source:** `lib/accessControl.ts` — `getWorkspaceFromPath(pathname)`.
- **Rules:**
  - `/accounting/*` → `"accounting"`.
  - `/pos`, `/inventory`, `/sales`, `/retail`, `/admin/retail` → `"retail"`.
  - All other authenticated paths → `"service"`.
- **Evidence:** `accessControl.ts` lines 36–60.

### A.1 Retail workspace

| Aspect | Evidence |
|--------|----------|
| **Entry routes** | `/retail/dashboard` (default home for admin/owner/manager per `routeGuards.ts`), `/pos`, `/sales/*`, `/inventory`, `/admin/retail/*`. |
| **Sidebar / navigation** | `components/Sidebar.tsx`: when `businessIndustry === "retail"`, menu includes Retail Operations (Dashboard, POS, Open/Close Register), Product & Inventory, Sales & Reports (Analytics, Sales History, Register Reports, VAT Report), Customers & Suppliers, Settings. No P&L/Balance Sheet/Trial Balance in sidebar; "Register Reports" → `/reports/registers`, "VAT Report" → `/reports/vat`. |
| **APIs for reports** | Register Report page `app/reports/registers/page.tsx` calls `GET /api/reports/registers?start_date=&end_date=`. That route returns **410** with `LEDGER_READ_BLOCKED` (evidence: `app/api/reports/registers/route.ts` lines 37–42). VAT report: `app/reports/vat/page.tsx` — not traced in this audit. |
| **APIs for ledger / periods** | No use of `/api/accounting/reports/*` or `/api/accounting/periods/*` from Retail UI in the paths audited. Retail is blocked from legacy ledger reports (410). |
| **Actions** | Posting (sales, inventory) allowed. Period close, reconciliation, adjustments are not in Retail UI; access to `/accounting/*` is blocked for retail businesses in `accessControl.ts` (redirect to `/retail/dashboard`). |

**Difference type:** Legacy report endpoints are **API-level** and **intentional** 410 blocks. Retail has no UI that calls canonical accounting report APIs.

### A.2 Service workspace

| Aspect | Evidence |
|--------|----------|
| **Entry routes** | `/dashboard` (default for service industry), `/invoices`, `/estimates`, `/orders`, `/customers`, `/reports`, `/reports/profit-loss`, `/reports/balance-sheet`, `/portal/accounting`, `/ledger`, `/trial-balance`, etc. |
| **Sidebar** | `Sidebar.tsx` when `businessIndustry === "service"`: SERVICE OPERATIONS, FINANCE & REPORTING (Accounting Portal, P&L, Balance Sheet, VAT Returns, Financial Reports, Credit Notes, Bills, Assets, Payroll), ACCOUNTING (Advanced) (Chart of Accounts, General Ledger `/ledger`, Trial Balance `/trial-balance`, Accounting Periods only if `isAccountantFirmUser`, Reconciliation), SETTINGS. |
| **APIs for reports** | **P&L:** `app/reports/profit-loss/page.tsx` uses `getCurrentBusiness`, then `GET /api/accounting/periods/resolve?business_id=&from_date=&to_date=`, then `GET /api/accounting/reports/profit-and-loss?business_id=&period_start=&context=embedded`. **Balance Sheet:** `app/reports/balance-sheet/page.tsx` same pattern: resolve then `GET /api/accounting/reports/balance-sheet`. **Trial Balance:** `app/trial-balance/page.tsx` calls `GET /api/reports/trial-balance?as_of_date=` — that route returns **410** (evidence: `app/api/reports/trial-balance/route.ts`). **General Ledger:** `app/ledger/page.tsx` calls `/api/ledger/list` and `/api/accounts/list` (not `/api/accounting/reports/general-ledger`). **Portal:** `app/portal/accounting/page.tsx` uses `getCurrentBusiness` and calls `/api/accounting/reports/*` with that business_id. |
| **APIs for periods** | Service P&L and Balance Sheet pages call `/api/accounting/periods/resolve`. Period resolve uses `getUserRole` + `isUserAccountantReadonly` only (no firm RPC). |
| **Actions** | Read-only messaging on P&L/Balance Sheet pages ("Read-only report (Accounting). Same data as Accounting workspace."). Posting and period actions not exposed there. |

**Difference type:** P&L and Balance Sheet in Service use **canonical** accounting APIs and can load for business owners. Trial Balance in Service uses **legacy** API → **410 (INTENTIONAL BLOCK)**. General Ledger in Service uses a different API (`/api/ledger/list`), not the canonical GL report API.

### A.3 Accounting-first workspace

| Aspect | Evidence |
|--------|----------|
| **Entry routes** | `/accounting`, `/accounting/ledger`, `/accounting/periods`, `/accounting/reports/*`, `/accounting/firm`, `/accounting/firm/clients`, etc. Access to `/accounting/*` is restricted in `accessControl.ts`: only users with a row in `accounting_firm_users` are allowed; business owners without firm membership are redirected (Retail → `/retail/dashboard`, Service → `/dashboard`). Exception: Service business owners may access `/accounting/reconciliation` only (lines 166–168). |
| **Sidebar** | When path is `/accounting` and `getActiveClientBusinessId()` is set, sidebar uses client business industry (e.g. hide service/POS for books-only). Accounting UI has its own layout/menus (e.g. `app/accounting/page.tsx` menu items: General Ledger, Accounting Periods, Trial Balance, Reports, etc.). |
| **APIs for reports** | Accounting report pages under `app/accounting/reports/*` (profit-and-loss, balance-sheet, trial-balance, general-ledger) call `GET /api/accounting/reports/*` with `business_id`. **Business context:** These pages use **getCurrentBusiness(supabase, user.id)** only (evidence: `app/accounting/reports/profit-and-loss/page.tsx` loadBusiness, same for balance-sheet, trial-balance, general-ledger, and `app/accounting/periods/page.tsx`). They do **not** use `getActiveClientBusinessId()`. |
| **APIs for ledger / periods** | Periods list: `GET /api/accounting/periods?business_id=` — this route uses **can_accountant_access_business** RPC (supports owner + firm client). Reports and period resolve do **not** use that RPC; they use **getUserRole** and **isUserAccountantReadonly** only. |
| **Actions** | Close period, reopen, adjustments, journals, opening balances, reconciliation, AFS, etc. are available in Accounting UI. Authority enforced via `lib/firmAuthority.ts` and firm RPCs where used. |

**Difference type:** Accounting **report** APIs and **period resolve** use **business_users/owner only** (getUserRole, isUserAccountantReadonly). Accounting **periods** (list/close/readiness) and **trial-balance** route use **can_accountant_access_business**, so firm users can access those with a client business_id. **Inconsistency:** Report routes do not accept firm-based access; report pages do not use active client session for business_id.

---

## B) REPORTING PATHS (CRITICAL)

### B.1 Report pages by workspace

| Workspace | Page route | API called | Expected inputs | Actual behavior |
|-----------|------------|------------|----------------|-----------------|
| **Service** | `/reports/profit-loss` | `/api/accounting/periods/resolve`, `/api/accounting/reports/profit-and-loss` | business_id (from getCurrentBusiness), period via resolve, period_start, context=embedded | Loads successfully when user is owner/admin/accountant for business and period exists. |
| **Service** | `/reports/balance-sheet` | `/api/accounting/periods/resolve`, `/api/accounting/reports/balance-sheet` | Same | Same. |
| **Service** | `/trial-balance` | `/api/reports/trial-balance?as_of_date=` | as_of_date | **410** — INTENTIONAL BLOCK. |
| **Service** | `/ledger` | `/api/ledger/list`, `/api/accounts/list` | start_date, end_date, account_id, reference_type | Not blocked by 410; different API from canonical GL report. |
| **Service** | `/portal/accounting` | `/api/accounting/reports/*` (P&L, BS, TB, GL) | business_id from getCurrentBusiness, period_start from resolve | Works for business owners; same auth as report APIs. |
| **Retail** | `/reports/registers` | `/api/reports/registers?start_date=&end_date=` | start_date, end_date | **410** — INTENTIONAL BLOCK. |
| **Accounting** | `/accounting/reports/profit-and-loss` | `/api/accounting/periods?business_id=`, `/api/accounting/reports/profit-and-loss` | business_id from **getCurrentBusiness** (not active client), period_start | Loads only when user has a **current business** (owner or business_users). Firm-only users get no business_id → "Business not found" or empty. |
| **Accounting** | `/accounting/reports/balance-sheet` | Same pattern | Same | Same. |
| **Accounting** | `/accounting/reports/trial-balance` | Same pattern | Same | Same. |
| **Accounting** | `/accounting/reports/general-ledger` | Same + `/api/accounting/coa` | Same | Same. |

### B.2 API endpoints summary

| Endpoint | Expected inputs | Access check | Firm user with client business_id |
|----------|-----------------|-------------|-----------------------------------|
| GET /api/accounting/reports/profit-and-loss | business_id, period_start | getUserRole, isUserAccountantReadonly | **403** (no business_users row for client). |
| GET /api/accounting/reports/balance-sheet | business_id, period_start | Same | **403**. |
| GET /api/accounting/reports/trial-balance | business_id, period_start | Same | **403**. |
| GET /api/accounting/reports/general-ledger | business_id, account_id, period_start or start_date/end_date | Same | **403**. |
| GET /api/accounting/periods/resolve | business_id, from_date, to_date | Same | **403**. |
| GET /api/accounting/periods | business_id | **can_accountant_access_business** RPC | 200 when firm has client access. |
| GET /api/reports/profit-loss, balance-sheet, trial-balance, registers, vat-control, sales-summary, tax-summary, aging | (N/A — blocked) | — | **410** before any logic. |

### B.3 Failure classification (per REPORT_FAILURE_CLASSIFICATION.md)

- **INTENTIONAL BLOCK:** Legacy `/api/reports/*` (profit-loss, balance-sheet, trial-balance, vat-control, registers, sales-summary, tax-summary, aging) return 410 with message to use accounting workspace. Evidence: unconditional return at top of each route.
- **AUTHORIZATION:** Accounting report APIs return 403 when user is not admin/owner/accountant for the given business_id. For firm users, getUserRole(userId, clientBusinessId) is null and isUserAccountantReadonly is false → 403.
- **DATA ABSENCE:** 400/404/500 when period_start missing, period not found, ensure_accounting_period fails, or RPC fails.
- **CONFIGURATION:** 400 for missing business_id or period_start.

---

## C) ACCOUNTING-FIRST WORKSPACE CAPABILITIES

### Business context selection

- **Firm client list and switcher:** `app/accounting/firm/page.tsx` lists clients and calls `setActiveClientBusinessId(client.business_id, client.business_name)` then `router.push(\`/accounting?business_id=${client.business_id}\`)`. So **client selection is stored in sessionStorage** via `lib/firmClientSession.ts` and URL can carry business_id.
- **Report and period pages:** `app/accounting/reports/*`, `app/accounting/periods/page.tsx`, `app/accounting/chart-of-accounts/page.tsx`, `app/accounting/opening-balances/page.tsx`, `app/accounting/carry-forward/page.tsx`, `app/accounting/adjustments/page.tsx`, `app/accounting/trial-balance/page.tsx`, `app/accounting/exceptions/page.tsx`, `app/accounting/afs/page.tsx`, `app/accounting/adjustments/review/page.tsx` all use **getCurrentBusiness(supabase, user.id)** to set businessId. They do **not** read getActiveClientBusinessId().
- **Pages that use active client:** `app/accounting/opening-balances-imports/*`, `app/accounting/journals/*`, `app/accounting/drafts/page.tsx` use **getActiveClientBusinessId()** for business context.

**Evidence:** Grep for getCurrentBusiness vs getActiveClientBusinessId in `app/accounting` (see A.3 and grep results).

### Multi-business access

- **API support:** `/api/accounting/periods`, `/api/accounting/periods/close`, readiness, reopen, `/api/accounting/trial-balance` (YYYY-MM), exports, opening-balances (with firm onboarding check) use **can_accountant_access_business** or firm onboarding RPCs, so they accept a client business_id and allow firm users.
- **Report and resolve APIs:** Do **not** use can_accountant_access_business or checkFirmClientAccess; they use getUserRole + isUserAccountantReadonly only. So for a firm user, passing client business_id to report or resolve yields **403**.

### Assumption: accountant as business_user

- **Access control:** `lib/accessControl.ts` allows access to `/accounting/*` if user has a row in `accounting_firm_users` (no business required). So accountants are **not** required to be business_users to enter the workspace.
- **Once inside:** Report and period-resolve logic assumes the **caller** has a role or accountant_readonly for the **business_id** in the request (business_users or owner). Firm users do not have business_users rows for client businesses, so report and resolve treat them as unauthorized for client business_id.

### Capabilities present

- **Reviewing client ledgers:** Periods list, trial-balance (YYYY-MM route), exports use can_accountant_access_business → firm users can use these with client business_id. Report **pages** in the app do not pass client business_id (they use getCurrentBusiness), so in practice firm users do not see client reports in the Accounting report UI.
- **Reconciliation:** Reconciliation page uses getCurrentBusiness; reconciliation APIs not fully traced here.
- **Posting adjustments, closing periods:** Present in Accounting UI; authority via firmAuthority and RPCs (e.g. periods/close, journals/drafts, opening-balances).

### Verdict

- **Multi-client switcher exists** (firm page → setActiveClientBusinessId → navigate). **Report and core period UI** do not use that context; they use getCurrentBusiness only. So for **reports and periods page**, Accounting-first behaves as **single-business (current user’s business)**. Other flows (opening-balances-imports, journals, drafts) use active client.
- **API inconsistency:** Periods (and related) APIs support firm access via can_accountant_access_business; report and resolve APIs do not. So Accounting-first is **partially** a multi-client portal: write/period flows can use client context; read report flows do not accept firm-based access and UI does not pass client context to them.

---

## D) DELEGATION MODEL (OR LACK THEREOF)

### Evidence of delegation

- **Tables:** `accounting_firm_users` (user–firm), `accounting_firm_clients` (firm–business, access_level: read/write/approve). Evidence: `lib/firmClientAccess.ts` (accounting_firm_clients), `supabase/migrations/142_accounting_firms_step8_1.sql`, `lib/firmAuthority.ts`.
- **RPC:** `can_accountant_access_business(p_user_id, p_business_id)` returns owner or firm-client access_level. Migration 105 uses `accountant_firm_users` and `accountant_client_access`; later migrations use `accounting_firm_users` and `accounting_firm_clients`. Application code uses accounting_firm_*.
- **Application:** `checkFirmClientAccess(supabase, userId, businessId)` in `lib/firmClientAccess.ts` returns read/write/approve for firm client access (or write for owner). Used in firm bulk AFS/preflight routes. **Not** used in accounting report or period-resolve routes.
- **Session:** Active client stored in sessionStorage via `lib/firmClientSession.ts` (getActiveClientBusinessId, setActiveClientBusinessId).

### Where delegation is used vs not

- **Used:** Periods list/close/readiness/reopen, trial-balance (YYYY-MM), exports (transactions, levies, VAT), opening-balances (with firm onboarding), firm bulk AFS/preflight, journals/drafts (firm context). Evidence: grep for can_accountant_access_business and checkFirmClientAccess in `app/api/accounting`.
- **Not used:** All routes under `/api/accounting/reports/*` and `/api/accounting/periods/resolve`. They rely only on getUserRole and isUserAccountantReadonly (business_users / owner).

### Explicit statement

- **Delegation exists** at DB and RPC level (firm_users, firm_clients, can_accountant_access_business) and is used for periods, trial-balance, exports, opening-balances, journals, etc.
- **Accounting report and period-resolve APIs do not implement delegation.** They only allow access when the user is owner or has a business_users row (or accountant_readonly) for the given business_id. So **for viewing client P&L, Balance Sheet, Trial Balance, General Ledger via the canonical report APIs, accountants must currently have a business_users link to that business (i.e. be treated as business_user for that client), or the limitation is that firm users get 403 when calling those endpoints with client business_id.**
- **Architectural limitation:** Report and resolve are the main “read client books” paths. Without accepting can_accountant_access_business (or equivalent) in those routes, the system does not fully support “accountant views client reports by delegation only.” The UI also does not pass client business_id into report pages (getCurrentBusiness only), so even if APIs were extended, the current Accounting report pages would not show client data for firm-only users.

---

## E) LEDGER & PERIOD AUTHORITY CHECK

### Single ledger

- **Canonical reporting:** P&L, Balance Sheet, Trial Balance use `get_profit_and_loss_from_trial_balance`, `get_balance_sheet_from_trial_balance`, `get_trial_balance_from_snapshot` (period_id). These read from **trial_balance_snapshots** and/or period-bound snapshot generation (migrations 169, 234). General Ledger uses `get_general_ledger` / `get_general_ledger_paginated` (journal_entries, journal_entry_lines). Evidence: route files under `app/api/accounting/reports/` and migrations.
- **Tables:** Single set of ledger tables (e.g. journal_entries, journal_entry_lines, trial_balance_snapshots, accounting_periods) per business. No evidence of workspace-specific or duplicated ledgers.

### Bypass of canonical APIs

- **Service P&L/Balance Sheet:** Use canonical `/api/accounting/reports/*` and period resolve. No bypass.
- **Service Trial Balance:** Calls legacy `/api/reports/trial-balance` → 410; no canonical path used from that page.
- **Service Ledger:** Uses `/api/ledger/list` (not the accounting general-ledger report API). Possible alternate path; not confirmed whether it reads same ledger tables.
- **Retail Register Report:** Calls `/api/reports/registers` → 410. No canonical accounting report used from Retail for this.

### Where authority is enforced

- **DB/RLS:** Not fully audited. Ledger and snapshot access are scoped by business_id and period in RPCs.
- **API:**  
  - **Report and resolve:** Authority = getUserRole + isUserAccountantReadonly (owner or business_users for that business_id). Enforced in each report route and in `app/api/accounting/periods/resolve/route.ts`.  
  - **Periods (list/close/readiness/reopen), trial-balance route, exports:** can_accountant_access_business (owner or firm-client).
- **UI:**  
  - **accessControl.ts:** Only firm users can access `/accounting/*`; business owners (retail/service) are redirected except Service → `/accounting/reconciliation`.  
  - **routeGuards.ts:** accountant_readonly restricted to allowed accounting routes; cashier/manager blocks.  
  - **Sidebar:** Hides Accounting Periods for non–firm users; shows P&L/Balance Sheet under Service; Trial Balance link in Service goes to a page that hits 410.

### Blocking of Service/Retail reports

- **Missing period resolution:** Service P&L/Balance Sheet resolve period then call report; if no period exists, resolve returns 404 and page shows message (no redirect to accounting).
- **Intentional 410:** Legacy `/api/reports/*` (including trial-balance, registers) return 410; no redirect, just error.
- **UI assumption:** Sidebar and pages do not redirect “to accounting workspace” on error; they show errors. The 410 response body says “Use accounting workspace reports,” which is a message, not a redirect.

---

## F) ALIGNMENT VERDICT

| Requirement from vision | Status | Evidence |
|-------------------------|--------|----------|
| Retail, Service, Accounting-first are distinct products, not just skins | **PARTIAL** | Distinct routes and access (accessControl: accounting firm-only, retail/service by industry). Shared sidebar driven by industry; Accounting has separate entry and firm-only access. |
| Retail and Service can view their own financial reports (P&L, BS, TB, GL) from live ledger without redirect/block/“use accounting workspace” errors | **PARTIAL** | **Service:** P&L and Balance Sheet use canonical APIs and can load for owners. **Service Trial Balance** uses legacy API → **410**. **Service GL** uses `/api/ledger/list`, not canonical GL report. **Retail:** No P&L/BS/TB in sidebar; Register Report → 410. |
| Reports may be read-only but must load | **PARTIAL** | Service P&L/BS load (read-only). Service Trial Balance and Retail Register Report do not load (410). |
| Accounting-first is accountant portal for multiple client businesses | **PARTIAL** | Multi-client list and active-client session exist; periods/trial-balance/exports/journals/opening-balances use firm access. Report **APIs** do not accept firm access; report **pages** use getCurrentBusiness only, so firm-only users cannot see client reports in UI. |
| Access via delegation, not converting accountants to business users | **PARTIAL** | Delegation exists (firm_clients, can_accountant_access_business) and is used for periods, TB, exports, journals. Report and resolve do **not** use it; for those, effective model is “must be owner or business_user for that business.” |
| Ledger is single source of truth; no duplicated or workspace-specific ledgers | **YES** | Single canonical RPCs and tables per business; no workspace-specific ledger found. |
| Periods, reconciliation, adjustments are accounting-controlled; visibility of reports allowed in client workspaces | **PARTIAL** | Period close/reopen and adjustments are in Accounting and guarded. Service can **view** P&L/BS via canonical APIs. Service Trial Balance visibility is blocked (410). |

### Direct answers

1. **Can Service and Retail see their own live financial reports today?**  
   **Service:** P&L and Balance Sheet **yes** (canonical APIs, same ledger). Trial Balance **no** (410). General Ledger page uses a different API (`/api/ledger/list`), not the canonical GL report.  
   **Retail:** No UI for P&L/BS/TB; Register Report returns 410.

2. **Is Accounting-first truly a multi-client accountant portal?**  
   **Partially.** Firm users can switch clients and use periods, trial-balance (YYYY-MM), exports, journals, opening-balances with client context. They **cannot** view client P&L/BS/TB/GL through the Accounting report pages/APIs because those use getCurrentBusiness and do not accept firm-based access.

3. **Is access delegation architecturally supported or missing?**  
   **Supported** for periods, trial-balance route, exports, opening-balances, journals. **Missing** for report and period-resolve APIs; there they rely only on business_users/owner.

4. **Are report failures intentional design or side-effects?**  
   **410s** on legacy `/api/reports/*` are **intentional** (unconditional return with “use accounting workspace” message). **403s** for firm users on `/api/accounting/reports/*` are a **side-effect** of using only getUserRole/isUserAccountantReadonly (no delegation in those routes). **Service Trial Balance** failure is intentional block of legacy route; the intended path would be canonical API, but the Service Trial Balance page does not call it.

5. **Does the current system match the stated vision?**  
   **Partially.** Single ledger and read-only visibility for Service P&L/BS match. Gaps: Service Trial Balance and Retail Register Report blocked (410); Accounting report APIs and UI do not support delegated multi-client read; report/resolve do not use the same delegation model as periods and other accounting APIs.

---

*End of audit. No code or behavior changes. Unclear areas marked UNKNOWN or PARTIAL with evidence.*
