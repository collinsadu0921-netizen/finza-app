# AUDIT + DESIGN — Automatic Default Period Resolver

**Date:** 2026-02-01  
**Auditor:** Principal Accounting Systems Architect  
**Mode:** READ-ONLY. Evidence only. No patches.  
**Objective:** Design automatic default period resolver (latest OPEN period with activity → latest SOFT_CLOSED with activity → latest LOCKED with activity → current month fallback)

---

## SECTION A — Inventory Table of ALL Period Resolution Call-Sites

| File | Lines | Current Behavior | Classification | Uses Current Date? | Uses Query Param? | Uses Ledger Data? |
|------|-------|------------------|----------------|-------------------|-------------------|-------------------|
| `app/api/reports/trial-balance/route.ts` | 28, 34-40, 43-45, 58-59 | `asOfDate = searchParams.get("as_of_date") \|\| new Date().toISOString().split("T")[0]` → resolves period containing `asOfDate` via `lte("period_start", asOfDate) AND gte("period_end", asOfDate)`. Falls back to `ensure_accounting_period(p_business_id, asOfDate)` if not found. | **PUBLIC REPORT ROUTE** | ✅ YES (default) | ✅ YES (`as_of_date`) | ❌ NO |
| `app/api/reports/balance-sheet/route.ts` | 28, 35-41, 44-46, 59-60 | `asOfDate = searchParams.get("as_of_date") \|\| new Date().toISOString().split("T")[0]` → resolves period containing `asOfDate` via `lte("period_start", asOfDate) AND gte("period_end", asOfDate)`. Falls back to `ensure_accounting_period(p_business_id, asOfDate)` if not found. | **PUBLIC REPORT ROUTE** | ✅ YES (default) | ✅ YES (`as_of_date`) | ❌ NO |
| `app/api/reports/profit-loss/route.ts` | 28-29, 34-38, 41-47, 50-52, 65-67 | `startDate`/`endDate` query params **REQUIRED** (no default). Resolves period containing `startDate` via `lte("period_start", startDate) AND gte("period_end", endDate)`. Falls back to `ensure_accounting_period(p_business_id, startDate)` if not found. | **PUBLIC REPORT ROUTE** | ❌ NO | ✅ YES (required) | ❌ NO |
| `app/api/accounting/reports/trial-balance/route.ts` | 31, 64-68, 71-76, 80-82, 88-93 | `periodStart` query param **REQUIRED**. Exact match `period_start = periodStart`. Falls back to `ensure_accounting_period` if not found. | **ACCOUNTING WORKSPACE ROUTE** | ❌ NO | ✅ YES (required) | ❌ NO |
| `app/api/accounting/reports/balance-sheet/route.ts` | 32, 58-62, 65-70, 74-76, 82-87 | `periodStart` query param **REQUIRED**. Exact match `period_start = periodStart`. Falls back to `ensure_accounting_period` if not found. | **ACCOUNTING WORKSPACE ROUTE** | ❌ NO | ✅ YES (required) | ❌ NO |
| `app/api/accounting/reports/profit-and-loss/route.ts` | 32-34, 60-64, 67-72, 76-78, 84-89 | `periodStart` query param **REQUIRED**. Exact match `period_start = periodStart`. Falls back to `ensure_accounting_period` if not found. | **ACCOUNTING WORKSPACE ROUTE** | ❌ NO | ✅ YES (required) | ❌ NO |
| `app/api/accounting/reports/trial-balance/export/csv/route.ts` | 36, 63-67, 70-75, 79-82, 88-93 | `periodStart` query param **REQUIRED**. Exact match `period_start = periodStart`. Falls back to `ensure_accounting_period` if not found. | **EXPORT ENDPOINT** | ❌ NO | ✅ YES (required) | ❌ NO |
| `app/api/accounting/reports/balance-sheet/export/pdf/route.ts` | 26-27, 53-56 | `asOfDate = searchParams.get("as_of_date") \|\| new Date().toISOString().split("T")[0]`. Calls `get_balance_sheet(p_business_id, p_as_of_date)` RPC (legacy, not canonical). | **EXPORT ENDPOINT** | ✅ YES (default) | ✅ YES (`as_of_date`) | ❌ NO |
| `app/api/accounting/reports/general-ledger/route.ts` | 42-44, 97-103, 107-109, 115-120, 127-128 | `periodStart` OR `startDate`/`endDate` query params. If `periodStart` provided, exact match `period_start = periodStart`. If `startDate`/`endDate`, uses direct date range. **REQUIRES** either `periodStart` OR both `startDate`/`endDate`. | **ACCOUNTING WORKSPACE ROUTE** | ❌ NO | ✅ YES | ❌ NO |
| `app/api/accounting/periods/resolve/route.ts` | 32, 70-77, 97-100, 111-118 | `fromDate` query param **REQUIRED**. Resolves period containing `fromDate` via `lte("period_start", fromIso) AND gte("period_end", fromIso)`. Falls back to `ensure_accounting_period` if not found. | **ACCOUNTING WORKSPACE ROUTE** | ❌ NO | ✅ YES (`from_date`) | ❌ NO |
| `app/api/reports/vat-control/route.ts` | 47-48, 50-54, 127, 160-161 | `startDate`/`endDate` query params **REQUIRED**. Direct date range filter on `journal_entries.date`, **NO period resolution**. | **PUBLIC REPORT ROUTE** (bypasses period system) | ❌ NO | ✅ YES (required) | ✅ YES (filters ledger) |
| `app/api/reports/registers/route.ts` | 59-60, 62-65, 142-143 | `startDate`/`endDate` query params **REQUIRED**. Direct date range filter on `journal_entries.date`, **NO period resolution**. | **PUBLIC REPORT ROUTE** (bypasses period system) | ❌ NO | ✅ YES (required) | ✅ YES (filters ledger) |
| `app/api/ledger/list/route.ts` | 45-46, 78-83 | `startDate`/`endDate` query params **OPTIONAL**. Direct date range filter on `journal_entries.date`, **NO period resolution**. | **ACCOUNTING WORKSPACE ROUTE** (bypasses period system) | ❌ NO | ✅ YES (optional) | ✅ YES (filters ledger) |
| `app/api/accounting/adjustments/route.ts` | 26, 63-64, 74-76, 88-89 | `periodStart` query param **OPTIONAL**. If provided, exact match `period_start = periodStart`. Filters adjustments by period boundaries. | **ACCOUNTING WORKSPACE ROUTE** | ❌ NO | ✅ YES (optional) | ❌ NO |
| `app/api/accounting/adjustments/apply/route.ts` | 38, 47, 71-72, 85-87, 173 | `period_start` body param **REQUIRED** (YYYY-MM-01 format). Validates format, exact match `period_start = period_start`. | **ACCOUNTING WORKSPACE ROUTE** | ❌ NO | N/A (body param) | ❌ NO |
| `app/api/accounting/periods/close/route.ts` | 22, 25, 41-43, 47-48, 192 | `period_start` body param **REQUIRED** (YYYY-MM-01 format). Validates format, exact match `period_start = period_start`. | **ACCOUNTING WORKSPACE ROUTE** | ❌ NO | N/A (body param) | ❌ NO |
| `app/api/accounting/periods/route.ts` | 59 | Lists all periods, orders by `period_start DESC`. No period resolution. | **ACCOUNTING WORKSPACE ROUTE** | ❌ NO | ❌ NO | ❌ NO |
| `app/api/accounting/firm/clients/route.ts` | 30, 109-112, 128-129 | `periodStart` query param **OPTIONAL**. If provided, filters clients by period. Gets "current period status (latest period)" via `order("period_start", { ascending: false }) LIMIT 1`. | **ACCOUNTING WORKSPACE ROUTE** | ❌ NO | ✅ YES (optional) | ❌ NO |
| `app/dashboard/page.tsx` | 39, 454, 472-474, 1109, 1168 | `collectedThisMonth` uses current month boundaries: `new Date().getMonth()`, `new Date().getFullYear()`. Filters payments by current month date range. UI labels: "This month" (line 1109), "Cash collected · this month" (line 1168). | **DASHBOARD WIDGET** | ✅ YES | ❌ NO | ✅ YES (filters payments) |
| `app/accounting/reports/trial-balance/page.tsx` | 37, 121, 177, 194 | UI page. `selectedPeriodStart` state. Calls API with `period_start` param. No default period selection in UI. | **UI PAGE** | ❌ NO | ✅ YES (user selects) | ❌ NO |
| `app/accounting/reports/balance-sheet/page.tsx` | 264-278, 285-298 | UI page. `selectedPeriodStart` state (optional). `asOfDate` state (required). Period selector is optional, sets `asOfDate` to `period_end` if selected. | **UI PAGE** | ❌ NO | ✅ YES (user selects) | ❌ NO |
| `app/reports/balance-sheet/page.tsx` | 297-302, 309-320, 334 | UI page. `asOfDate` state. Displays "Financial position as of {asOfDate}". Net income period selector includes "This Month" option (line 334). | **UI PAGE** | ❌ NO | ✅ YES (user selects) | ❌ NO |
| `supabase/migrations/094_accounting_periods.sql:59-92` | 59-92 | `ensure_accounting_period(p_business_id, p_date)` RPC. Resolves period for month containing `p_date` via `DATE_TRUNC('month', p_date)`. Creates period if not found with `status = 'open'`. | **RPC FUNCTION** | ❌ NO | N/A (RPC param) | ❌ NO |
| `supabase/migrations/169_trial_balance_canonicalization.sql:110-111` | 110-111 | `generate_trial_balance` filters `journal_entry_lines` by `je.date >= period_start AND je.date <= period_end`. Uses period boundaries from `accounting_periods` record. | **RPC FUNCTION** (uses period) | ❌ NO | N/A (uses period boundaries) | ✅ YES (reads ledger) |

