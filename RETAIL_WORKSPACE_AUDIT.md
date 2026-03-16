# Retail Workspace Audit — Vision Alignment Check

**Audit type:** Principal product + accounting systems auditor. Evidence only. No code changes. No fixes or suggestions.

**Date:** 2025-01-31.  
**Scope:** Retail workspace end-to-end — UI flows, APIs, database interactions, ledger impact, permissions, reporting, external accountant reality.

---

## 1. Purpose Check (Ground Truth)

### What Retail is for

- **Operating a retail business without accounting knowledge:** Retail entry and navigation are driven by operational concepts: Dashboard, POS Terminal, Open/Close Register Session, Product & Inventory, Sales History, Register Reports, VAT Report, Customers & Suppliers, Settings. No accounting terminology in the main menu (`components/Sidebar.tsx` when `businessIndustry === "retail"`).
- **Correct accounting as a byproduct:** Sales, refunds, and voids are posted to the ledger via RPCs (`post_sale_to_ledger`, `post_sale_refund_to_ledger`, `post_sale_void_to_ledger`). The API passes `p_posted_by_accountant_id: business.owner_id` so the business owner acts as “system accountant”; no separate accountant user is required (`app/api/sales/create/route.ts` lines 1312–1316). Ledger posting is mandatory: if it fails, the sale is rolled back (lines 1320–1328).
- **No accountant required:** Access to `/accounting/*` is denied to retail business owners; they are redirected to `/retail/dashboard` (`lib/accessControl.ts` lines 134–136, 171–176). Retail users never see accounting workspace UI. All posting is triggered by operational actions and uses the owner as the posting identity.

**Evidence:** `lib/accessControl.ts` (workspace boundary, redirect for retail); `app/api/sales/create/route.ts` (post_sale_to_ledger, owner_id as system accountant); `components/Sidebar.tsx` (retail menu items).

### What Retail is NOT for

- **Accounting control:** Retail users cannot access accounting workspace (periods, trial balance, P&L, balance sheet, adjustments, reconciliation). Route access is enforced in `lib/accessControl.ts` and `lib/routeGuards.ts`.
- **Direct ledger access:** Retail has no UI to view or edit journal entries, accounts, or periods. The only place Retail UI reads ledger data is the **Close Register** flow: `CloseRegisterModal.tsx` reads `accounts` (Cash account code `1000`) and `journal_entry_lines` to compute “expected cash” for the session (lines 75–122). That is a single, constrained read for operational reconciliation (cash count vs ledger cash balance).
- **Replacing accounting reports:** Register Report and VAT Report links in the Retail sidebar point to `/api/reports/registers` and `/reports/vat`. The registers API returns **410 Gone** with “This report uses ledger data. Use accounting workspace reports” (`app/api/reports/registers/route.ts` lines 34–42). So Retail does not replace accounting reports; ledger-based reports are intentionally blocked from the operational surface.

**Evidence:** `app/api/reports/registers/route.ts` (410 block); `app/(dashboard)/pos/register/CloseRegisterModal.tsx` (ledger read for expected cash only).

---

## 2. Operational Coverage

