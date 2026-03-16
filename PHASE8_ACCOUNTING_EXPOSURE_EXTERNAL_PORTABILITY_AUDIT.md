# PHASE 8 — Accounting Exposure & External Portability Audit (Mechanical)

**Audit type:** Principal product + systems boundary auditor  
**Mode:** Evidence only. Mechanical verification. No fixes, refactors, opinions, or future design.  
**Date:** 2025-01-31  
**Inputs (LOCKED):** Phase 2 Canonical Authority & Context Model; Phase 4 Canonical Authorization Unification; Phase 6 UI Context Resolution Refactor; Phase 7 Cross-Workspace Context Integrity Audit (completed).

---

## OBJECTIVE (NON-NEGOTIABLE)

Verify that **any business on Finza can fully access, inspect, and export its accounting truth without requiring an accountant user on Finza**, and that **all workspaces expose accounting data appropriately according to real-world business needs**.

Answer, with evidence only:

> Can a business owner or in-house accountant operate day-to-day in Retail or Service, yet independently access, export, and share complete accounting books with **external (non-Finza) accountants** — without violating authority, context, or workspace boundaries?

---

## PART 1 — REAL-WORLD ACCOUNTING NEEDS BY BUSINESS TYPE

### 1.1 Retail Business (POS-driven)

**What accounting information does a retail owner typically need?**  
Period cash/sales summaries, VAT/tax summaries, register reports, and (for external accountant) P&L, Balance Sheet, Trial Balance, General Ledger, transaction-level tax detail.

**What is available today without entering Accounting-First?**

| Need | Available? | Where | Evidence |
|------|------------|-------|----------|
| Register report (ledger-based) | No | `/api/reports/registers` returns 410 with "This report uses ledger data. Use accounting workspace reports." | `app/api/reports/registers/route.ts` lines 34–42 |
| VAT report (ledger-based) | No | `/api/reports/vat-control` returns 410 with same block. | `app/api/reports/vat-control/route.ts` lines 24–31 |
| P&L / Balance Sheet (view) | Only by URL | Route `/reports/balance-sheet`, `/reports/profit-loss` not blocked by industry; Retail sidebar does not show these links. If Retail user navigates by URL, page uses `getCurrentBusiness` and calls `/api/accounting/reports/*` (owner passes `checkAccountingAuthority`). | Phase 7; `app/reports/balance-sheet/page.tsx` (calls `/api/accounting/periods/resolve`, `/api/accounting/reports/balance-sheet`); Sidebar Retail section has Register Reports, VAT Report only |
| P&L / Balance Sheet (export CSV/PDF) | No UI | Export endpoints `/api/accounting/reports/*/export/csv` and `export/pdf` use `checkAccountingAuthority` (owner allowed). Export **UI** exists only on `/accounting/reports/*` pages; accessControl blocks Retail from `/accounting/*`. Owner can export only by calling API directly. | `lib/accessControl.ts` (Retail redirect from accounting); export buttons only in `app/accounting/reports/*` |
| Ledger list | No UI in Retail | `/api/ledger/list` uses `checkAccountingAuthority` (owner allowed). Ledger UI is at `/ledger` (root) and `/accounting/ledger`; Retail sidebar does not show Ledger; Retail is redirected from `/accounting/*`. | Phase 7; Sidebar |
| Period visibility | No | Periods list/close UI is under `/accounting/periods`; Retail blocked from `/accounting/*`. `/api/accounting/periods` uses `can_accountant_access_business` (firm-only). | `app/api/accounting/periods/route.ts` |

**Summary:** Retail workspace is accounting-blind by design. Ledger-based report APIs under `/api/reports/*` return 410. Viewing P&L/BS is possible only if user navigates to `/reports/balance-sheet` or `/reports/profit-loss` by URL (no sidebar link). No export UI available to Retail; owner could export P&L/BS/TB/GL only via direct API calls with same auth.

---

### 1.2 Service Business (Invoice-driven)

**What accounting visibility does a service owner expect?**  
P&L, Balance Sheet, Trial Balance, General Ledger, VAT/tax summaries, ability to export for external accountant.

