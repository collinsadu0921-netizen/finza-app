# Service Workspace Bug Table

**Scope:** Service workspace only (industry = "service").  
**Mode:** Evidence-only; no fixes.  
**Audit dimensions:** Business context, new-business (zero data) behavior, ledger dependency, permission/authority drift, UI copy, navigation.

---

## Summary

| Area | Page | Bug Type | Symptom | Root Cause Class | Severity |
|------|------|----------|---------|------------------|----------|
| Reports | /reports/vat | Dead navigation / Hard dependency | API returns 410 "This report uses ledger data. Use accounting workspace reports."; page shows error | Service route calls blocked ledger API | High |
| Reports | /reports/profit-loss | Bootstrap gap (potential) | "No accounting period covers the selected dates." on new business with zero periods | Page calls period resolve before any bootstrap; resolve may 404 if ensure_accounting_period fails when no periods exist | Medium |
| Reports | /reports/balance-sheet | Bootstrap gap (potential) | Same as P&L | Same | Medium |
| Reconciliation | /api/reconciliation/accounts | Permission misfire / Security | Auth commented out ("AUTH DISABLED FOR DEVELOPMENT"); unauthenticated or missing user falls back to first business in DB | Intended dev shortcut left in; wrong business context for multi-tenant | Blocker (if prod) |
| Reconciliation | /api/reconciliation/[accountId]/transactions | Permission misfire / Security | Same as above | Same | Blocker (if prod) |
| Recurring Invoices | /invoices/recurring | UI semantic error | "Permission denied. The recurring_invoices table may have RLS enabled. Please disable RLS or check your policies." / "Permission denied. Please ensure RLS policies are configured correctly or disabled for development." | RLS/error path surfaces dev-oriented, permission-flavoured copy in Service | Medium |
| Trial Balance | /trial-balance | UI semantic risk | "⚠ Ledger is Not Balanced" can show when snapshot/calculation returns unbalanced for edge case (e.g. empty or partial data); default isBalanced=true mitigates zero-data case | Ambiguity between "no data yet" and "ledger error"; API isBalanced drives message | Low |
| Dashboard | /dashboard | Ledger dependency | Calls `/api/accounting/reconciliation/mismatches`; no bootstrap. Empty/missing ledger handled by API (returns empty); 403/500 would surface as generic error | Read-only; acceptable if accounting API allows Service owner | Low |
| Portal | /portal/accounting | Context | Uses resolveAccountingBusinessContext (URL → session client → getCurrentBusiness). Service single-business user gets owner context; no "Select a client" on this page (that copy is only in /accounting/*) | Correct for Service; no bug | — |
| Ledger | /ledger | — | Uses getCurrentBusiness via API fallback; ensureAccountingInitialized in /api/ledger/list; empty state: "No journal entries found" | Correct | — |
| Trial Balance API | /api/reports/trial-balance | — | ensureAccountingInitialized + getCurrentBusiness; bootstrap runs | Correct | — |
| Reconciliation page | /reconciliation | — | Empty state: "No accounts found. Please create accounts first in the Chart of Accounts."; no firm-only copy | Correct | — |
| Reconciliation [accountId] | /reconciliation/[accountId] | — | Loads account + transactions; 404 "Account not found" if bad id; no firm-only copy | Correct | — |

---

## 1. Business context resolution

- **Service pages** (dashboard, orders, invoices, customers, expenses, bills, payments, credit-notes, reports, ledger, trial-balance, reconciliation, portal/accounting) use **getCurrentBusiness** (or API that falls back to it). No Service page uses **resolveAccountingBusinessContext** except **/portal/accounting**, which falls back to getCurrentBusiness when there is no URL/session client, so single-business Service users get correct context.
- **"Select a client"** and similar firm-only copy appear only under **/accounting/** (e.g. accounting/ledger, accounting/periods, accounting/chart-of-accounts). They do **not** appear on Service routes /ledger, /trial-balance, /reconciliation.
- **Failure when no business:** Pages that call getCurrentBusiness (or APIs using it) show "Business not found", redirect to login, or show "Failed to load...". No Service page was found to depend on firm-only context for normal operation.

---

## 2. New business (zero data) behavior

| Page | Loads? | Empty state shown? | Error shown? | Correct semantics? |
|------|--------|--------------------|--------------|---------------------|
| /dashboard | Yes (if business) | N/A (stats can be zero) | Yes on load failure | Yes |
| /orders, /orders/new, /orders/[id]/view | Yes | Yes (empty list / empty state) | Yes on API failure | Yes |
| /invoices, /invoices/new, /invoices/[id]/view, /invoices/[id]/edit | Yes | Yes | Yes on API failure | Yes |
| /customers, /customers/new | Yes | Yes | Yes | Yes |
| /expenses, /expenses/new | Yes | Yes | Yes | Yes |
| /bills, /bills/new | Yes | Yes | Yes | Yes |
| /payments | Yes | Yes | Yes | Yes |
| /credit-notes | Yes | Yes | Yes | Yes |
| /reports | Yes | Yes (stats) | Yes | Yes |
| /reports/profit-loss | Yes* | Yes (empty revenue/expenses) | **Yes: "No accounting period covers the selected dates."** if period resolve 404s (new business, zero periods) | **No:** Error instead of "no data yet" when no period |
| /reports/balance-sheet | Yes* | Yes (empty sections) | **Same as P&L** | **No:** Same period gap |
| /reports/vat | Yes | N/A | **Yes: 410 from API** — "This report uses ledger data. Use accounting workspace reports." | **No:** Blocked route, firm-oriented message |
| /reports/vat/diagnostic | Yes | Yes | Yes | Yes (retail/sales diagnostic) |
| /portal/accounting | Yes | Yes (tabs empty) | Yes if NO_CONTEXT | Yes |
| /ledger | Yes | **Yes: "No journal entries found"** | Yes on API failure | Yes |
| /trial-balance | Yes | Yes (empty accounts) | Yes on API failure | Yes (isBalanced default true for zero data) |
| /reconciliation | Yes | **Yes: "No accounts found. Please create accounts first in the Chart of Accounts."** | Yes on API failure | Yes |
| /reconciliation/[accountId] | Yes | Yes (empty transactions) | 404 "Account not found" if invalid id | Yes |

\* P&L and Balance Sheet load only after period resolve succeeds; for new business with no periods, resolve can 404 (depending on ensure_accounting_period behavior), so page shows error instead of empty report.

---

## 3. Ledger dependency audit

- **Service pages calling /api/accounting/**  
  - **Dashboard:** GET `/api/accounting/reconciliation/mismatches?businessId=...&limit=1` — read-only; no mutation.  
  - **Reports P&L:** GET `/api/accounting/periods/resolve`, then GET `/api/accounting/reports/profit-and-loss` — read-only.  
  - **Reports Balance Sheet:** GET `/api/accounting/periods/resolve`, then GET `/api/accounting/reports/balance-sheet` — read-only.  

- **Service pages calling /api/ledger/**  
  - **Ledger:** GET `/api/ledger/list` — read-only; uses ensureAccountingInitialized; fallback business_id from getCurrentBusiness.  

- **Service pages calling /api/reports/**  
  - **Trial balance:** GET `/api/reports/trial-balance` — read-only; ensureAccountingInitialized in API.  
  - **VAT Control:** GET `/api/reports/vat-control` — **returns 410** with message "This report uses ledger data. Use accounting workspace reports." — effectively blocked for Service.  

- **Findings:**  
  - No Service route was found to perform ledger **writes** via these APIs.  
  - Snapshot/trial balance is read from canonical RPC; empty system returns empty data after bootstrap.  
  - **"Ledger is Not Balanced"** on /trial-balance is driven by API `isBalanced`; page defaults isBalanced to true, so zero-data case usually shows "Ledger is Balanced". Only if API returns isBalanced false for an edge case would the warning show (possible UX confusion with "no data yet").  

---

## 4. Permission & authority drift

- **checkAccountingAuthority** is used by `/api/ledger/list` and by accounting APIs; Service report pages use `/api/reports/*` or `/api/accounting/reports/*` with getCurrentBusiness and (where applicable) checkAccountingAuthority in the API. Owner and allowed roles (e.g. admin, accountant) are authorized for read.  
- **Reconciliation:**  
  - **GET/PUT `/api/reconciliation/accounts`** and **GET `/api/reconciliation/[accountId]/transactions`** have **auth commented out** ("AUTH DISABLED FOR DEVELOPMENT") and fall back to **first business in DB** when user is missing. This is a **permission/context bug** if these routes are used in production.  
- No Service page was found to use **can_accountant_access_business** in a way that would block legitimate Service users; accounting APIs use checkAccountingAuthority, which supports owner and employee roles.

---

## 5. UI copy & messaging integrity

- **Wrong in Service (flagged):**  
  - **/invoices/recurring:** "Permission denied. The recurring_invoices table may have RLS enabled. Please disable RLS or check your policies." and "Permission denied. Please ensure RLS policies are configured correctly or disabled for development." — dev/RLS wording; can be read as user permission denial.  
  - **/reports/vat:** API 410 body: "This report uses ledger data. Use accounting workspace reports." — firm-oriented; suggests user should use another workspace.  

- **Correct / not flagged:**  
  - "No accounting period covers the selected dates." (P&L, Balance Sheet) — describes state, but see Bootstrap gap.  
  - "No accounts found. Please create accounts first in the Chart of Accounts." (reconciliation) — appropriate for Service.  
  - "No journal entries found" (ledger) — appropriate.  
  - "Business not found", "Failed to load...", "Account not found" — appropriate.  

- **"Select a client"** appears only in **/accounting/** pages; not in Service routes.

---

## 6. Navigation & dead ends

- **Sidebar (Service):** Links to /dashboard, /invoices, /payments, /estimates, /orders, /recurring, /customers, /products, /expenses; /portal/accounting, /reports/profit-loss, /reports/balance-sheet, /vat-returns, /reports, /credit-notes, /bills; /accounts, /ledger, /trial-balance, /reconciliation (and conditional /accounting/periods). All resolve to existing app routes.  
- **Dead end:**  
  - **/reports/vat** (VAT Control): Page exists and is reachable (e.g. by URL). It calls `/api/reports/vat-control`, which **always returns 410**. User sees an error and firm-oriented message; no way to get the report in Service.  
- **/reports** hub does not link to /reports/vat; it links to /invoices, /vat-returns, /sales-history (retail). So the dead end is direct navigation to /reports/vat (or similar entry point), not the hub.  
- **Reconciliation [accountId]:** If user has no accounts, reconciliation list is empty; clicking an account would not occur. If user has accounts and clicks one, /reconciliation/[accountId] loads; invalid id returns 404 "Account not found". No broken sidebar link.

---

## Severity legend

- **Blocker:** Security or wrong-tenant risk (e.g. auth disabled, first-business fallback in reconciliation APIs).  
- **High:** Broken or blocked flow in Service (e.g. /reports/vat 410, misleading permission copy).  
- **Medium:** Wrong semantics or UX (e.g. P&L/BS period error vs "no data yet", recurring RLS copy).  
- **Low / Cosmetic:** Edge-case messaging (e.g. trial balance "not balanced" when empty/partial), or minor wording.  

---

## Exit criteria

- [x] All in-scope Service pages classified (load, empty state, error, semantics).  
- [x] Failures mapped to context, permissions, bootstrap state, UI semantics.  
- [x] Real bugs (security, blocked flows, wrong copy) separated from expected-but-poorly-handled states (e.g. no period yet).  

**No fixes applied; evidence only.**