| Flow | Where it starts (UI) | API | Ledger impact | Ledger accounts (evidence) |
|------|----------------------|-----|---------------|----------------------------|
| **Sales creation** | POS page `(dashboard)/pos/page.tsx`; sale payload built in UI, then POST | `POST /api/sales/create` | Yes. After `sales` + `sale_items` + stock updates + `stock_movements`, API calls `post_sale_to_ledger(p_sale_id, p_posted_by_accountant_id: business.owner_id)`. Failure rolls back sale. | Cash (1000) or clearing (1010/1020/1030), Revenue, COGS (5000), Inventory (1200), tax control accounts; from DB RPC and migrations (e.g. 179, 190). |
| **Payments** | Same sale flow; payment method(s) and amounts in request body (`payment_method`, `payments[]`, `cash_amount`, `momo_amount`, `card_amount`) | Same `POST /api/sales/create` | Embedded in sale posting. Single journal entry per sale includes cash/clearing debits, revenue/COGS/inventory/tax. | Same as above; payment method determines which settlement account is debited. |
| **Refunds** | Refund action (e.g. from Sales History or POS); `useRefund` triggers supervisor override modal | `POST /api/override/refund-sale` (body: supervisor_email, supervisor_password, sale_id, cashier_id) | Yes. After stock restoration and `sales.payment_status = 'refunded'`, API calls `post_sale_refund_to_ledger(p_sale_id)`. Failure reverts payment_status. | Reverses original sale; credits same payment account as original (per REFUND_VOID_POSTING_PATHS_AUDIT / 192). |
| **Void** | Void action; `useVoidSale` triggers supervisor override modal | `POST /api/override/void-sale` | Yes. After stock restoration and override record, API calls `post_sale_void_to_ledger(p_sale_id)`, then deletes sale and sale_items. | Reversal journal entry; reference_type `void` (migration 192). |
| **Inventory adjustments** | Stock transfers: Admin Retail → Stock Transfers; Add stock / inventory UI | `POST /api/stock-transfers` (create transfer); `POST /api/purchase-orders/[id]/receive` (receive PO — posts to ledger via `post_purchase_order_receipt_to_ledger`) | Stock transfers: operational only (stock_movements, products_stock); no ledger posting in stock-transfers route. PO receive: posts to ledger (Inventory DR, AP CR). | PO receive: inventory and AP accounts. Sales: inventory deduction in post_sale_to_ledger (COGS, Inventory). |
| **Discounts** | POS: line/cart discounts in sale payload; discount override when above role limit | Sale: part of `POST /api/sales/create` (cart_discount_*, line discounts in sale_items). Override: `POST /api/override/discount` (supervisor approves) | Discounts affect sale amount and thus revenue/tax in the same `post_sale_to_ledger` call. No separate ledger entry for “discount”. | Reflected in revenue and tax lines of the sale journal entry. |
| **Taxes** | POS: tax calculated in UI; sent as `tax_lines`, `tax_engine_code`, `tax_engine_effective_from`, `tax_jurisdiction`. `apply_taxes` defaults true. | `POST /api/sales/create` | Required when taxes applied: API validates `tax_lines` and metadata (422 if missing). `post_sale_to_ledger` reads `tax_lines` from DB and posts tax control accounts. | Tax control accounts (e.g. VAT, NHIL, GETFUND, COVID) per jurisdiction; from post_sale_to_ledger and migrations. |
| **Cash vs non-cash** | Payment method selection and `payments[]` in sale request | Same `POST /api/sales/create` | Same posting path. Cash → Cash (1000); momo/card → clearing (1010/1020/1030). Refund credits the same account that was debited on the original sale. | Cash 1000; clearing accounts per payment method (191, 192). |

**Evidence:** `app/api/sales/create/route.ts` (full flow, post_sale_to_ledger call, tax validation, payment validation); `app/api/override/refund-sale/route.ts` (post_sale_refund_to_ledger); `app/api/override/void-sale/route.ts` (post_sale_void_to_ledger, then delete sale); `app/api/override/discount/route.ts`; `lib/hooks/useRefund.ts`, `lib/hooks/useVoidSale.ts`; existing audits (REFUND_VOID_POSTING_PATHS_AUDIT, RETAIL_FREEZE, etc.).

---

## 3. Accounting Exposure (Critical)

### What Retail users can SEE

- **Operational data:** Sales list (sales, sale_items, payment_method, amounts, dates), Sales History (`/api/sales-history/list` — reads `sales` table with filters; no ledger tables). Receipt reprint, sale detail.
- **One ledger-derived value:** Close Register modal computes “expected cash” from Cash account (1000) by summing `journal_entry_lines` (debit − credit) for that account and business. No other ledger fields (no account names, no other accounts, no journal IDs, no periods) are shown. Fallback if Cash account missing: use opening float only.

**Evidence:** `app/api/sales-history/list/route.ts` (query on `sales` only); `app/(dashboard)/pos/register/CloseRegisterModal.tsx` (accounts + journal_entry_lines for Cash only).

### What Retail users can MODIFY

- **Only via operational actions:** Create sale, refund (with supervisor), void (with supervisor), discount override (with supervisor), open/close register session, stock transfers, PO receive (admin). No UI to create or edit journal entries, accounts, or periods.
- **Ledger impact is indirect:** All ledger writes are performed inside RPCs called by the API (`post_sale_to_ledger`, `post_sale_refund_to_ledger`, `post_sale_void_to_ledger`). Retail users cannot choose accounts, debits, credits, or periods.

### What Retail users can NEVER touch (by design)

- **Accounting workspace:** Blocked at route level; redirect to `/retail/dashboard` for retail business owners (`lib/accessControl.ts`).
- **Journal entries, periods, chart of accounts, trial balance, P&L, balance sheet, adjustments, reconciliation:** No Retail routes or sidebar links to these; ledger-based report APIs return 410 for Retail-callable legacy endpoints.