**Summary:**
- **Public Report Routes with Defaults:** 2 routes (`trial-balance`, `balance-sheet`) default to current date
- **Public Report Routes Requiring Params:** 1 route (`profit-loss`) requires explicit dates
- **Accounting Workspace Routes:** 6+ routes require explicit `period_start` param
- **Export Endpoints:** 1 route (`balance-sheet/export/pdf`) defaults to current date, others require explicit params
- **Dashboard Widgets:** 1 widget (`collectedThisMonth`) uses current month
- **UI Pages:** 3+ pages allow user period selection, no automatic defaults

---

## SECTION B — Impact Analysis by Module

### B.1 Public Report Routes

#### Trial Balance (`app/api/reports/trial-balance/route.ts`)

**Current Default Behavior:**
```typescript
const asOfDate = searchParams.get("as_of_date") || new Date().toISOString().split("T")[0]
// Lines 34-40: Resolves period containing asOfDate
let { data: period, error: periodError } = await supabase
  .from("accounting_periods")
  .select("id, period_start, period_end")
  .eq("business_id", business.id)
  .lte("period_start", asOfDate)
  .gte("period_end", asOfDate)
  .maybeSingle()
```

**Impact if Auto Resolver Added:**
- ✅ **SHOULD ADOPT** — Public route, can return empty when ledger has entries
- ⚠️ **Label Change:** Response includes `asOfDate` field (line 120). If resolver selects different period, `asOfDate` would reflect resolved period date, not current date.

