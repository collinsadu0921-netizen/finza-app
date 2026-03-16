# Wave 13: Final Context Resolver Simplification + Dead Helper Elimination

## 1. Resolver file created

**`lib/accounting/resolveAccountingContext.ts`**

- **Single authority resolver** for accounting workspace and related routes (portal, reports, API).
- **Contract:** `resolveAccountingContext({ supabase?, userId?, searchParams?, pathname?, source? })`
- **Accountant:** Requires `business_id` in URL. Missing → `{ error: "CLIENT_REQUIRED" }` + dev log.
- **Owner/Employee:** Use `business_id` from URL if present; else fallback to `getCurrentBusiness(supabase, userId)`.
- **Return:** `{ businessId, authoritySource: "accountant"|"owner"|"employee" }` or `{ error: "CLIENT_REQUIRED" }`.
- **Dev:** When accountant and no `business_id`, logs error and calls `logAccountingContextResolverUsage(source)`.

---

## 2. Helper files deleted / gutted

| File | Action |
|------|--------|
| `lib/accounting/resolveWorkspaceBusiness.ts` | **Deleted.** All callers migrated to `resolveAccountingContext`. |
| `lib/accountingBusinessContext.ts` | **Deleted.** `resolveAccountingBusinessContext` removed; callers use `resolveAccountingContext`. |
| `lib/accountingClientContextGuard.ts` | **Removed** `assertBusinessIdInRoute`. Drill links use `buildAccountingRoute` (Wave 12). |
| `lib/firmClientSession.ts` | **Gutted.** Removed `getActiveClientBusinessId`, `setActiveClientBusinessId`, `ACTIVE_CLIENT_BUSINESS_ID_COOKIE`, cookie logic, and `clientChanged` event. Kept `clearActiveClient()` as no-op so `firmSession.setActiveFirmId` still compiles. |

---

## 3. Migration file list

### From `resolveAccountingBusinessContext` → `resolveAccountingContext`

- `app/accounting/reports/profit-and-loss/page.tsx`
- `app/accounting/exceptions/page.tsx`
- `app/accounting/trial-balance/page.tsx`
- `app/accounting/opening-balances/page.tsx`
- `app/accounting/reports/general-ledger/page.tsx`
- `app/accounting/reports/balance-sheet/page.tsx`
- `app/accounting/reports/trial-balance/page.tsx`
- `app/accounting/reconciliation/page.tsx`
- `app/accounting/carry-forward/page.tsx`
- `app/accounting/adjustments/review/page.tsx`
- `app/accounting/afs/page.tsx`
- `app/accounting/adjustments/page.tsx`
- `app/accounting/audit/page.tsx`
- `app/accounting/health/page.tsx`
- `app/accounting/periods/__tests__/ui.sanity.test.tsx` (mock updated)

### From `resolveWorkspaceBusiness` → `resolveAccountingContext`

- `app/portal/accounting/page.tsx` (source: `"portal"`)
- `app/reports/balance-sheet/page.tsx` (source: `"reports"`)
- `app/reports/profit-loss/page.tsx` (source: `"reports"`)
- `app/reports/page.tsx` (source: `"reports"`)
- `app/reports/vat/diagnostic/page.tsx` (source: `"reports"`)
- `app/api/reports/registers/route.ts` (source: `"api"`)
- `app/api/reports/tax-summary/route.ts` (source: `"api"`)
- `app/api/reports/balance-sheet/route.ts` (source: `"api"`)
- `app/api/reports/profit-loss/route.ts` (source: `"api"`)
- `app/api/reports/vat-control/route.ts` (source: `"api"`)
- `app/api/reports/trial-balance/route.ts` (source: `"api"`)
- `app/api/reports/sales-summary/route.ts` (source: `"api"`)
- `app/api/reports/aging/route.ts` (comment only)

### Dev logger

- **`lib/accounting/devContextLogger.ts`** — Added `logAccountingContextResolverUsage(source: "workspace"|"api"|"portal"|"reports")`.

---

## 4. Grep proof

### Cookie client context usage

```bash
rg "ACTIVE_CLIENT_BUSINESS_ID|getActiveClientBusinessId" finza-web --glob "*.ts" --glob "*.tsx"
# → 0 matches (definitions removed from firmClientSession)
```

### Session client resolver in accounting

- No `getActiveClientBusinessId` anywhere; accounting context is URL-only via `resolveAccountingContext` or `useAccountingBusiness` (URL only).

### Direct getCurrentBusiness inside accounting APIs

```bash
rg "getCurrentBusiness" finza-web/app/api/accounting
# → 0 matches
```

### Dead helpers — 0 usages

```bash
rg "resolveWorkspaceBusiness" finza-web --glob "*.ts" --glob "*.tsx"
# → 0 matches

rg "resolveAccountingBusinessContext" finza-web --glob "*.ts" --glob "*.tsx"
# → 0 matches

rg "assertBusinessIdInRoute" finza-web --glob "*.ts" --glob "*.tsx"
# → 0 matches
```

---

## 5. Acceptance summary

- **A — Accountant:** Opening `/accounting/*` without `business_id` → EmptyState (CLIENT_REQUIRED); no session/cookie fallback.
- **B — Owner:** Opening `/accounting/*` without `business_id` → resolver uses `getCurrentBusiness`; page loads with owner business.
- **C — Reports/portal:** Accountant requires URL `business_id`; owner fallback allowed via `resolveAccountingContext`.
- **D — API:** Accounting/reports APIs use `resolveAccountingContext` or explicit `business_id`; no direct `getCurrentBusiness` in `app/api/accounting`.

---

## 6. Success criteria (Wave 13)

- Exactly **one** accounting context resolver: `resolveAccountingContext`.
- Cookie/session client context **removed** (no `getActiveClientBusinessId` / `setActiveClientBusinessId`).
- URL is the single source of truth for accountant client context.
- `useAccountingBusiness` remains **URL-only** (no session/cookie).
- Dead helpers removed: `resolveWorkspaceBusiness`, `resolveAccountingBusinessContext`, `assertBusinessIdInRoute`.