### Can a Retail user accidentally break accounting invariants?

- **No direct write path:** They cannot insert/update/delete journal_entries or journal_entry_lines. They can only trigger RPCs that build and post entries server-side.
- **Risks that remain:** (1) Bug or misconfiguration in RPC (e.g. unbalanced lines, wrong account) could produce bad data; (2) Close Register modal reads ledger — if that read were extended to other data or used in a write path, exposure would increase. Currently, the only write path is through the three posting RPCs.

### Are debits/credits, accounts, journals, or periods exposed?

- **In normal Retail UI:** No. No screens show account codes, debit/credit columns, journal IDs, or period identifiers.
- **Exception:** Close Register shows a single number (“expected cash”) derived from Cash account ledger balance. The implementation uses `debit` and `credit` in a query and computes balance in code; the user only sees the resulting amount, not the underlying debits/credits or account code.

### Dual posting or bypass of canonical ledger?

- **No dual posting observed:** Sales, refunds, and voids go through a single path each: one RPC per action. No evidence of a second path that writes to the ledger for the same event.
- **No bypass:** All ledger writes for Retail flows go through `post_sale_to_ledger`, `post_sale_refund_to_ledger`, or `post_sale_void_to_ledger`. PO receive uses `post_purchase_order_receipt_to_ledger`. No Retail API was found to call `post_journal_entry` directly or to insert into journal_entries/journal_entry_lines.

**Evidence:** Grep for post_sale_to_ledger, post_sale_refund_to_ledger, post_sale_void_to_ledger, post_journal_entry in app/api; accessControl and routeGuards for /accounting; CloseRegisterModal.tsx.

---

## 4. Permissions & Roles

### Where permissions exist

- **Route level (`lib/routeGuards.ts`, `lib/accessControl.ts`):**
  - **Cashier (10):** Only `/pos` allowed. Explicitly blocked: `/retail`, `/dashboard`, `/reports`, `/settings`, `/sales-history`, `/sales/open-session`, `/sales/close-session`, `/admin`, `/accounting`, `/invoices`, `/products`, `/inventory`, `/staff`, `/payroll`. Catch-all: non-POS redirect to `/pos`.
  - **Manager (50):** Blocked: `/settings/staff`, `/admin`. Allowed: `/retail/dashboard`, POS, `/sales/open-session`, `/sales/close-session`, other retail routes.
  - **Admin/Owner (100):** All routes allowed (except accounting workspace for retail business owners, which is blocked by accessControl).
- **Store context (`lib/accessControl.ts`, `lib/storeContextGuard.ts`):** Cashiers use store from cashier session. Managers must have assigned store_id (or selected store). Admin/Owner must select store for store-required routes (e.g. POS). Sales creation validates store_id and register-store match; manager/cashier must use assigned store.
- **Override actions (`lib/authority.ts`, override APIs):** Refund and void require supervisor (manager or admin): `REQUIRED_AUTHORITY.REFUND = 50`, `REQUIRED_AUTHORITY.VOID = 50`. Discount override: manager or admin; same 50. Refund/void APIs verify supervisor is not the cashier and has role owner/admin/manager; they use `getAuthorityLevel` and `hasAuthority(supervisorAuthority, REQUIRED_AUTHORITY.REFUND/VOID)`.
- **Sales history (`app/api/sales-history/list/route.ts`):** Only owner, admin, manager, employee may access. Cashier is not in that list (and is blocked from the route by routeGuards anyway).

**Evidence:** `lib/routeGuards.ts` (cashier block list, manager block list); `lib/accessControl.ts` (store context, workspace-industry); `lib/authority.ts` (authority levels, REQUIRED_AUTHORITY); `app/api/override/refund-sale/route.ts`, `app/api/override/void-sale/route.ts`, `app/api/override/discount/route.ts` (supervisor check, authority check).

### Where permissions are missing or weak

- **Employee role:** `hasAccessToSalesHistory` allows "employee"; sales-history list allows owner, admin, manager, employee. Authority level for employee is 10 (same as cashier). So employee can see sales history but has no override authority (10 < 50); refund/void/discount override still require manager+. No evidence of an “internal accountant” role that is granted only accounting-read in Retail; accountant role has authority 0 in authority.ts and is not given Retail-only capabilities in the audited files.
- **Register variance / close:** Register close modal uses ledger to compute expected cash; no separate “register variance override” permission was traced. Who can close a register (and whether they can override variance) is determined by who can reach the close-session flow (manager+ for open/close session in routeGuards).
- **Stock transfers / PO receive:** Stock transfer creation and PO receive were not fully audited for role checks; they live under admin/retail and are likely restricted by route (admin/owner or manager with access to those routes). Manager is allowed “other retail routes” in routeGuards, so manager may access stock transfers if under /retail or /admin/retail; accessControl restricts /admin to non-managers. So managers are blocked from /admin (including /admin/retail). Only admin/owner can access admin/retail (stores, suppliers, purchase orders, stock transfers, etc.).