**Empty Reports Currently Possible:** ✅ YES — If no journal entries in current month period

**Report Expects Current Calendar Period:** ✅ YES — Default behavior assumes current month

---

#### Balance Sheet (`app/api/reports/balance-sheet/route.ts`)

**Current Default Behavior:**
```typescript
const asOfDate = searchParams.get("as_of_date") || new Date().toISOString().split("T")[0]
// Lines 35-41: Resolves period containing asOfDate
let { data: period, error: periodError } = await supabase
  .from("accounting_periods")
  .select("id, period_start, period_end")
  .eq("business_id", business.id)
  .lte("period_start", asOfDate)
  .gte("period_end", asOfDate)
  .maybeSingle()
```

**Impact if Auto Resolver Added:**
- ✅ **SHOULD ADOPT** — Public route, can return empty when ledger has entries
- ⚠️ **Label Change:** Response includes `asOfDate` field (line 276). If resolver selects different period, `asOfDate` would reflect resolved period date.

**Empty Reports Currently Possible:** ✅ YES — If no journal entries in current month period

**Report Expects Current Calendar Period:** ✅ YES — Default behavior assumes current month

---

#### Profit & Loss (`app/api/reports/profit-loss/route.ts`)

**Current Default Behavior:**
```typescript
const startDate = searchParams.get("start_date")
const endDate = searchParams.get("end_date")
// Lines 34-38: Returns 400 if startDate/endDate missing
if (!startDate || !endDate) {
  return NextResponse.json(
    { error: "start_date and end_date are required." },
    { status: 400 }
  )
}
```

