# PHASE 10 — Execution Sequencing Deliverable

**Date:** 2025-01-31  
**Status:** Complete  

---

## 1. List of UI Surfaces Modified

| Surface | Change |
|---------|--------|
| `app/reports/profit-loss/page.tsx` | Added `resolvedPeriodStart` state; Export CSV / Export PDF links (hidden when `business?.industry === "retail"`); banner copy "Business reports — read-only"; Retail note "View only; export is not available in Retail workspace." |
| `app/reports/balance-sheet/page.tsx` | Added `resolvedPeriodStart` state; Export CSV / Export PDF links (hidden when `business?.industry === "retail"`); banner "Business reports — read-only"; Retail note for view-only. |
| `app/portal/accounting/page.tsx` | Banner "Business reports — read-only"; Export CSV / Export PDF for P&L, Balance Sheet, Trial Balance, General Ledger (when data and context loaded). |
| `components/Sidebar.tsx` | Retail "Sales & Reports": added "View Profit & Loss" → `/reports/profit-loss`, "View Balance Sheet" → `/reports/balance-sheet`. |
| `app/accounting/page.tsx` | Intro copy: "Professional accounting actions: period close, adjustments, reconciliation, and transaction-level exports are available in this workspace. Transaction-level and VAT/tax exports are designed for professional accounting workflows and available through accountant tools." |

---

## 2. Confirmation of Export UI Exposure

| Location | P&L | Balance Sheet | Trial Balance | General Ledger |
|----------|-----|---------------|---------------|----------------|
| `/reports/profit-loss` | Export CSV, Export PDF (when not Retail) | — | — | — |
| `/reports/balance-sheet` | — | Export CSV, Export PDF (when not Retail) | — | — |
| `/portal/accounting` | Export CSV, Export PDF | Export CSV, Export PDF | Export CSV, Export PDF | Export CSV, Export PDF |

- Existing endpoints only: `/api/accounting/reports/profit-and-loss/export/csv`, `export/pdf`; same for balance-sheet, trial-balance, general-ledger.
- Authorization unchanged: `checkAccountingAuthority` (owner/employee/firm).
- No period close, adjustments, or reconciliation resolve exposed.
- No bulk or multi-period exports added.
- Retail: Export buttons not shown (`business?.industry === "retail"`); sidebar has View P&L / View Balance Sheet only.

---

## 3. Verification Checklist (Pass/Fail)

| Criterion | Result |
|-----------|--------|
| Business owner (no firm) can view and export P&L / BS / TB / GL via UI | **Pass** — Export links on `/reports/profit-loss`, `/reports/balance-sheet`, and `/portal/accounting`; auth via `checkAccountingAuthority` (owner allowed). |
| No accounting mutation available outside Accounting-First | **Pass** — No changes to accessControl or mutation APIs; period close, adjustments, reconciliation resolve remain under `/accounting/*` (firm-only for business owners except Service → `/accounting/reconciliation` read-only). |
| Retail remains accounting-blind operationally | **Pass** — Retail has read-only View P&L / View Balance Sheet; no export in Retail; no ledger drill-down, period controls, or accounting workspace access added. |
| Firm workflows remain strictly superior | **Pass** — Accounting workspace and firm-only APIs unchanged; transaction/VAT/levies exports remain firm-only; boundary copy added. |
| No new permissions added | **Pass** — Only existing `checkAccountingAuthority` and existing export endpoints used; no new roles or permission checks. |

---

## 4. Statement of Moat Preservation

- **Multi-client dashboards:** Only in Accounting-First; no new exposure.
- **Bulk exports:** Not added to Business surfaces; transaction/VAT/levies exports remain firm-only (`can_accountant_access_business`).
- **Period close / reopen:** Only via `/accounting/periods`; gated by `accessControl` (accounting_firm_users) and API auth; no change.
- **Adjustments / carry-forward:** Only under `/accounting/*`; no change.
- **Reconciliation resolution:** Only via `/accounting/reconciliation` resolve API; business owners (Service) have read-only signpost only; no change.
- **Audit readiness workflows:** Only in Accounting-First; no change.

Business owners can view and export core financial statements (P&L, BS, TB, GL) from `/reports/*` and `/portal/accounting` without a firm. Transaction-level and VAT/tax exports remain firm-only. Firm moat preserved.

---

**End of Phase 10 deliverable.**