**What is available today without entering Accounting-First?**

| Need | Available? | Where | Evidence |
|------|------------|-------|----------|
| P&L / Balance Sheet (view) | Yes | `/reports/profit-loss`, `/reports/balance-sheet` use `getCurrentBusiness` and call `/api/accounting/periods/resolve`, `/api/accounting/reports/profit-and-loss`, `/api/accounting/reports/balance-sheet`. Auth: `checkAccountingAuthority` (owner allowed). | `app/reports/balance-sheet/page.tsx` lines 112–136; `app/reports/profit-loss/page.tsx`; `lib/accountingAuth.ts` (owner → authorized for "read") |
| Trial Balance / General Ledger (view) | Yes | `/portal/accounting` (P&L, BS, TB, GL tabs); `/ledger`, `/trial-balance` (root). All use ownership context and call accounting report/ledger APIs. | `app/portal/accounting/page.tsx`; Phase 7 |
| P&L / BS / TB / GL (export CSV/PDF) | API only; no UI in Service | Export endpoints use `checkAccountingAuthority` (owner allowed). Export **buttons** exist only on `/accounting/reports/*` pages; accessControl blocks Service business owners from `/accounting/*` except `/accounting/reconciliation`. So Service owner can export only by calling API directly (e.g. browser fetch with business_id, period_start). | `app/accounting/reports/*/page.tsx` (Export CSV/PDF); `lib/accessControl.ts` lines 166–168 (exception: reconciliation only); `app/reports/balance-sheet/page.tsx` has no Export CSV/PDF (grep: only "export default") |
| VAT / tax (view) | Yes | `/reports/vat`, `/reports/vat/diagnostic`; `/api/reports/vat-control` returns 410 (ledger); VAT returns UI at `/vat-returns`. | `app/reports/vat/page.tsx`; `app/api/reports/vat-control/route.ts` 410 |
| Transactions / VAT / levies (export CSV) | Firm only | `/api/accounting/exports/transactions`, `/api/accounting/exports/vat`, `/api/accounting/exports/levies` use **only** `can_accountant_access_business` RPC; no `checkAccountingAuthority`. Owner gets `accessLevel === null` → 403. | `app/api/accounting/exports/transactions/route.ts` lines 47–67; `exports/vat/route.ts` lines 42–59; `exports/levies/route.ts` lines 44–65 |