**Impact if Auto Resolver Added:**
- ⚠️ **CONDITIONAL ADOPT** — Currently requires explicit dates. Could add default resolver when params missing, but would be behavior change.

**Empty Reports Currently Possible:** ✅ YES — If no journal entries in requested period

**Report Expects Current Calendar Period:** ❌ NO — Requires explicit date range

---

### B.2 Accounting Workspace Routes

#### Trial Balance (`app/api/accounting/reports/trial-balance/route.ts`)

**Current Behavior:**
```typescript
const periodStart = searchParams.get("period_start")
// Lines 64-68: Returns 400 if periodStart missing
if (!periodStart) {
  return NextResponse.json(
    { error: "PHASE 10: period_start is required. Canonical Trial Balance requires an accounting period." },
    { status: 400 }
  )
}
```

**Impact if Auto Resolver Added:**
- ❌ **MUST REMAIN EXPLICIT** — Accounting workspace route, requires deterministic period selection
- ⚠️ **Could add optional default:** If `period_start` missing, use auto resolver. But this changes API contract.

**Recommendation:** **DO NOT CHANGE** — Keep explicit `period_start` requirement for accounting workspace routes

---

#### Balance Sheet (`app/api/accounting/reports/balance-sheet/route.ts`)

**Current Behavior:**
```typescript
const periodStart = searchParams.get("period_start")
// Lines 58-62: Returns 400 if periodStart missing
if (!periodStart) {
  return NextResponse.json(
    { error: "PHASE 10: period_start is required. Canonical Balance Sheet requires an accounting period." },
    { status: 400 }
  )
}
```

**Impact if Auto Resolver Added:**
- ❌ **MUST REMAIN EXPLICIT** — Accounting workspace route, requires deterministic period selection

**Recommendation:** **DO NOT CHANGE** — Keep explicit `period_start` requirement

---

#### Profit & Loss (`app/api/accounting/reports/profit-and-loss/route.ts`)

**Current Behavior:**
```typescript
const periodStart = searchParams.get("period_start")
// Lines 60-64: Returns 400 if periodStart missing
if (!periodStart) {
  return NextResponse.json(
    { error: "PHASE 10: period_start is required. Canonical P&L requires an accounting period." },
    { status: 400 }
  )
}
```

**Impact if Auto Resolver Added:**
- ❌ **MUST REMAIN EXPLICIT** — Accounting workspace route, requires deterministic period selection

**Recommendation:** **DO NOT CHANGE** — Keep explicit `period_start` requirement

---

### B.3 Dashboard Widgets

#### Collected This Month (`app/dashboard/page.tsx`)

**Current Behavior:**
```typescript
// Line 39: State variable
collectedThisMonth: 0

// Lines 472-474: Current month boundaries
const currentMonth = today.getMonth()
const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()

// Line 1109: UI label
<p className="text-xs font-normal text-gray-500 dark:text-gray-400 leading-relaxed">This month</p>

// Line 1168: Chart label
<h2 className="text-sm font-normal text-gray-500 dark:text-gray-400 mb-5 leading-normal">Cash collected · this month</h2>
```

**Impact if Auto Resolver Added:**
- ⚠️ **LABEL MISMATCH RISK** — Widget labeled "This month" would show latest period data instead
- ⚠️ **SEMANTIC DRIFT** — Variable name `collectedThisMonth` would become misleading

**Recommendation:** **ALIGN LABELS** — If adopting auto resolver, update labels to "Latest period" or make dynamic based on resolved period

---

### B.4 Export Endpoints

#### Trial Balance CSV Export (`app/api/accounting/reports/trial-balance/export/csv/route.ts`)