### Could missing permissions cause fraud, leakage, or loss?

- **Cashier isolation:** Cashiers are confined to POS; they cannot access sales history, reports, settings, or admin. Refund/void require a different user (supervisor) with higher authority. This limits cashier-only fraud (e.g. fake refunds without supervisor).
- **Manager:** Can open/close register, do POS, refund/void/discount override. Cannot access staff settings or admin. So manager could approve excessive refunds/discounts; separation of “who can approve” vs “who can perform sale” is present (override flow).
- **Leakage:** Sales history is filtered by store for managers (effectiveStoreId from assigned store). Admin/owner can see all stores. No evidence of cross-business data exposure in the Retail paths audited.
- **Loss:** If supervisor credentials are shared or weak, override actions (refund, void, discount) could be abused. The design requires a second user (supervisor) for those actions, which is a control, but not a guarantee against collusion or compromised supervisor account.

**Evidence:** `lib/userRoles.ts` (hasAccessToSalesHistory: owner, admin, manager, employee); `lib/authority.ts` (employee = 10, manager = 50, admin/owner = 100); `app/api/sales-history/list/route.ts` (role check, effectiveStoreId for manager).

---

## 5. Reporting Reality

### What reports are available in Retail?

- **Sidebar (retail):** Sales & Reports → Analytics Dashboard (`/admin/retail/analytics`), Sales History (`/sales-history`), Register Reports (`/reports/registers`), VAT Report (`/reports/vat`). Admin-only: Analytics is under `/admin/retail`, so only admin/owner (managers blocked from /admin).
- **Sales History:** Page uses `GET /api/sales-history/list`. Reads from `sales` (and related registers, users). Operational list (amounts, dates, payment method, status, store). No ledger tables. Real-time operational view.
- **Register Reports:** Page calls `GET /api/reports/registers?start_date=&end_date=`. That API returns **410 Gone** with body “This report uses ledger data. Use accounting workspace reports.” So the report does not load in Retail.
- **VAT Report:** Link goes to `/reports/vat`; not traced in detail. If it calls a legacy ledger-based VAT endpoint, it would be blocked similarly (e.g. `/api/reports/vat-control` returns 410).

**Evidence:** `components/Sidebar.tsx` (retail menu); `app/reports/registers/page.tsx` (fetch to /api/reports/registers); `app/api/reports/registers/route.ts` (410 at top); `app/api/sales-history/list/route.ts` (sales table only).

### Are they real-time operational or accounting reports?

- **Sales History:** Real-time operational (sales table). No accounting periods; date filters only.
- **Register Reports:** Intended as ledger-based (cash and clearing account movements). Blocked (410) in Retail. So in practice Retail does not have a working register reconciliation report from the operational UI.
- **Analytics Dashboard:** Under admin/retail; content not fully traced; typically operational metrics.

### Do they read from the ledger or from operational tables?

- **Sales History:** Operational tables only (`sales`).
- **Register Report (if it were enabled):** Would read from `journal_entry_lines` and `journal_entries` (see comment and code after the 410 return in registers/route.ts). So it is ledger-based; hence blocked.

### Confirm: Retail reports do NOT replace accounting reports

- **Yes.** Ledger-based report endpoints used by Retail (e.g. `/api/reports/registers`) return 410 and direct the user to accounting workspace reports. Retail has no working P&L, balance sheet, trial balance, or register report from ledger.

### Retail reports do NOT require accounting periods

- **Sales History:** No period; uses date_from/date_to on `sales.created_at`. Usable without any accounting period setup.
- **Register Report:** Not usable in Retail (410). If it were, the backend implementation would be date-based (start_date, end_date); whether it would require an accounting period in the future is not changed by current Retail behavior.

### Retail reports remain usable even if accounting is never reviewed

- **Sales History:** Yes. Pure operational table; no dependency on periods or accountant review.
- **Register Report:** Not usable in Retail. So for “register reconciliation” the Retail operator cannot self-serve from Retail; they would need accounting workspace (or an accountant) for the canonical register report.

