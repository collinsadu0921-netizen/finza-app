# PHASE 7 — Cross-Workspace Context Integrity Audit (Mechanical)

**Audit type:** Principal systems + product boundary auditor  
**Mode:** Evidence only. Mechanical verification. No fixes, refactors, opinions, or suggestions.  
**Date:** 2025-01-31  
**Inputs (LOCKED):** Phase 2 Canonical Authority & Context Model; Phase 4 Canonical Authorization Unification; Phase 6 UI Context Resolution Refactor (accepted).

---

## PART 1 — CONTEXT RESOLUTION BY WORKSPACE

### 1.1 Retail Workspace

**Routes audited:** `/pos/**`, `(dashboard)/pos/page.tsx`, `(dashboard)/pos/register/CloseRegisterModal.tsx`, `/retail/**`, `/sales-history`, `/sales/**`, `/admin/retail/**`, `/reports/registers`, `/reports/vat`.

| Route / Flow | Context source | Explicit business_id passed? | Contract-compliant? |
|--------------|----------------|------------------------------|---------------------|
| `(dashboard)/pos/page.tsx` | `getCurrentBusiness(supabase, user.id)` | No (API receives business from request body/context derived from ownership) | Yes — ownership only |
| `(dashboard)/pos/register/CloseRegisterModal.tsx` | `getCurrentBusiness`; also uses `session.business_id` from `cashier_sessions` | N/A (reads ledger via Supabase client directly) | Context: yes. Ledger read: see Part 3 |
| `sales-history/page.tsx` | `getCurrentBusiness` | Yes (passed to `/api/sales-history/list` via params) | Yes |
| `sales/page.tsx`, `sales/open-session/page.tsx` | `getCurrentBusiness` | Yes (APIs receive business_id) | Yes |
| `admin/retail/*` (analytics, purchase-orders, suppliers, stock-transfers, bulk-import, inventory-dashboard) | `getCurrentBusiness` | Yes where APIs require it | Yes |
| `retail/dashboard/page.tsx` | `getCurrentBusiness` | Yes | Yes |
| `reports/registers/page.tsx` | N/A — calls `/api/reports/registers` with date range only | API uses `getCurrentBusiness` server-side | API returns 410; ledger read blocked |
| `reports/vat/page.tsx` | Calls `/api/reports/vat-control` with date range | API uses `getCurrentBusiness` server-side | Operational VAT; not accounting workspace |

**Evidence:** No Retail UI route imports `getActiveClientBusinessId` or `resolveAccountingBusinessContext`. All use `getCurrentBusiness` only. `lib/accessControl.ts`: retail workspace = `/pos`, `/inventory`, `/sales`, `/retail`, `/admin/retail`; `/reports` excluded (shared). `components/Sidebar.tsx`: Retail menu does not show Profit & Loss or Balance Sheet; shows Register Reports, VAT Report only.

---

### 1.2 Service Workspace

**Routes audited:** `/dashboard`, `/orders/**`, `/invoices/**`, `/estimates/**`, `/customers/**`, `/expenses/**`, `/reports` (hub), `/reports/balance-sheet`, `/reports/profit-loss`, `/reports/vat`, `/reconciliation` (bank rec), `/portal/accounting`, `/ledger`, `/trial-balance`, `/accounts`, `/vat-returns`, `/credit-notes`, `/bills`, `/payments`.

