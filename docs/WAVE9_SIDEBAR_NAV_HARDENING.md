# Wave 9: Sidebar Nav Hardening — No Owner Fallback in Shared Nav

## Goal

Remove **owner-fallback bleed** from shared navigation. Wave 8 had introduced `getCurrentBusiness()` in `components/Sidebar.tsx` to set `currentBusinessId` for service owners so accounting links had a `business_id`. That reintroduced risk: the same Sidebar runs on both service and accounting surfaces, and any owner fallback in nav could let accountant context accidentally use an owner’s business.

Wave 9 ensures:

- **No `getCurrentBusiness()` (or any owner fallback) in Sidebar.**
- **Accountant firm users:** URL-only; append `business_id` only from `urlBusinessId`; never resolve “current” business in nav.
- **Service owners:** Same convenience (land on canonical `/accounting/*` with a business_id) via **redirect pages** under `/service/*` and `/service/accounting/*`, not via Sidebar resolving business.

---

## Rules Applied

### Rule A — Sidebar is URL-only in accountant workspace

- If `pathname.startsWith("/accounting")`:
  - **Never** call `getCurrentBusiness()`.
  - `businessIdForLinks = urlBusinessId` only (from `useSearchParams().get("business_id")`).
- On accounting paths, industry is resolved only from the business identified by `urlBusinessId` (fetch `industry` from `businesses` by that id). No fallback to “current” user business.

### Rule B — Service owner convenience without getCurrentBusiness in Sidebar

- **Option 1 (implemented):** Service “Accounting (Advanced)” links point to **redirect pages**:
  - `/service/ledger` → redirects to `/accounting/ledger?business_id=<resolved>`
  - `/service/reports/trial-balance` → `/accounting/reports/trial-balance?business_id=...`
  - `/service/reports/balance-sheet` → `/accounting/reports/balance-sheet?business_id=...`
  - `/service/reports/profit-and-loss` → `/accounting/reports/profit-and-loss?business_id=...`
  - `/service/accounting/chart-of-accounts` → `/accounting/chart-of-accounts?business_id=...`
  - `/service/accounting/health` → `/accounting/health?business_id=...`
  - `/service/accounting/audit` → `/accounting/audit?business_id=...`
  - `/service/accounting/reconciliation` → `/accounting/reconciliation?business_id=...`
- Sidebar does **not** append `business_id` for these; the redirect page uses `RedirectToCanonicalAccounting` (which resolves service business server-side/client-side in the page, not in the shared nav).

---

## Sidebar Behavior Summary

| User type        | Path        | Industry source                    | Accounting (Advanced) links     | business_id in links      |
|------------------|------------|-------------------------------------|---------------------------------|---------------------------|
| Firm (accountant)| `/accounting/*` | From `businesses` by `urlBusinessId` | `/accounting/*`                 | `urlBusinessId` only; disabled if missing |
| Service owner    | Any        | `getTabIndustryMode()` (sessionStorage) | `/service/ledger`, `/service/accounting/*`, etc. | Not appended; redirect pages resolve |

- **No DB lookup for “current business” in Sidebar** on non-accounting paths; industry comes from `getTabIndustryMode()` only (set elsewhere, e.g. dashboard/layout).
- **No `getCurrentBusiness`** anywhere in `components/Sidebar.tsx`.

---

## Files Changed (Wave 9)

| File | Change |
|------|--------|
| `components/Sidebar.tsx` | Removed `getCurrentBusiness` import and all usages. Removed `currentBusinessId` state. `loadIndustry`: on accounting path with `urlBusinessId` → fetch industry from `businesses` by that id; otherwise set industry from `getTabIndustryMode()` only. ACCOUNTING (Advanced): firm users → `/accounting/*` with `urlBusinessId`; service owners → `/service/ledger`, `/service/accounting/*` redirect routes. Link logic: `effectiveBusinessId = urlBusinessId` only; `/service/*` routes never append `business_id` and never disabled. |
| `app/service/accounting/chart-of-accounts/page.tsx` | **New.** Redirect to `/accounting/chart-of-accounts?business_id=<resolved>`. |
| `app/service/accounting/health/page.tsx` | **New.** Redirect to `/accounting/health?business_id=<resolved>`. |
| `app/service/accounting/audit/page.tsx` | **New.** Redirect to `/accounting/audit?business_id=<resolved>`. |
| `app/service/accounting/reconciliation/page.tsx` | **New.** Redirect to `/accounting/reconciliation?business_id=<resolved>`. |
| `docs/WAVE9_SIDEBAR_NAV_HARDENING.md` | **New.** This document. |

---

## Acceptance (manual)

- **A) Firm user:** On `/accounting/control-tower`, open sidebar and use client links. No DB lookup in Sidebar for current business; links go to `/accounting/*?business_id=<id>`; no owner fallback.
- **B) Service owner:** From dashboard sidebar, click “General Ledger” (or Trial Balance, Chart of Accounts, etc.). Navigates to `/service/ledger` (or corresponding `/service/...`) then redirects to `/accounting/ledger?business_id=<owner business>` (or equivalent).
- **C)** `/accounting/*` still requires URL `business_id` for client-scoped pages; no reintroduction of cookies/session for client selection in Sidebar.

---

## Relation to Wave 8

Wave 8 had unified accounting routes and added `currentBusinessId` from `getCurrentBusiness()` in Sidebar for service owners. Wave 9 removes that and keeps service-owner convenience entirely via **redirect pages** under `/service/*` and `/service/accounting/*`, so the Sidebar stays URL-only and free of owner fallback.