**Summary:** Service owner can **view** P&L, BS, TB, GL from /reports/*, /portal/accounting, /ledger, /trial-balance. **Export** of P&L/BS/TB/GL as CSV/PDF is authorized for owner at API level but **no export UI** is available in Service workspace (export UI only in Accounting-First, which is firm-only for business owners). Transactions/VAT/levies CSV exports require firm (can_accountant_access_business).

---

### 1.3 Business With In-House Accountant (No Firm)

**Can an internal accountant operate without entering Accounting-First?**  
No. Accounting workspace (`/accounting/*`) is gated by **accounting_firm_users**: only users with a row in `accounting_firm_users` can access `/accounting/*`. Business owners and employees (including those with role `accountant` in `business_users`) are blocked and redirected to `/dashboard` (service) or `/retail/dashboard` (retail), except Service owners can open `/accounting/reconciliation` only.

**Evidence:** `lib/accessControl.ts` STEP 4: if workspace === "accounting", allow only if user in `accounting_firm_users`; else (business owner) redirect. Exception: Service + path `/accounting/reconciliation` allowed. No exception for `business_users.role === 'accountant'`.

**Visibility of accounting menus for owner/admin/accountant:**  
Service sidebar shows "Profit & Loss", "Balance Sheet", "Accounting Portal", "Chart of Accounts", "General Ledger", "Trial Balance", "Reconciliation" (Accounting Periods only if `isAccountantFirmUser`). So owner/admin see accounting **reports** (read-only) in Service; they do **not** see Accounting-First workspace (periods, journals, adjustments, export buttons). In-house accountant (employee with role accountant) has same route access as admin/owner for non-accounting routes; for `/accounting/*` they are still blocked (firm check is membership in `accounting_firm_users`, not `business_users.role`).

**Ability to export books without firm context:**  
At **API** level: P&L, BS, TB, GL report and export endpoints use `checkAccountingAuthority`, which allows **owner** and **employee** with role admin or accountant. So in-house accountant (business_users role accountant) **can** call these APIs with business_id and get data/export. There is **no UI** in Service or Retail that offers Export CSV/PDF for these reports; the only UI with export buttons is `/accounting/reports/*`, which is firm-only for business owners and employees.

---

## PART 2 — ACCOUNTING DATA PORTABILITY (CRITICAL)

### 2.1 Export Coverage Audit

| Export | Endpoint | Workspace (UI) | Format | Auth | Requires firm? | Contract-compliant? |
|--------|----------|-----------------|--------|------|----------------|---------------------|
| P&L | GET `/api/accounting/reports/profit-and-loss` | Service: `/reports/profit-loss` (view). Export UI: Accounting-First only | JSON | checkAccountingAuthority (owner/employee/firm) | No | Yes (owner can call API) |
| P&L CSV/PDF | GET `/api/accounting/reports/profit-and-loss/export/csv`, `export/pdf` | Accounting-First only | CSV, PDF | checkAccountingAuthority | No | Partial — API allows owner; UI for export firm-only |
| Balance Sheet | GET `/api/accounting/reports/balance-sheet` | Service: `/reports/balance-sheet` (view). Export UI: Accounting-First only | JSON | checkAccountingAuthority | No | Yes (owner can call API) |
| Balance Sheet CSV/PDF | GET `.../balance-sheet/export/csv`, `export/pdf` | Accounting-First only | CSV, PDF | checkAccountingAuthority | No | Partial — same as P&L |
| Trial Balance | GET `/api/accounting/reports/trial-balance` | Service: `/portal/accounting` (TB tab); root `/trial-balance` may call report or `/api/accounting/trial-balance`. Export UI: Accounting-First only | JSON | checkAccountingAuthority (reports) | No (reports route). `/api/accounting/trial-balance` uses can_accountant_access_business (firm-only) | Partial — reports path owner; standalone trial-balance API firm-only |
| Trial Balance CSV/PDF | GET `.../trial-balance/export/csv`, `export/pdf` | Accounting-First only | CSV, PDF | checkAccountingAuthority | No | Partial — API owner; UI firm-only |
| General Ledger | GET `/api/accounting/reports/general-ledger` | Service: `/portal/accounting` (GL tab); `/ledger` (root). Export UI: Accounting-First only | JSON | checkAccountingAuthority | No | Yes (owner can call API) |
| General Ledger CSV/PDF | GET `.../general-ledger/export/csv`, `export/pdf` | Accounting-First only | CSV, PDF | checkAccountingAuthority | No | Partial — API owner; UI firm-only |
| VAT / Tax | GET `/api/accounting/exports/vat` | Accounting-First only (no Service UI for this endpoint) | CSV | can_accountant_access_business only | **Yes** | No — owner cannot export VAT via this API |
| Transactions (tax detail) | GET `/api/accounting/exports/transactions` | Accounting-First only | CSV | can_accountant_access_business only | **Yes** | No — owner cannot export |
| Levies (NHIL/GETFund/COVID) | GET `/api/accounting/exports/levies` | Accounting-First only | CSV | can_accountant_access_business only | **Yes** | No — owner cannot export |
| Journal entries (list) | GET `/api/ledger/list` | Service: `/ledger` (root). No bulk “journal entries” export endpoint audited | JSON | checkAccountingAuthority | No | Yes (owner can call API) |
| Period summaries | No dedicated export | Periods list at `/api/accounting/periods`; auth can_accountant_access_business (firm-only) | — | Firm-only | Yes | N/A |

**Evidence:** `lib/accountingAuth.ts`: owner → authorized for read/write/approve; employee with role admin or accountant → authorized per accountant_readonly; firm via can_accountant_access_business or getActiveEngagement. Export routes under `app/api/accounting/reports/*/export/*` use checkAccountingAuthority. Export routes under `app/api/accounting/exports/transactions`, `exports/vat`, `exports/levies` use only can_accountant_access_business (no owner/employee path).

---

### 2.2 Accountant-Independence Check

| Check | Result | Evidence |
|-------|--------|----------|
| No export requires accounting_firm_users for P&L/BS/TB/GL | Pass for report + CSV/PDF exports | P&L, BS, TB, GL report and export routes use checkAccountingAuthority; owner and employee (admin/accountant) authorized. |
| No export requires getActiveClientBusinessId | Pass | Exports take business_id in query; no session client read in these routes. |
| All exports authorize via owner OR business_users OR firm | Partial | P&L/BS/TB/GL: owner + employee (admin/accountant) + firm. Transactions/VAT/levies: firm only (can_accountant_access_business). |
| Exports usable outside Finza (CSV/PDF/JSON) | Pass | CSV and PDF responses; JSON for report GETs. No format lock-in. |

---

## PART 3 — WORKSPACE VISIBILITY & HIDING CHECK

### 3.1 Retail

- **Is accounting hidden, or merely non-operational?**  
  Accounting is **non-operational** and **not surfaced**: Retail sidebar has no P&L, Balance Sheet, or accounting workspace link. Ledger-based report APIs (`/api/reports/registers`, `/api/reports/vat-control`) return 410. So accounting is both hidden from menu and blocked at API for legacy report paths. One ledger-derived value is visible: Close Register “expected cash” (Cash account balance).

- **Are owners blocked from seeing books?**  
  Route-level: Owners are **not** blocked from `/reports/balance-sheet` or `/reports/profit-loss` (no industry check). If they navigate by URL, they get getCurrentBusiness and can load P&L/BS via accounting report APIs. Sidebar does not show these links. So they are “blocked” by not being shown the links, not by hard route block.

- **Are exports accessible without entering Accounting-First?**  
  No. Export **UI** exists only on `/accounting/reports/*`; Retail is redirected from `/accounting/*`. Owner could export P&L/BS/TB/GL only by calling APIs directly (same auth as view).

### 3.2 Service

- **Are accounting reports first-class or secondary?**  
  First-class in the menu: Service sidebar has “Profit & Loss”, “Balance Sheet”, “Accounting Portal”, “Chart of Accounts”, “General Ledger”, “Trial Balance”, “Reconciliation”. So accounting **visibility** is first-class; **operational** control (period close, journal post, adjustments) is in Accounting-First only.

- **Is Service treated as “live truth” for business owners?**  
  Yes. Service owner sees ledger-derived P&L, BS, TB, GL via /reports/* and /portal/accounting; data comes from same accounting APIs (trial balance snapshot, etc.). No separate “operational” copy of books.

- **Are accounting concepts visible but protected?**  
  Visible: reports and ledger views. Protected: period close, journal post, reconciliation resolve, export **UI** (export UI only in Accounting-First, which business owners cannot open except /accounting/reconciliation).

### 3.3 Accounting-First

- **Is this workspace optional for businesses?**  
  Yes. Business owners (Retail/Service) are not required to use Accounting-First; they can operate entirely in Retail or Service. Accounting-First is required only for **firm users** (multi-client accountants) or when a business explicitly uses a firm.

- **Is it clearly positioned as advanced / professional rather than mandatory?**  
  accessControl positions it as **accountant-firm only** for UI: business owners are redirected away (except Service → /accounting/reconciliation). So it is “professional” (firm) workspace; not mandatory for owning a business.

---

## PART 4 — EXTERNAL ACCOUNTANT FLOW (NON-FINZA)

**Scenario:** Business owner wants to send books to an accountant who does **not** use Finza.

| Question | Answer | Evidence |
|----------|--------|----------|
| Can the owner export everything needed? | Partially. Owner can **call APIs** to get P&L, BS, TB, GL as JSON and as CSV/PDF (checkAccountingAuthority allows owner). Owner **cannot** use any in-app export **button** for these (buttons only on /accounting/reports/*, which owner cannot open). Owner **cannot** export transactions/VAT/levies CSVs (those APIs require firm). | Export route auth above; accessControl block for /accounting/*. |
| Are exports complete and consistent? | P&L/BS/TB/GL exports are from same canonical sources (trial balance snapshot, report RPCs) as on-screen reports. Transactions/VAT/levies exports are firm-only. | Report and export routes share same RPCs/params. |
| Is there any forced dependency on inviting the accountant to Finza? | No. Owner is not forced to invite accountant. To get **UI** export buttons, owner would need a firm user (or to call APIs directly). To get transactions/VAT/levies CSV, currently only firm user can call those APIs. | No invite flow required; firm-only APIs and UI. |
| Are period states, adjustments, reconciliation reflected in exports? | Yes. Report and export endpoints use accounting periods and ledger data; period state and posted adjustments/reconciliation are in the underlying data. | Reports use period_start, trial balance snapshot, ledger. |

**Verdict:** Owner can send **P&L, Balance Sheet, Trial Balance, General Ledger** to an external accountant by calling export APIs directly (no firm required). Owner **cannot** use in-app export **UI** (firm-only). Owner **cannot** export transactions/VAT/levies CSVs without a firm user.

---

## PART 5 — CONTRACT ALIGNMENT CHECK

| Rule | Observed behavior | Compliant? |
|------|-------------------|------------|
| Accounting visible to owners | Service: P&L, BS, TB, GL visible in /reports/* and /portal/accounting. Retail: not in sidebar; view possible only by URL. | Partial (Service yes; Retail de facto hidden) |
| Firm optional | Yes. Business can operate without firm. Owner can call report/export APIs without firm. | Yes |
| No hidden accounting truth | Ledger is single source for reports. No separate “hidden” books. Export for P&L/BS/TB/GL available to owner at API. | Yes |
| Ledger is single source | Reports and exports use trial balance snapshot and ledger; no dual source. | Yes |
| Workspace boundaries respected | Retail: accounting-blind in menu; Service: read-only accounting; Accounting-First: firm-only UI. | Yes |

---

## PART 6 — ALIGNMENT SCORE

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Business autonomy | 75% | Owner can view P&L/BS/TB/GL in Service and call export APIs; no export UI for owner; transactions/VAT/levies export firm-only. |
| External portability | 70% | P&L/BS/TB/GL exportable by owner via API; no in-app export for owner; transactions/VAT/levies not exportable by owner. |
| Workspace clarity | 90% | Retail accounting-blind; Service read-only accounting clear; Accounting-First firm-only clear. |
| Accountant optionality | 85% | Firm optional for running business; owner can get main reports/exports without firm; some exports (transactions/VAT/levies) and all export UI require firm. |

**Overall Phase 8 alignment score: 80%**

---

## FINAL OUTPUTS (MANDATORY)

1. **Business-type accounting needs matrix:** Part 1.1 (Retail), 1.2 (Service), 1.3 (In-house accountant).
2. **Export coverage table:** Part 2.1.
3. **External accountant scenario verdict:** Part 4 — Owner can send P&L/BS/TB/GL via direct API calls; no in-app export UI for owner; transactions/VAT/levies export firm-only.
4. **Workspace visibility verdict:** Part 3 — Retail: accounting hidden from menu, view by URL only, no export UI. Service: accounting first-class read-only, no export UI. Accounting-First: optional, firm-only UI, export UI only there.
5. **Alignment score:** Part 6 — Overall 80%.
6. **One-sentence verdict:**

> Accounting exposure and external portability are **partially aligned**: owners can view and export P&L, Balance Sheet, Trial Balance, and General Ledger at API level without a firm and can share those with external accountants, but export **UI** is only in the firm-only Accounting-First workspace, and transactions/VAT/levies CSV exports are firm-only at API; no fixes applied in this audit.

---

**End of Phase 8 audit.**  
Evidence only. No fixes. No suggestions.