| Route / Flow | Reads ledger? | Writes ledger? | Context source | Contract-compliant? |
|--------------|---------------|---------------|---------------|---------------------|
| `dashboard/page.tsx` | Yes — calls `/api/accounting/reconciliation/mismatches?businessId=…` (read-only) | No | `getCurrentBusiness` | Yes |
| `orders/page.tsx`, `orders/new`, `orders/[id]/view` | No (operational list) | No (convert → invoice; ledger via trigger) | `getCurrentBusiness` | Yes |
| `invoices/page.tsx`, `invoices/new`, `invoices/[id]/view`, `invoices/[id]/edit` | Invoice view can call `/api/internal/reconcile/invoice` (read-only warning) | No (send/mark-paid trigger ledger via DB triggers) | `getCurrentBusiness` | Yes |
| `reports/balance-sheet/page.tsx`, `reports/profit-loss/page.tsx` | Yes — `/api/accounting/periods/resolve`, `/api/accounting/reports/balance-sheet`, `/api/accounting/reports/profit-and-loss` | No | `getCurrentBusiness`; `business_id` passed in query | Yes |
| `reports/page.tsx` | No (invoice stats from `invoices` table) | No | `getCurrentBusiness` | Yes |
| `reports/vat/page.tsx`, `reports/vat/diagnostic/page.tsx` | VAT control/diagnostic (operational) | No | `getCurrentBusiness` | Yes |
| `reconciliation/page.tsx`, `reconciliation/[accountId]/page.tsx` | Bank rec: `/api/reconciliation/accounts`, `/api/reconciliation/{accountId}/transactions` (operational) | No (toggle `is_reconcilable` only) | `getCurrentBusiness` | Yes |
| `portal/accounting/page.tsx` | Yes — accounting reports (P&L, BS, TB, GL) | No | `resolveAccountingBusinessContext` (Phase 6) | Yes |
| `ledger/page.tsx`, `trial-balance/page.tsx` (app root) | Yes — `/api/ledger/list`, `/api/accounting/trial-balance` or `/api/reports/trial-balance` | No | `getCurrentBusiness` (root ledger/trial-balance) or accounting context | Yes |

**Evidence:** No Service UI calls `/api/accounting/periods/close`, `/api/accounting/reconciliation/resolve`, or `/api/accounting/journals/drafts/…/post`. Ledger writes from Service flows occur via DB triggers (invoice send, payment create, expense create, credit note apply). `lib/accessControl.ts`: Service business owners blocked from `/accounting/*` except `/accounting/reconciliation` (read-only signpost). `components/Sidebar.tsx`: Service menu shows P&L, Balance Sheet, Accounting Portal, Chart of Accounts, General Ledger, Trial Balance, Reconciliation; Accounting Periods only if `isAccountantFirmUser`.

---

### 1.3 Accounting-First Workspace

**Scope:** Cross-workspace leakage only (Phase 6 already verified context resolution).