**Current Behavior:**
```typescript
const periodStart = searchParams.get("period_start")
// Lines 63-67: Returns 400 if periodStart missing
if (!periodStart) {
  return NextResponse.json(
    { error: "PHASE 10: period_start is required. Canonical Trial Balance requires an accounting period." },
    { status: 400 }
  )
}
```

**Impact if Auto Resolver Added:**
- ❌ **MUST REMAIN EXPLICIT** — Export endpoints should be deterministic

**Recommendation:** **DO NOT CHANGE** — Keep explicit `period_start` requirement

---

#### Balance Sheet PDF Export (`app/api/accounting/reports/balance-sheet/export/pdf/route.ts`)

**Current Behavior:**
```typescript
const asOfDate = searchParams.get("as_of_date") || new Date().toISOString().split("T")[0]
// Line 139: PDF header includes asOfDate
doc.fontSize(12).font("Helvetica").text(`${business?.name || "Business"} — As of ${asOfDate}`, { align: "center" })
```

**Impact if Auto Resolver Added:**
- ⚠️ **CONDITIONAL ADOPT** — Currently defaults to current date. Could adopt auto resolver when `as_of_date` missing, but PDF header would reflect resolved period date.

**Recommendation:** **CONDITIONAL** — Could adopt if `as_of_date` param missing, but must update PDF header to reflect resolved period

---

## SECTION C — Risks + Mitigations

### C.1 Locked Period by Default UX Risk

**Risk:** Resolver could select LOCKED period if it contains latest journal entry.

**Evidence:**
- `generate_trial_balance` does NOT check period status (migration 169, lines 76-83)
- Reports can read locked periods (read-only operation)
- Resolver hierarchy: OPEN → SOFT_CLOSED → LOCKED → current month

**Mitigation:**
- ✅ **Hierarchy prioritizes OPEN** — Resolver checks OPEN first, only falls back to LOCKED if no OPEN/SOFT_CLOSED periods have activity
- ⚠️ **UI Warning Recommended** — Display period status badge if resolved period is LOCKED/SOFT_CLOSED
- ✅ **Read-only Access** — Reading locked periods is acceptable (posting is blocked, not reading)

---

### C.2 No Activity Periods Risk

**Risk:** If no periods have journal activity, resolver falls back to current month (which may also be empty).

**Evidence:**
- Resolver hierarchy: latest OPEN with activity → latest SOFT_CLOSED with activity → latest LOCKED with activity → current month fallback
- Current month fallback uses `ensure_accounting_period` which creates period if missing

**Mitigation:**
- ✅ **Fallback Exists** — Current month fallback ensures period always exists
- ⚠️ **Empty Report Acceptable** — Empty reports are acceptable if no activity exists

---

### C.3 Performance Risk (MAX/EXISTS Patterns)

**Risk:** Resolver must query `journal_entries` to find periods with activity.

**Evidence:**
- Resolver needs to check `EXISTS (SELECT 1 FROM journal_entries WHERE business_id = ? AND date >= period_start AND date <= period_end)`
- Or use `MAX(journal_entries.date)` to find latest entry, then resolve period

**Mitigation:**
- ✅ **Index Required:** `idx_journal_entries_business_date_id` exists (migration 139, line 19)
- ⚠️ **Query Pattern:** Resolver should use `EXISTS` with period boundaries, not `MAX(date)` scan
- ✅ **Business ID Filter:** Must filter by `business_id` first to prevent cross-business leakage

**Required Index:**
- ✅ **EXISTS:** `idx_journal_entries_business_date_id` covers `(business_id, date, id)` — sufficient for `EXISTS` check
- ⚠️ **MAX Pattern:** If using `MAX(date)`, need `(business_id, date)` index — already exists as `idx_journal_entries_business_date_id`

---

### C.4 Cross-Business Leakage Risk

**Risk:** Resolver must filter by `business_id` before checking journal activity.

**Evidence:**
- All period resolution queries filter by `business_id` (e.g., line 37: `.eq("business_id", business.id)`)
- Resolver must ensure `business_id` filter in journal entry queries