**Evidence:** Same as above; 410 and sidebar links.

---

## 6. External Accountant Reality

### How can a Retail business export books for a non-Finza accountant?

- **Accounting exports:** Exports (transaction-level tax, levies, VAT) live under `GET /api/accounting/exports/transactions`, `.../levies`, `.../vat`. They require `business_id` and `period` (YYYY-MM). Access is enforced via `can_accountant_access_business` RPC (firm user or business owner). But **Retail business owners are blocked from the accounting workspace** in `lib/accessControl.ts` (redirect to `/retail/dashboard` for `/accounting/*`). So from the **Retail** workspace, the owner cannot navigate to the accounting UI that would call these export endpoints.
- **Conclusion:** There is no **Retail-accessible** export path audited that allows “export my books for my external accountant” from within the Retail workspace. The export APIs exist and are period-aware and ledger-based, but they are only reachable in the accounting workspace, which Retail users cannot access.

### What formats exist?

- **Accounting exports:** CSV (transactions, levies, VAT return). Filenames like `tax-transactions-{period}.csv`, `levies-return-{period}.csv`, `vat-return-{period}.csv`. No Retail UI was found that offers these downloads.

### Are exports complete, auditable, and period-aware?

- **Accounting exports:** They are period-based (YYYY-MM), read from `journal_entries` and `journal_entry_lines` (and accounting_periods where checked). So they are ledger-based and period-aware. Completeness and auditability depend on RPC and query design; the design is period-scoped and ledger-sourced. **Retail users cannot trigger these from Retail.**

**Evidence:** `app/api/accounting/exports/transactions/route.ts`, `.../levies/route.ts`, `.../vat/route.ts` (can_accountant_access_business, period param, journal_entries); `lib/accessControl.ts` (retail → /accounting blocked).

---

## 7. Alignment Verdict

### Score: **72%** (evidence-based, no fixes)

- **Fully aligned (credit):**
  - Retail is for operating without accounting knowledge; menu and flows are operational.
  - Correct accounting as a byproduct: single canonical path (post_sale_to_ledger, post_sale_refund_to_ledger, post_sale_void_to_ledger), mandatory posting, rollback on failure.
  - No accountant required: owner is system accountant; accounting workspace is inaccessible to Retail.
  - Single ledger; no dual posting or bypass observed.
  - Granular roles (cashier, manager, admin/owner) with route and override authority; cashier restricted to POS; refund/void/discount require supervisor.
  - Sales History is operational and does not replace accounting reports; ledger-based report (registers) is explicitly blocked (410) from Retail.

- **Partially aligned (partial credit):**
  - One ledger read in Retail: Close Register modal uses Cash account balance for “expected cash.” Minimal and purposeful, but it is an exception to “Retail never sees ledger.”
  - Register Report and VAT Report are linked in Retail sidebar but return 410; intent (don’t replace accounting) is met, but UX is a dead link.
  - Exports for external accountant exist and are period-aware and ledger-based, but are not available from Retail workspace (accounting workspace only).

- **Violates or gaps (deduct):**
  - Retail has **no in-workspace way** to export books for an external accountant (exports live only in accounting workspace, which Retail cannot use).
  - Register Report is **unusable** in Retail (410); so “real-time operational views” are only partially true (Sales History works; Register Report does not).
  - Employee role can access sales history with authority 10; no separate “internal accountant” read-only role was found in Retail; minor permission granularity gap.

### Summary table

| Vision element | Status | Evidence |
|----------------|--------|----------|
| Operate without accounting knowledge | Yes | Sidebar and routes are operational; no accounting terms in main flows. |
| Correct accounting as byproduct | Yes | Single RPC path per event; owner as system accountant; rollback on post failure. |
| No accountant required | Yes | Accounting workspace blocked for retail; posting uses owner_id. |
| No direct ledger exposure | Partial | Only Close Register reads ledger (Cash balance). No debits/credits/accounts/journals/periods in UI. |
| No dual posting / bypass | Yes | All Retail ledger writes via post_sale_*, post_sale_refund_*, post_sale_void_*. |
| Granular permissions (cashier/manager/owner) | Yes | routeGuards + authority; override requires supervisor. |
| Retail reports ≠ accounting reports | Yes | Ledger reports return 410; Sales History is operational only. |
| Retail reports usable without periods | Yes | Sales History uses dates only; Register Report not usable (410). |
| Export books for external accountant | No | Exports exist in accounting workspace only; Retail cannot access. |

---

*End of audit. Evidence only. No code changes or recommendations.*
