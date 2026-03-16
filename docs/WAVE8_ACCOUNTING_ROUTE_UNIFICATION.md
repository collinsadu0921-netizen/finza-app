# Wave 8: Accounting Route Unification — Inventory & Classification

**Wave 9 update:** Sidebar no longer uses `getCurrentBusiness()`; service-owner convenience is achieved via `/service/*` and `/service/accounting/*` redirect pages. See `docs/WAVE9_SIDEBAR_NAV_HARDENING.md`.

## 1) INVENTORY: Client-side accounting nav entry points

| Source file | UI surface | Route targets | Canonical? | Depends on business_id? |
|-------------|------------|---------------|------------|---------------------------|
| `components/Sidebar.tsx` | Service sidebar section "ACCOUNTING (Advanced)" | `/accounting/chart-of-accounts`, `/accounting/ledger`, `/accounting/reports/trial-balance`, `/accounting/health`, `/accounting/audit`, `/accounting/control-tower`, `/accounting/periods`, `/accounting/reconciliation`, etc. | Yes (all /accounting/*) | Yes — was missing for service owners (no urlBusinessId on /dashboard) |
| `components/Sidebar.tsx` | FINANCE & REPORTING (service) | `/reports/profit-loss`, `/reports/balance-sheet`, `/portal/accounting` | Reports: legacy but kept; Portal: keep | Yes for reports (current business) |
| `app/accounting/page.tsx` | Accounting hub card grid | All `/accounting/*` (ledger, periods, chart-of-accounts, opening-balances, reconciliation, trial-balance, etc.) | Yes | Yes (appendBusinessId) |
| `components/dashboard/service/ServiceDashboardCockpit.tsx` | Service dashboard summary cards | `cashBalance` → `/service/ledger`, `trialBalance` → `/service/reports/trial-balance`, `balanceSheet` → `/reports/balance-sheet` | No — first two were legacy | Yes (business from props) |
| `app/service/expenses/activity/page.tsx` | Expense activity row links | Ledger → `/service/ledger`, Reconcile → `/reconciliation` | No | Yes (businessId in context) |
| `app/portal/accounting/page.tsx` | Portal report tabs | Uses `/api/accounting/reports/*` (canonical API); internal links already canonical | Yes (API); page kept | Yes |
| `app/accounting/control-tower/[businessId]/page.tsx` | Control tower client drill links | Links to `/accounting/ledger`, `/accounting/reconciliation`, etc. with business_id | Yes | Yes (from client-summary API) |
| `app/api/accounting/control-tower/client-summary/route.ts` | Client summary deep links | `ledger`, `reconciliation`, `reports` paths with business_id | Yes | Yes |

## 2) KEEP / REDIRECT / DELETE

### KEEP (canonical `/accounting/*` only)
- All routes under `app/accounting/*` (ledger, chart-of-accounts, periods, reconciliation, opening-balances, opening-balances-imports, journals, drafts, reports/*, trial-balance, afs, control-tower, health, audit, exceptions, carry-forward, firm/*, etc.)
- `app/portal/accounting/page.tsx` (client portal; already uses canonical APIs)
- `app/reports/balance-sheet`, `app/reports/profit-loss`, `app/reports/page.tsx` (finance & reporting for current business — not “advanced accounting”; keep as-is per constraints)

### REDIRECT (legacy → canonical)
- `/trial-balance` → `/accounting/reports/trial-balance` (preserve `?business_id=` if present; else redirect to `/accounting`)
- `/ledger` → `/accounting/ledger` (same rule)
- `/reconciliation` → `/accounting/reconciliation` (same rule)
- `/reconciliation/[accountId]` → `/accounting/reconciliation?business_id=...` (business_id from session/context where possible)
- `/reconciliation/[accountId]/import` → `/accounting/reconciliation?business_id=...`
- `/service/ledger` → `/accounting/ledger?business_id=<service business>` (client redirect when business known)
- `/service/reports/trial-balance` → `/accounting/reports/trial-balance?business_id=...`
- `/service/reports/balance-sheet` → `/accounting/reports/balance-sheet?business_id=...`
- `/service/reports/profit-and-loss` → `/accounting/reports/profit-and-loss?business_id=...`

### DELETE (no separate delete; legacy pages replaced by redirects)
- Legacy page *content* removed and replaced with redirects; route segments remain so URLs still resolve (redirect only).

## 3) Files modified (Wave 8)

| File | Change |
|------|--------|
| `components/Sidebar.tsx` | Added `currentBusinessId` state; set from `getCurrentBusiness` in `loadIndustry`. Service industry accounting links now use `effectiveBusinessId = urlBusinessId ?? currentBusinessId` so owners get `/accounting/*?business_id=` when on dashboard. |
| `components/dashboard/service/ServiceDashboardCockpit.tsx` | Replaced static `DASHBOARD_ROUTES` with `getDashboardRoutes(businessId)`; Cash Balance → `/accounting/ledger?business_id=`, Trial Balance → `/accounting/reports/trial-balance?business_id=`. |
| `app/service/expenses/activity/page.tsx` | `getViewLink(row, businessId)` now returns `/accounting/ledger` and `/accounting/reconciliation` with `business_id`; call site updated to pass `businessId`. |
| `app/trial-balance/page.tsx` | Replaced with server redirect to `/accounting/reports/trial-balance?business_id=...` or `/accounting`. |
| `app/ledger/page.tsx` | Replaced with server redirect to `/accounting/ledger?business_id=...` or `/accounting`. |
| `app/reconciliation/page.tsx` | Replaced with server redirect to `/accounting/reconciliation?business_id=...` or `/accounting`. |
| `app/reconciliation/[accountId]/page.tsx` | Replaced with server redirect to `/accounting/reconciliation` (optional `?business_id=`). |
| `app/reconciliation/[accountId]/import/page.tsx` | Replaced with server redirect to `/accounting/reconciliation` (optional `?business_id=`). |
| `app/service/ledger/page.tsx` | Replaced with redirect page using `RedirectToCanonicalAccounting` → `/accounting/ledger?business_id=<service business>` (preserves `highlight`). |
| `app/service/reports/trial-balance/page.tsx` | Replaced with `RedirectToCanonicalAccounting` → `/accounting/reports/trial-balance`. |
| `app/service/reports/balance-sheet/page.tsx` | Replaced with `RedirectToCanonicalAccounting` → `/accounting/reports/balance-sheet`. |
| `app/service/reports/profit-and-loss/page.tsx` | Replaced with `RedirectToCanonicalAccounting` → `/accounting/reports/profit-and-loss`. |
| `components/accounting/RedirectToCanonicalAccounting.tsx` | **New.** Client component that resolves service business and redirects to canonical path with `business_id`. |
| `components/accounting/OpenAccountingButton.tsx` | **New.** Button linking to `/accounting?business_id=${businessId}`. |
| `app/accounting/control-tower/[businessId]/page.tsx` | Added `OpenAccountingButton` in header for "Open Accounting →". |

## 4) Single source of truth

**Only `/accounting/*` performs accountant workflows.** Client workspace must not host “advanced accounting” pages that call accounting APIs with mixed context. All links to General Ledger, Chart of Accounts, Trial Balance, Accounting Periods, Reconciliation, Opening Balances, Journals, AFS, and financial reports (when used in an accounting context) point to `/accounting/...` with `?business_id=` when a client is required.