**Mitigation:**
- ✅ **CRITICAL:** Resolver MUST filter by `business_id` in all journal entry queries
- ✅ **RLS Protection:** RLS policies on `journal_entries` should prevent cross-business access, but resolver should still filter explicitly

---

### C.5 Snapshot Cache Assumptions

**Risk:** If resolver frequently selects different periods, snapshots may not be reused.

**Evidence:**
- `get_trial_balance_from_snapshot` checks for snapshot by `period_id` (migration 169, line 235)
- If resolver selects different period, existing snapshot is ignored, new snapshot generated

**Mitigation:**
- ✅ **Snapshot Per Period** — Snapshots are stored per `period_id`, so resolver selecting different period triggers new snapshot (expected behavior)
- ⚠️ **Cache Efficiency:** If resolver selects same period repeatedly, snapshot is reused (good)
- ⚠️ **Thrashing Risk:** If resolver frequently changes periods, snapshots won't be reused (acceptable trade-off for correct data)

---

### C.6 User-Visible Label Changes

**Risk:** UI labels assume "current month" but resolver may select historical period.

**Evidence:**
- Dashboard: "This month" label (line 1109), "Cash collected · this month" (line 1168)
- Reports: "as of {asOfDate}" labels in UI pages
- PDF exports: "As of {asOfDate}" in headers

**Mitigation:**
- ⚠️ **Update Labels:** Change "This month" to "Latest period" or make dynamic
- ⚠️ **Update Variable Names:** `collectedThisMonth` → `collectedLatestPeriod` or make dynamic
- ✅ **Report Labels:** "as of {date}" labels are already dynamic, just need to reflect resolved period date

---

## SECTION D — Final Recommended Resolver Spec

### D.1 Resolver Hierarchy

**Priority Order:**
1. **Latest OPEN period with journal activity**
2. **Latest SOFT_CLOSED period with journal activity**
3. **Latest LOCKED period with journal activity**
4. **Current month period** (via `ensure_accounting_period` fallback)

**Activity Definition:**
- Period has activity if `EXISTS (SELECT 1 FROM journal_entries WHERE business_id = ? AND date >= period_start AND date <= period_end)`

---

### D.2 Resolver Function Signature

**Option A: Supabase RPC (Recommended)**

```sql
CREATE OR REPLACE FUNCTION resolve_default_accounting_period(
  p_business_id UUID
)
RETURNS TABLE (
  period_id UUID,
  period_start DATE,
  period_end DATE,
  status TEXT,
  resolution_reason TEXT
) AS $$
```

**Returns:**
- `period_id`: UUID of resolved period
- `period_start`: Period start date
- `period_end`: Period end date
- `status`: Period status ('open', 'soft_closed', 'locked')
- `resolution_reason`: Human-readable reason ('latest_open_with_activity', 'latest_soft_closed_with_activity', 'latest_locked_with_activity', 'current_month_fallback')

**Option B: API Helper Function**

```typescript
async function resolveDefaultPeriod(
  supabase: SupabaseClient,
  businessId: string
): Promise<{
  period_id: string
  period_start: string
  period_end: string
  status: string
  resolution_reason: string
} | null>
```

---

### D.3 Resolver Implementation Logic (Pseudocode)

```
1. Find latest OPEN period with activity:
   SELECT p.* FROM accounting_periods p
   WHERE p.business_id = p_business_id
     AND p.status = 'open'
     AND EXISTS (
       SELECT 1 FROM journal_entries je
       WHERE je.business_id = p_business_id
         AND je.date >= p.period_start
         AND je.date <= p.period_end
     )
   ORDER BY p.period_start DESC
   LIMIT 1
   
   IF FOUND: RETURN period with reason 'latest_open_with_activity'

2. Find latest SOFT_CLOSED period with activity:
   SELECT p.* FROM accounting_periods p
   WHERE p.business_id = p_business_id
     AND p.status = 'soft_closed'
     AND EXISTS (
       SELECT 1 FROM journal_entries je
       WHERE je.business_id = p_business_id
         AND je.date >= p.period_start
         AND je.date <= p.period_end
     )
   ORDER BY p.period_start DESC
   LIMIT 1
   
   IF FOUND: RETURN period with reason 'latest_soft_closed_with_activity'

3. Find latest LOCKED period with activity:
   SELECT p.* FROM accounting_periods p
   WHERE p.business_id = p_business_id
     AND p.status = 'locked'
     AND EXISTS (
       SELECT 1 FROM journal_entries je
       WHERE je.business_id = p_business_id
         AND je.date >= p.period_start
         AND je.date <= p.period_end
     )
   ORDER BY p.period_start DESC
   LIMIT 1
   
   IF FOUND: RETURN period with reason 'latest_locked_with_activity'

4. Fallback to current month:
   SELECT * FROM ensure_accounting_period(p_business_id, CURRENT_DATE)
   RETURN period with reason 'current_month_fallback'
```

