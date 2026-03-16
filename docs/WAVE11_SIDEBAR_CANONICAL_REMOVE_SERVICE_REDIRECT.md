# Wave 11: Remove Last Service Redirect Layer + Sidebar Fully Canonical

## 1. Files changed

| File | Change |
|------|--------|
| `components/Sidebar.tsx` | Removed all `/service/*` accounting navigation. Added `serviceBusinessId` state and effect that calls `getCurrentBusiness()` only when NOT on `/accounting/*`. Unified ACCOUNTING (Advanced) section to canonical routes via `buildAccountingRoute(path, sidebarBusinessId)`. Client-scoped links disabled when no `sidebarBusinessId`. Nav item render uses `item.route` as target; removed `assertBusinessIdInRoute` and service-redirect logic. `isActive` uses path-only for query URLs. Removed `ACCOUNTING_CLIENT_ROUTES`. |
| `lib/accounting/routes.ts` | Doc comment: helper safely handles existing query params (appends with `&`). |
| `app/service/ledger/page.tsx` | Top-of-file deprecated comment (Wave 11). |
| `app/service/reports/trial-balance/page.tsx` | Top-of-file deprecated comment (Wave 11). |
| `app/service/accounting/chart-of-accounts/page.tsx` | Top-of-file deprecated comment (Wave 11). |
| `app/service/accounting/reconciliation/page.tsx` | Top-of-file deprecated comment (Wave 11). |
| `app/service/accounting/health/page.tsx` | Top-of-file deprecated comment (Wave 11). |
| `app/service/accounting/audit/page.tsx` | Top-of-file deprecated comment (Wave 11). |

---

## 2. Before / after Sidebar route targets

### ACCOUNTING (Advanced) — Service owner (non–firm user)

| Sidebar item | Before | After |
|--------------|--------|--------|
| Chart of Accounts | `/service/accounting/chart-of-accounts` | `/accounting/chart-of-accounts?business_id=__BID__` |
| General Ledger | `/service/ledger` | `/accounting/ledger?business_id=__BID__` |
| Trial Balance | `/service/reports/trial-balance` | `/accounting/reports/trial-balance?business_id=__BID__` |
| Health | `/service/accounting/health` | `/accounting/health?business_id=__BID__` |
| Audit | `/service/accounting/audit` | `/accounting/audit?business_id=__BID__` |
| Reconciliation | `/service/accounting/reconciliation` | `/accounting/reconciliation?business_id=__BID__` |
| Audit Log | `/audit-log` | `/audit-log` (unchanged) |

### ACCOUNTING (Advanced) — Accountant (firm user)

| Sidebar item | Before | After |
|--------------|--------|--------|
| Chart of Accounts | `/accounting/chart-of-accounts` (no query in nav; appended in render from `urlBusinessId`) | `buildAccountingRoute(..., sidebarBusinessId)` → `/accounting/chart-of-accounts?business_id=__BID__` when URL has business_id |
| General Ledger | `/accounting/ledger` | Same pattern |
| Trial Balance | `/accounting/reports/trial-balance` | Same pattern |
| Reconciliation | `/accounting/reconciliation` | Same pattern |
| Periods | `/accounting/periods` | Same pattern |
| Audit | `/accounting/audit` | Same pattern |
| Health | `/accounting/health` | Same pattern |
| Control Tower | `/accounting/control-tower` | `/accounting/control-tower` (no business_id) |
| Forensic Runs / Tenants / Audit Log | unchanged | unchanged |

**Business ID source (Wave 11):**

- **Priority 1:** `urlBusinessId` from `searchParams.get("business_id")` when on any page.
- **Priority 2:** For service owners only and when **not** on `/accounting/*`: `serviceBusinessId` from `getCurrentBusiness(supabase, user.id)` in an effect (never during accounting route render).
- **If neither:** Client-scoped accounting links are **disabled**; Control Tower remains enabled.

---

## 3. Grep proof

### No `/service/ledger` navigation targets remain

```bash
rg "route:.*[\"']/service/ledger" finza-web
# → no matches
```

### No `/service/accounting` navigation targets remain

```bash
rg "route:.*[\"']/service/accounting" finza-web
# → no matches
```

### No `/service/reports` accounting navigation in Sidebar

```bash
rg "/service/reports" finza-web/components/Sidebar.tsx
# → no matches
```

(Only remaining `/service/` in Sidebar is `route: "/service/invitations"` — Accountant Requests, not accounting.)

### Sidebar only builds `/accounting/*` routes for accounting

- All accounting items use `buildAccountingRoute("/accounting/...", sidebarBusinessId ?? undefined)` or `buildAccountingRoute("/accounting/control-tower")`.
- No string in the ACCOUNTING section starts with `/service/`.

---

## 4. Acceptance summary

- **A — Service owner:** From service dashboard, General Ledger goes directly to `/accounting/ledger?business_id=<ownerBusiness>`; does not hit `/service/ledger`.
- **B — Accountant:** From `/accounting/control-tower`, links use only URL `business_id`; no DB fallback for nav.
- **C — Multi-tab:** Tab A (client A) and Tab B (service owner ledger) keep correct business per tab via URL.
- **D — Disabled state:** When Sidebar cannot determine `businessId`, client-scoped accounting links are disabled; Control Tower remains enabled.

---

## 5. Success criteria (Wave 11)

- `/accounting/*` is the **only** accounting navigation surface from the Sidebar.
- `/service/*` accounting pages remain only as legacy redirects (deprecated comments added; not deleted).
- Sidebar accounting navigation is deterministic and URL-driven (or service-business when off accounting).
- No server redirect is required to reach the accounting workspace from the Sidebar.