| Page / API | Context source | Uses operational tables? | Contract-compliant? |
|------------|----------------|---------------------------|---------------------|
| All `/accounting/*` in-scope pages (periods, reconciliation, reports/*, ledger, chart-of-accounts, adjustments, carry-forward, opening-balances, afs, trial-balance, exceptions, portal/accounting) | `resolveAccountingBusinessContext(supabase, userId, searchParams)` only | No — accounting pages do not read `cashier_sessions`, `stores`, `registers`, or POS session | Yes |
| Accounting API routes (`/api/accounting/*`, `/api/ledger/list`) | `business_id` from request (query/body); `checkAccountingAuthority` for auth | No — APIs scope by `business_id` and ledger/periods/coa | Yes |

**Evidence:** Grep for `store`, `register`, `POS`, `select-store`, `getActiveStoreId`, `cashier_sessions` in `app/accounting/**/*.tsx` returned only false positives (e.g. `method: "POST"`, `POSTED`). No Accounting-First UI relies on store sessions, register state, or POS session. Firm-only pages (opening-balances-imports, journals, drafts) use `getActiveClientBusinessId` by design (explicit client; Phase 6 out of scope).

---

## PART 2 — VISIBILITY & CAPABILITY BOUNDARIES

### 2.1 Capability Matrix (Evidence-based)

| Workspace | Can read ledger | Can post ledger | Can close period | Can reconcile (AR/ledger resolve) | Can see accounting reports |
|-----------|------------------|-----------------|------------------|-----------------------------------|----------------------------|
| Retail | PARTIAL — Close Register modal only: reads `journal_entry_lines` + `journal_entries` for Cash account (1000) to compute expected cash. No other ledger UI. `/api/reports/registers` returns 410. | No (only via operational APIs: sale/refund/void trigger RPCs) | No | No | No in sidebar. Route `/reports/balance-sheet` and `/reports/profit-loss` not blocked by industry (see Part 3). |
| Service | YES — Dashboard (reconciliation mismatches), `/reports/balance-sheet`, `/reports/profit-loss`, Accounting Portal, ledger, trial balance, invoice view reconcile warning, `/api/internal/reconcile/invoice`. | No (only via triggers on invoice/payment/expense/credit note) | No (Accounting Periods link only if `isAccountantFirmUser`) | Read-only signpost to `/accounting/reconciliation`; resolve/post only in accounting API | YES |
| Accounting-First | YES | YES (journals, adjustments, carry-forward, opening balances, reconciliation resolve, period close) | YES | YES | YES |

**Evidence:** `app/(dashboard)/pos/register/CloseRegisterModal.tsx` (lines 75–122): reads `accounts` (code 1000), `journal_entry_lines`; `app/api/sales/create/route.ts`: `post_sale_to_ledger`; `app/api/reports/registers/route.ts`: returns 410; `lib/accessControl.ts`: accounting workspace firm-only; Service exception `/accounting/reconciliation`; `app/accounting/periods/page.tsx`: fetch `/api/accounting/periods/close`; `app/accounting/reconciliation/page.tsx`: fetch `/api/accounting/reconciliation/resolve`.

---

### 2.2 Ledger Truth Ownership

| Workspace | Source of financial truth | Computes totals outside ledger? | Caches ledger-derived values? | Mutates accounting state? | Silent reconciliation? |
|-----------|---------------------------|----------------------------------|-------------------------------|----------------------------|-------------------------|
| Retail | Operational: sales, sale_items, cashier_sessions. One derived value: “expected cash” in Close Register = Cash account ledger balance (SUM(debit)−SUM(credit)). | Yes for expected cash (from ledger read in modal). Rest from operational tables. | No | No (ledger writes only via RPCs) | No |
| Service | Operational: invoices, payments, expenses, credit_notes. Reports: ledger-derived via `/api/accounting/reports/*`. | Reports call accounting APIs (ledger is source). Invoice stats from `invoices` table. | No | No (ledger writes only via triggers) | No |
| Accounting-First | Ledger (journal_entries, journal_entry_lines, accounts, periods). All reports and reconciliation from ledger/accounting APIs. | No | No | Yes (intended: post, close, reconcile) | No |

**Evidence:** `CloseRegisterModal.tsx` computes cash balance from `journal_entry_lines` in UI. All other Retail/Service totals from operational tables or accounting API responses. No duplication of ledger-derived totals in separate caches.

---

## PART 3 — CROSS-WORKSPACE LEAKAGE CHECK

| Leakage type | Location | Evidence | Contract-violation? |
|--------------|----------|----------|----------------------|
| Retail → Accounting (UI calling accounting APIs) | POS page does not call `/api/accounting/*` or `/api/ledger/list`. | `(dashboard)/pos/page.tsx`: fetch only to `/api/customers`, `/api/sales/park`, `/api/sales/create`. | No |
| Retail → Accounting (rendering ledger-derived reports) | Sidebar: Retail does not show P&L or Balance Sheet. | `Sidebar.tsx`: Retail section has Register Reports, VAT Report only. | No (sidebar) |
| Retail → Accounting (route not blocked) | `/reports/balance-sheet`, `/reports/profit-loss` use `getWorkspaceFromPath`; `/reports` is not in retail list, so workspace = "service". No industry check on these routes. | `accessControl.ts` getWorkspaceFromPath: retail = pos, inventory, sales, retail, admin/retail; /reports excluded. A Retail user can navigate by URL to `/reports/balance-sheet` and get `getCurrentBusiness` + accounting API calls. | Yes — Retail is defined accounting-blind; route allows ledger-derived report view. |
| Retail → Accounting (ledger terms / ledger read) | Close Register modal shows “expected cash” derived from Cash account ledger balance; uses debit/credit in code, not shown to user. | `CloseRegisterModal.tsx` lines 75–122: reads `journal_entry_lines`, `journal_entries` for business_id; user sees single number. | Partial — single constrained ledger read for operational close; no journals/periods/debits/credits exposed in UI. Documented in RETAIL_WORKSPACE_AUDIT as intentional. |
| Service → Accounting (triggering writes) | Service does not call period close, reconciliation resolve, or journal post from UI. | No fetch to `/api/accounting/periods/close`, `/api/accounting/reconciliation/resolve`, or `/api/accounting/journals/drafts/…/post` from orders, invoices, expenses, reports, reconciliation (bank) pages. | No |
| Service → Accounting (firm client context) | Service UI does not use `getActiveClientBusinessId` or firm client selection. | Grep: no `getActiveClientBusinessId` in app/orders, app/invoices, app/reports (service), app/dashboard (except Sidebar for accounting client books-only check). | No |
| Accounting → Operational (store/register/POS) | Accounting pages do not use store session, register state, or POS session. | Grep in app/accounting/**/*.tsx for store, register, POS, select-store, getActiveStoreId, cashier_sessions: only "POST"/"POSTED" matches. | No |

---

## PART 4 — BUSINESS CONTEXT ISOLATION

| Check | Result | Evidence |
|-------|--------|----------|
| Retail never sees firm client context | Pass | No `getActiveClientBusinessId` or `resolveAccountingBusinessContext` in pos, retail, sales-history, admin/retail. |
| Service never sees firm client context | Pass | No `getActiveClientBusinessId` in orders, invoices, reports (balance-sheet, profit-loss), dashboard, reconciliation (bank). Service uses `getCurrentBusiness` only for own business. |
| Accounting-First never assumes “current store” or POS session | Pass | No store/register/POS usage in app/accounting UI. |
| Firm client selection does not bleed into Retail or Service | Pass | Firm client used only in Accounting-First (resolveAccountingBusinessContext, opening-balances-imports, journals, drafts) and Sidebar when pathname starts with /accounting. |

**Verdict:** Pass per workspace for context isolation as above. One route-level gap: Retail can open `/reports/balance-sheet` and `/reports/profit-loss` by URL and see ledger-derived data (Part 3).

---

## PART 5 — GLOBAL CONSISTENCY VERDICT

1. **Do all three workspaces resolve business context correctly?**  
   Yes. Retail and Service use `getCurrentBusiness` (ownership/assignment) only. Accounting-First uses `resolveAccountingBusinessContext` (URL → session client → ownership). No page in scope mixes firm client context into Retail or Service.

2. **Are capabilities strictly partitioned?**  
   Mostly. Retail: no period close, no reconciliation resolve, no journal post; one constrained ledger read (Close Register). Service: read-only accounting visibility; no period close or reconciliation post from UI. Accounting-First: full authority. Exception: `/reports/balance-sheet` and `/reports/profit-loss` are not restricted by industry, so Retail can view them if they navigate by URL.

3. **Is ledger truth centralized and protected?**  
   Yes. Ledger writes occur only via RPCs (sales, invoice, payment, expense, credit note) or accounting APIs (journals, adjustments, period close, reconciliation resolve). No dual posting or direct insert/update of journal_entries from Retail/Service UI. One intentional read: Close Register expected cash from Cash account.

4. **Is no workspace over-privileged?**  
   Accounting-First has full authority by design. Service has read-only accounting and trigger-driven posts. Retail is intended accounting-blind; the only over-privilege is the possibility for Retail to open `/reports/balance-sheet` and `/reports/profit-loss` (no industry-based block on those routes).

---

## PART 6 — ALIGNMENT SCORE

| Workspace | Context correctness | Capability isolation | Leakage absence | Score |
|-----------|---------------------|----------------------|-----------------|-------|
| Retail | Pass | Pass (one intentional ledger read) | Partial — route-level access to P&L/BS by URL; sidebar correct | 85% |
| Service | Pass | Pass | Pass | 100% |
| Accounting-First | Pass | Pass | Pass | 100% |

Overall alignment score: **95%**

---

## FINAL OUTPUTS

1. **Context resolution tables:** Part 1.1, 1.2, 1.3.
2. **Capability matrix:** Part 2.1, 2.2.
3. **Leakage findings table:** Part 3.
4. **Isolation verdict:** Part 4 — Pass for firm client isolation; one route-level gap for Retail viewing accounting reports by URL.
5. **Alignment score:** Part 6 — Retail 85%, Service 100%, Accounting-First 100%; overall 95%.

6. **One-sentence verdict:**

> Cross-workspace context integrity is **partially aligned** because Retail and Service resolve context correctly and do not call accounting write APIs; Accounting-First does not rely on store/register/POS; however, routes `/reports/balance-sheet` and `/reports/profit-loss` are not restricted by industry, so a Retail user can view ledger-derived reports by URL, and Retail’s Close Register flow reads one ledger-derived value (expected cash) by design—both documented as evidence with no fixes applied in this audit.

---

**End of Phase 7 audit.**  
Evidence only. No fixes. No suggestions.