---

### D.4 Integration Points

**Routes That Should Call Resolver:**

| Route | When to Call | Current Behavior |
|-------|--------------|------------------|
| `app/api/reports/trial-balance/route.ts` | When `as_of_date` param missing | Defaults to current date (line 28) |
| `app/api/reports/balance-sheet/route.ts` | When `as_of_date` param missing | Defaults to current date (line 28) |
| `app/api/reports/profit-loss/route.ts` | When `start_date`/`end_date` params missing | Returns 400 error (lines 34-38) — **OPTIONAL** adoption |

**Routes That Should NOT Call Resolver:**

| Route | Reason |
|-------|--------|
| `app/api/accounting/reports/trial-balance/route.ts` | Accounting workspace route, requires explicit `period_start` |
| `app/api/accounting/reports/balance-sheet/route.ts` | Accounting workspace route, requires explicit `period_start` |
| `app/api/accounting/reports/profit-and-loss/route.ts` | Accounting workspace route, requires explicit `period_start` |
| All export endpoints | Exports should be deterministic, require explicit params |
| `app/api/reports/vat-control/route.ts` | Bypasses period system, uses explicit date range |
| `app/api/reports/registers/route.ts` | Bypasses period system, uses explicit date range |

---

### D.5 Required Indexes

**Existing Indexes:**
- ✅ `idx_journal_entries_business_date_id` (migration 139, line 19): `(business_id, date, id)`
- ✅ `idx_journal_entries_business_id` (migration 043, line 42): `(business_id)`
- ✅ `idx_journal_entries_date` (migration 043, line 43): `(date)`

**Index Coverage Analysis:**
- ✅ **EXISTS Query:** `EXISTS (SELECT 1 FROM journal_entries WHERE business_id = ? AND date >= period_start AND date <= period_end)`
  - Uses `idx_journal_entries_business_date_id` for `business_id` + `date` range filter
  - **SUFFICIENT** — Index covers query pattern

**No Additional Indexes Required** — Existing indexes are sufficient for resolver queries.

---

### D.6 Resolver Return Value Usage

**API Route Integration:**
```typescript
// When as_of_date param missing:
const resolved = await supabase.rpc("resolve_default_accounting_period", {
  p_business_id: businessId
})

if (resolved.error || !resolved.data) {
  return NextResponse.json({ error: "Could not resolve default period" }, { status: 500 })
}

const period = resolved.data[0]
// Use period.period_id, period.period_start, period.period_end
// Optionally display period.status and period.resolution_reason in UI
```

**Response Enhancement:**
- Include `resolution_reason` in API response for debugging/UI display
- Include `period.status` in response to show if period is locked/soft_closed

---

## SECTION E — Integration Plan Summary

### E.1 Smallest-Possible Integration

**Step 1: Create Supabase RPC**
- Create `resolve_default_accounting_period(p_business_id UUID)` RPC
- Returns period_id, period_start, period_end, status, resolution_reason
- Uses EXISTS pattern with business_id filter

**Step 2: Update Public Report Routes**
- `app/api/reports/trial-balance/route.ts`: Call resolver when `as_of_date` missing
- `app/api/reports/balance-sheet/route.ts`: Call resolver when `as_of_date` missing
- Optional: `app/api/reports/profit-loss/route.ts`: Call resolver when `start_date`/`end_date` missing

**Step 3: Update UI Labels (If Needed)**
- Dashboard: Update "This month" labels if showing latest period
- Reports: Ensure "as of {date}" labels reflect resolved period date

