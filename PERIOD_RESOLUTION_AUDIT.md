# Period Resolution Audit (CRITICAL)

**Audit type:** Principal accounting systems architect — evidence only.  
**Scope:** How `accounting_period_id` (or equivalent period context) is resolved; where "Accounting period could not be resolved" is thrown; required inputs and Service workspace context.

---

## 1. How is `accounting_period_id` resolved?

Evidence from codebase:

### 1.1 Report APIs (P&L, Balance Sheet, Trial Balance, General Ledger)

- **Required in query params:** `period_start` (YYYY-MM-DD or YYYY-MM-01) is **required** for P&L, Balance Sheet, and Trial Balance report routes. General Ledger accepts either `period_start` or `start_date` + `end_date`.
- **Resolution flow:**
  1. API reads `business_id` and `period_start` from query.
  2. Lookup: `accounting_periods` where `business_id` + `period_start` (eq), `.single()`.
  3. If not found: normalize to date (e.g. `periodStart.length === 7 ? periodStart + '-01' : periodStart`), then call `ensure_accounting_period(p_business_id, p_date)` RPC.
  4. Refetch period by `business_id` + normalized `period_start`; if still missing or error → return **500** with body `{ error: "Accounting period could not be resolved" }`.
  5. Use `period.id` as `p_period_id` for RPCs (`get_profit_and_loss_from_trial_balance`, `get_balance_sheet_from_trial_balance`, `get_trial_balance_from_snapshot`).

**Evidence (file:line):**

- `app/api/accounting/reports/profit-and-loss/route.ts`: 66–70 require `period_start`; 73–78 lookup; 80–99 ensure + refetch, 89 and 98 return "Accounting period could not be resolved".
- `app/api/accounting/reports/balance-sheet/route.ts`: 64–69, 71–97, 87 and 96 same.
- `app/api/accounting/reports/trial-balance/route.ts`: 64–69, 72–98, 87 and 96 same.
- `app/api/accounting/reports/general-ledger/route.ts`: 103–131 — if `periodStart` provided, same pattern; 117–118 and 126–127 return "Accounting period could not be resolved". General Ledger can also use `start_date`/`end_date` without a period.

So: **period_id is derived from `period_start`** (and optional `ensure_accounting_period`); it is **not** required as a raw query param; **period_start** is the required input for canonical report APIs.

### 1.2 Resolve API (Option C for embedded reports)

- **Route:** `GET /api/accounting/periods/resolve`
- **Required query params:** `business_id`, `from_date` (YYYY-MM-DD). `to_date` optional (validation only).
- **Flow:**
  1. Find period where `period_start <= from_date <= period_end`, order by period_start desc, limit 1.
  2. If none: call `ensure_accounting_period(p_business_id, p_date: from_date)`.
  3. Refetch period containing `from_date`; if still none → **404** "No accounting period covers the selected dates." (no 500 "could not be resolved" here).
- **Returns:** `{ period_id, period_start, period_end }`.

**Evidence:** `app/api/accounting/periods/resolve/route.ts` (full file): required business_id + from_date; 71–80 find; 99–111 ensure; 114–128 refetch; 404 on failure.

So: **period_id is derived from date range** (from_date) via lookup or ensure; **not** defaulted implicitly in the sense of “current period” without input — caller must supply `from_date`.

### 1.3 Trial Balance API (alternate route)

- **Route:** `GET /api/accounting/trial-balance?business_id=&period=YYYY-MM`
- **Required:** `business_id`, `period` (YYYY-MM). Converted to `period_start` = first day of month.
- **Flow:** Lookup `accounting_periods` by business_id + period_start; **no** call to `ensure_accounting_period`. If not found → **404** "Accounting period not found for period: {periodParam}".

**Evidence:** `app/api/accounting/trial-balance/route.ts`: 49–53 require period; 56–66 parse to periodStart; 82–101 fetch period; 96–100 return 404 if no period. This route does **not** throw "Accounting period could not be resolved".

### 1.4 Period Readiness

- **Route:** `GET /api/accounting/periods/readiness?business_id=&period_start=`
- **Required:** `business_id`, `period_start` (YYYY-MM-01).
- **Flow:** Calls `check_period_close_readiness` RPC; response includes `period_id`. No "could not be resolved" message; 400 if params missing.

**Evidence:** `app/api/accounting/periods/readiness/route.ts`: 17–26 required params; 80–87 RPC; 96–114 periodId from readiness or direct select.

---

## 2. Is period_id required in query params? Derived? Defaulted?

