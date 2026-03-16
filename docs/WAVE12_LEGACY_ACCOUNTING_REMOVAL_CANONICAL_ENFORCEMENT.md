# Wave 12: Remove Legacy Accounting Route Surfaces + Enforce Canonical Router Contract

## 1. Files changed

### Converted to redirect-only (no UI, no fetch)

| File | Behavior |
|------|----------|
| `app/accounts/page.tsx` | Replaced full Chart of Accounts UI with server redirect to `/accounting/chart-of-accounts` (or `/accounting` when no business_id). |
| `app/ledger/page.tsx` | Already redirect-only; comment updated to Wave 12. |
| `app/trial-balance/page.tsx` | Already redirect-only; comment updated to Wave 12. |
| `app/reconciliation/page.tsx` | Already redirect-only; comment updated to Wave 12. |

### New / updated helpers

| File | Change |
|------|--------|
| `lib/accounting/assertAccountingRouteContext.ts` | Added `assertCanonicalAccountingEntry(pathname)`: in dev, logs warning if pathname touches legacy accounting domain and is not under `/accounting/*`. Legacy patterns: `/ledger`, `/trial-balance`, `/reconciliation`, `/accounts`, `/service/ledger`, `/service/accounting`, `/service/reports/*`. |
| `lib/accounting/devContextLogger.ts` | Added `logLegacyAccountingRouteUsage(pathname)`: dev-only log when route matches legacy accounting pattern and is not canonical. |
| `lib/accounting/routes.ts` | Wave 12: In dev, when building a client-scoped accounting route without `business_id`, log warning. |

### Control Tower

| File | Change |
|------|--------|
| `app/api/accounting/control-tower/work-items/route.ts` | Replaced `assertBusinessIdInRoute` with `buildAccountingRoute` from `@/lib/accounting/routes` for all `drill_route` values. No manual `business_id` concatenation. |

### Service accounting pages — remove manually (Wave 12)

Deletion was not performed by the tool. **Delete these files manually** so legacy `/service/*` accounting routes 404 or you replace them with redirects:

- `app/service/ledger/page.tsx`
- `app/service/reports/trial-balance/page.tsx`
- `app/service/accounting/chart-of-accounts/page.tsx`
- `app/service/accounting/reconciliation/page.tsx`
- `app/service/accounting/health/page.tsx`
- `app/service/accounting/audit/page.tsx`

After deletion, `/service/ledger`, `/service/accounting/*`, `/service/reports/trial-balance` will 404 (or add a single redirect handler if you prefer redirect over 404).

---

## 2. Legacy route → canonical redirect

| Legacy route | Redirect target |
|-------------|------------------|
| `/ledger` | `/accounting/ledger` (or `/accounting/ledger?business_id=...` if query present) |
| `/trial-balance` | `/accounting/reports/trial-balance` (same rule for business_id) |
| `/reconciliation` | `/accounting/reconciliation` (same rule) |
| `/accounts` | `/accounting/chart-of-accounts` (same rule) |

---

## 3. API contract

- **`/api/ledger/list`** — Requires `business_id`; returns 400 `MISSING_BUSINESS_ID` when missing.
- **`/api/accounting/*`** — Client-scoped routes use `business_id` or `businessId` from query/body; key routes use `getBusinessIdFromRequest` / `missingBusinessIdResponse` or equivalent checks and return 400 when missing.
- **Control Tower work-items** — Does not take `business_id`; derives clients from firm engagements. Drill links use `buildAccountingRoute(path, businessId)`.

---

## 4. Helpers

- **`assertBusinessIdInRoute`** — Still exported from `lib/accountingClientContextGuard.ts`; no longer used in work-items (replaced by `buildAccountingRoute`). Kept for possible future drill links.
- **`resolveAccountingBusinessContext`** — Still used by accounting pages (e.g. reports, reconciliation, ledger); not removed.
- **`getActiveClientBusinessId`** — Still used by session/ClientSelector and `resolveAccountingBusinessContext`; not removed.

---

## 5. Grep proof

### No legacy navigation targets (except redirect stubs)

```bash
# No links to legacy paths in app/components (sidebar/dashboard already canonical in Wave 10/11)
rg "href=[\"']/ledger[\"']|route: [\"']/ledger[\"']" finza-web
# → no matches (or only in docs)

rg "href=[\"']/trial-balance[\"']|route: [\"']/trial-balance[\"']" finza-web
# → no matches

rg "route:.*[\"']/service/ledger[\"']|href=.*[\"']/service/ledger[\"']" finza-web
# → no matches in components

rg "route:.*[\"']/service/accounting" finza-web
# → no matches in components
```

Legacy **pages** (`app/ledger`, `app/trial-balance`, `app/reconciliation`, `app/accounts`) exist only as **redirect-only** stubs; no UI or fetch.

### ACTIVE_CLIENT_BUSINESS_ID (cookie/session)

- **Still used** in `lib/firmClientSession.ts` for session persistence and by `resolveAccountingBusinessContext` / ClientSelector.
- **Not used** for accounting **navigation** from Sidebar or dashboard; those use URL `business_id` or `buildAccountingRoute(..., businessId)`.

### getCurrentBusiness in accountant workspace

```bash
rg "getCurrentBusiness" finza-web/app/accounting
# → no matches
```

No `getCurrentBusiness` in `app/accounting`; context is URL or session from ClientSelector/resolver.

---

## 6. Acceptance summary

- **A — Legacy URL access:** Opening `/ledger`, `/trial-balance`, `/reconciliation`, `/accounts` redirects to canonical `/accounting/*` (with `business_id` preserved when present).
- **B — Service legacy URLs:** After manual deletion of service accounting pages, `/service/ledger`, `/service/accounting/*` return 404 (or add redirects if desired).
- **C — API without business_id:** `/api/accounting/*` and `/api/ledger/list` return 400 with `MISSING_BUSINESS_ID` (or equivalent) when required `business_id` is missing.
- **D — Control Tower drill:** All drill routes built with `buildAccountingRoute(path, businessId)`; open canonical accounting pages with `business_id` in URL.

---

## 7. Success criteria (Wave 12)

- Accounting workspace is a **single, deterministic domain** (`/accounting/*`).
- All navigation surfaces use canonical routing (dashboard, Sidebar, Control Tower).
- Legacy accounting UI (full pages at `/accounts`, `/ledger`, etc.) removed; only redirect stubs remain.
- APIs are strictly `business_id`-scoped where required.
- No implicit context for **navigation**; URL (and optional session for resolver) only.