**Step 4: Add Period Status Badge (Optional)**
- Display period status (OPEN/SOFT_CLOSED/LOCKED) in UI if resolved period is not OPEN

---

### E.2 Routes That Call Resolver

**Primary Integration Points:**
1. `app/api/reports/trial-balance/route.ts` — Replace current date default (line 28)
2. `app/api/reports/balance-sheet/route.ts` — Replace current date default (line 28)

**Optional Integration Points:**
3. `app/api/reports/profit-loss/route.ts` — Add default when params missing (currently returns 400)

**Routes That Do NOT Call Resolver:**
- All `app/api/accounting/reports/*` routes (require explicit `period_start`)
- All export endpoints (require explicit params)
- Routes that bypass period system (VAT, registers, ledger list)

---

### E.3 Resolver Return Value

**Structure:**
```typescript
{
  period_id: string        // UUID of resolved period
  period_start: string     // YYYY-MM-DD format
  period_end: string       // YYYY-MM-DD format
  status: string           // 'open' | 'soft_closed' | 'locked'
  resolution_reason: string // 'latest_open_with_activity' | 'latest_soft_closed_with_activity' | 'latest_locked_with_activity' | 'current_month_fallback'
}
```

**Usage in Routes:**
- Use `period_id` for RPC calls (`get_trial_balance_from_snapshot`, etc.)
- Use `period_start`/`period_end` for response metadata
- Use `status` for UI badges/warnings
- Use `resolution_reason` for debugging/logging

---

## SECTION F — Required Indexes

**Existing Indexes (Sufficient):**
- ✅ `idx_journal_entries_business_date_id` (migration 139): `(business_id, date, id)`
  - **Covers:** `WHERE business_id = ? AND date >= ? AND date <= ?`
  - **Used by:** EXISTS queries in resolver

**No Additional Indexes Required** — Existing index coverage is sufficient for resolver queries.

**Index Usage Pattern:**
```sql
-- Resolver EXISTS query uses existing index:
EXISTS (
  SELECT 1 FROM journal_entries je
  WHERE je.business_id = p_business_id        -- Index: business_id
    AND je.date >= p.period_start             -- Index: date range
    AND je.date <= p.period_end               -- Index: date range
)
-- Uses: idx_journal_entries_business_date_id
```

---

## FINAL RECOMMENDATIONS

### Resolver Implementation

**Recommended Approach:** **Supabase RPC Function**

**Rationale:**
- ✅ Centralized logic (single source of truth)
- ✅ Reusable across routes
- ✅ Database-level optimization (index usage)
- ✅ Can be called from API routes or other RPCs

**Function Name:** `resolve_default_accounting_period(p_business_id UUID)`

**Return Type:** `TABLE (period_id UUID, period_start DATE, period_end DATE, status TEXT, resolution_reason TEXT)`

---

### Integration Scope

**Must Adopt:**
- ✅ `app/api/reports/trial-balance/route.ts` — Replace current date default
- ✅ `app/api/reports/balance-sheet/route.ts` — Replace current date default

**Optional Adopt:**
- ⚠️ `app/api/reports/profit-loss/route.ts` — Currently requires explicit dates, could add default

**Do NOT Adopt:**
- ❌ All `app/api/accounting/reports/*` routes — Must remain explicit
- ❌ All export endpoints — Must remain explicit
- ❌ Routes bypassing period system — No period resolution needed

---

### UI Updates Required

**Dashboard Widgets:**
- ⚠️ Update "This month" labels if showing latest period
- ⚠️ Update variable names (`collectedThisMonth` → dynamic)

**Report Pages:**
- ✅ "as of {date}" labels already dynamic, just need to reflect resolved period date
- ⚠️ Add period status badge if resolved period is not OPEN

---

### Security Considerations

**Critical:**
- ✅ **MUST filter by `business_id`** in all journal entry queries
- ✅ RLS policies provide defense-in-depth, but resolver should filter explicitly

**Verified:**
- ✅ Existing queries filter by `business_id` (evidence: all routes use `.eq("business_id", business.id)`)
- ✅ Resolver must maintain this pattern

---

**AUDIT + DESIGN COMPLETE**