| Context | Required in query | Derived from | Defaulted implicitly |
|---------|-------------------|--------------|------------------------|
| P&L / Balance Sheet / Trial Balance (reports) | `period_start` required (not period_id) | Lookup by business_id + period_start; optionally ensure_accounting_period then refetch | No |
| General Ledger | `period_start` **or** `start_date`+`end_date` | If period_start: same as above. If date range: used directly for RPC | No |
| Period resolve API | `from_date` (and business_id) | Period containing from_date; ensure then refetch | No |
| Trial balance (YYYY-MM) API | `period` (YYYY-MM) | Convert to period_start; lookup only (no ensure) | No |
| Readiness | `period_start` | From RPC + optional select | No |

**Conclusion:** `accounting_period_id` is **never** required as a query parameter by the API. It is **derived** from `period_start` or `from_date` (and business_id). There is **no** implicit default (e.g. “current period”) without the caller providing a date or period_start.

---

## 3. Which functions/APIs throw "Accounting period could not be resolved"

**Exact string:** `"Accounting period could not be resolved"`  
**HTTP status:** 500  
**When:** After calling `ensure_accounting_period` and either (a) RPC errors, or (b) refetch of period returns error or no row.

**Locations (evidence from grep):**

| File | Line(s) | Trigger |
|------|---------|--------|
| `app/api/accounting/reports/balance-sheet/route.ts` | 87, 96 | ensure_accounting_period failed or refetch failed |
| `app/api/accounting/reports/profit-and-loss/route.ts` | 89, 98 | same |
| `app/api/accounting/reports/trial-balance/route.ts` | 87, 96 | same |
| `app/api/accounting/reports/trial-balance/export/csv/route.ts` | 90, 99 | same |
| `app/api/accounting/reports/trial-balance/export/pdf/route.ts` | 100, 109 | same |
| `app/api/accounting/reports/general-ledger/route.ts` | 120, 129 | same (when period_start used) |
| `app/api/accounting/reports/general-ledger/export/csv/route.ts` | 116, 125 | same |
| `app/api/accounting/reports/general-ledger/export/pdf/route.ts` | 108, 117 | same |
| `app/api/accounting/reports/profit-and-loss/export/csv/route.ts` | 93, 102 | same |
| `app/api/accounting/reports/profit-and-loss/export/pdf/route.ts` | 78, 87 | same |

**Conclusion:** Only the **report** routes (and their export variants) that use **period_start** + **ensure_accounting_period** can return this message. The **resolve** API returns 404 with a different message; the **trial-balance** (YYYY-MM) route returns 404 without this string.

---

## 4. Trace: P&L, Balance Sheet, Trial Balance

### 4.1 Profit & Loss

- **Required inputs:** `business_id`, `period_start`.
- **Flow:** Validate business_id → require period_start (400 if missing) → lookup period → if missing, ensure_accounting_period + refetch → 500 "Accounting period could not be resolved" on failure → RPC `get_profit_and_loss_from_trial_balance(p_period_id: period.id)`.
- **Missing context when called from Service workspace:** Service must call `/api/accounting/periods/resolve?business_id=&from_date=` first and pass returned `period_start` to the report. If Service skips resolve or uses a date that has no period and ensure fails, report returns 500 with "Accounting period could not be resolved". Current Service flow (evidence: `app/reports/profit-loss/page.tsx`): resolve first, then report with `period_start` from resolve — so missing context is “resolve not called” or “resolve 404 not handled”; report then never called with invalid context if UX follows current code.

### 4.2 Balance Sheet

- **Required inputs:** `business_id`, `period_start`.
- **Flow:** Same pattern as P&L: period_start required → lookup → ensure + refetch on miss → 500 on failure → RPC `get_balance_sheet_from_trial_balance(p_period_id: period.id)`.
- **Missing context when called from Service:** Same as P&L. Evidence: `app/reports/balance-sheet/page.tsx` — resolve with from_date (first day of asOfDate month), then report with resolved period_start.

### 4.3 Trial Balance (report route)

- **Required inputs:** `business_id`, `period_start`.
- **Flow:** Same as P&L/Balance Sheet: period_start required → lookup → ensure + refetch → 500 on failure → RPC `get_trial_balance_from_snapshot(p_period_id: period.id)`.
- **Missing context when called from Service:** Service does not expose Trial Balance in the same embedded way as P&L/Balance Sheet in the scanned report pages; Accounting workspace Trial Balance pages use period list and pass period_start from selected period.

---

## 5. Required inputs summary

| Report | Required query/context | Optional |
|--------|------------------------|----------|
| P&L | business_id, period_start | context=embedded (no behavior change in API) |
| Balance Sheet | business_id, period_start | as_of_date (UI), context=embedded |
| Trial Balance (reports) | business_id, period_start | — |
| Trial Balance (YYYY-MM route) | business_id, period (YYYY-MM) | — |
| General Ledger | business_id, account_id; and either period_start or start_date+end_date | limit, cursor_* |

---

*End of Period Resolution Audit. No code or behavior changes.*
