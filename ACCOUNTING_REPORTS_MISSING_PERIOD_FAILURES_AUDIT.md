# Accounting-First Report Routes — Missing Period Hard Failures Audit

**Scope:** `app/api/accounting/reports/**`, `app/api/accounting/exports/**`, and RPCs called by those routes.  
**Goal:** List every place where a **missing row in `accounting_periods`** causes a **hard failure** (404 or throw).  
**Read-only.** No fixes.

For each failure:
- **file:line** — location
- **Exact guard** — condition that triggers the failure
- **Bootstrap-safe?** — whether a missing period could be safely bootstrapped (e.g. via `initialize_business_accounting_period` or `ensure_accounting_period`) instead of failing.

Bootstrap context: `initialize_business_accounting_period(p_business_id, p_start_date)` (migration 177) ensures at least one period for a business; `ensure_accounting_period(p_business_id, p_date)` (migration 094) returns or creates the period containing that date. “Bootstrap-safe” means: at this call site, could the route call such a function when the row is missing, create the period, and then retry/proceed without violating accounting rules or duplicating periods.

---

## 1. Route-level 404s (missing `accounting_periods` row)

When the route queries `accounting_periods` by `business_id` + `period_start` and gets no row, it returns **404** with message `"Accounting period not found for period_start: " + periodStart` (or equivalent). Triggers only when the user has supplied `period_start` (or it is required).

| # | File | Line(s) | Exact guard | When it triggers | Bootstrap-safe? |
|---|-----|---------|--------------|-------------------|------------------|
| 1 | `app/api/accounting/reports/profit-and-loss/route.ts` | 81–85 | `if (periodError \|\| !period) { return NextResponse.json({ error: "Accounting period not found for period_start: " + periodStart }, { status: 404 }) }` | `period_start` is required (65–70); lookup by `business_id` + `period_start` returns no row. | **Yes.** Route has `businessId` and `periodStart`. Call `initialize_business_accounting_period(businessId, periodStart)` or equivalent “ensure period for this date” before lookup; then retry. Idempotent create for that month is safe. |
| 2 | `app/api/accounting/reports/balance-sheet/route.ts` | 79–84 | `if (periodError \|\| !period) { return NextResponse.json({ error: "Accounting period not found for period_start: " + periodStart }, { status: 404 }) }` | Same: `period_start` required (64–69), no row. | **Yes.** Same as P&L: bootstrap by `business_id` + `period_start` then retry. |
| 3 | `app/api/accounting/reports/trial-balance/route.ts` | 80–84 | `if (periodError \|\| !period) { return NextResponse.json({ error: "Accounting period not found for period_start: " + periodStart }, { status: 404 }) }` | Same: `period_start` required (65–70), no row. | **Yes.** Same as P&L/BS. |
| 4 | `app/api/accounting/reports/trial-balance/export/csv/route.ts` | 83–87 | `if (periodError \|\| !period) { return NextResponse.json({ error: "Accounting period not found for period_start: " + periodStart }, { status: 404 }) }` | `period_start` required (68–71), no row. | **Yes.** Same bootstrap pattern. |
| 5 | `app/api/accounting/reports/profit-and-loss/export/csv/route.ts` | 85–89 | `if (periodError \|\| !period) { return NextResponse.json(..., 404) }` | Only when **period_start** was provided; else uses start_date/end_date. | **Yes.** When `period_start` is used, bootstrap by `business_id` + `period_start` and retry. |
| 6 | `app/api/accounting/reports/profit-and-loss/export/pdf/route.ts` | 70–74 | `if (periodError \|\| !period) { return NextResponse.json(..., 404) }` | Only when **period_start** was provided (61–78); else uses start_date/end_date. | **Yes.** Same as P&L CSV. |
| 7 | `app/api/accounting/reports/general-ledger/route.ts` | 113–117 | `if (periodError \|\| !period) { return NextResponse.json({ error: "Accounting period not found for period_start: " + periodStart }, { status: 404 }) }` | Only when **period_start** was provided (103–119); else uses start_date/end_date. | **Yes.** When period_start is used, bootstrap by `business_id` + `period_start` and retry. |
| 8 | `app/api/accounting/reports/general-ledger/export/csv/route.ts` | 108–112 | `if (periodError \|\| !period) { return NextResponse.json(..., 404) }` | Only when **period_start** was provided (100–116). | **Yes.** Same as GL report. |
| 9 | `app/api/accounting/reports/general-ledger/export/pdf/route.ts` | 100–104 | `if (periodError \|\| !period) { return NextResponse.json(..., 404) }` | Only when **period_start** was provided (91–107). | **Yes.** Same as GL report. |
| 10 | `app/api/accounting/reports/trial-balance/export/pdf/route.ts` | 92–96 | `if (periodError \|\| !period) { return NextResponse.json(..., 404) }` | Only when **period_start** was provided (84–99); else uses start_date/end_date. | **Yes.** Same as TB CSV. |

**Routes that do NOT hard-fail on missing period:**

- **Balance-sheet export (CSV/PDF):** When `period_start` is provided, they query `accounting_periods` and use `if (!periodError && period)` / `if (period)` to compute current-period net income. Missing row → net income is skipped (0); export still returns 200. No 404.
- **VAT export** (`app/api/accounting/exports/vat/route.ts`): Fetches `accountingPeriod` (86–92) but does not use it to gate the request; uses param-derived dates and ledger only. No 404 from missing period.
- **Levies export** (`app/api/accounting/exports/levies/route.ts`): Fetches `accountingPeriod` (87–93) with `maybeSingle()` and never uses it to block; uses param-derived dates and ledger. No 404 from missing period.
- **Transactions export** (`app/api/accounting/exports/transactions/route.ts`): Does not query `accounting_periods`; uses `period` param (YYYY-MM) and ledger only. No 404 from missing period.

---

## 2. RPC-level throws (missing `accounting_periods` row)

These RPCs are invoked by the report routes above. A “missing period” failure occurs when the RPC is called with a `p_period_id` for which no row exists in `accounting_periods`.

| # | File | Line(s) | Exact guard | When it triggers | Bootstrap-safe? |
|---|-----|---------|--------------|-------------------|------------------|
| 11 | `supabase/migrations/169_trial_balance_canonicalization.sql` | 76–83 | `SELECT * INTO period_record FROM accounting_periods WHERE id = p_period_id;` then `IF NOT FOUND THEN RAISE EXCEPTION 'Accounting period not found: %', p_period_id; END IF;` | `generate_trial_balance(p_period_id, …)` is called with a UUID that has no row in `accounting_periods`. | **N/A at RPC.** The RPC receives only `p_period_id`; it has no `business_id` or `period_start` to create a period. Bootstrap must happen in the **caller**: ensure a period exists and pass its `id`. All report callers get `period.id` from a prior lookup; they 404 before calling the RPC if that lookup fails. So this RAISE is only hit if (a) a race deletes the row after the route’s lookup, or (b) another caller passes a bad `p_period_id`. |

**Call chain:** Report routes that use the canonical Trial Balance snapshot pass `period.id` from their own `.from("accounting_periods").eq(...).single()` result. So normally they never call the RPC when the period row is missing—they 404 first. The RPC throw is a defensive failure mode if the row disappears between route lookup and RPC execution, or if some other code path calls the RPC with a non-existent period id.

**Other RPCs:**  
`get_profit_and_loss_from_trial_balance`, `get_balance_sheet_from_trial_balance`, and `get_trial_balance_from_snapshot` all take `p_period_id`. They (or their callees like `get_trial_balance_from_snapshot` → `generate_trial_balance`) will raise if that period does not exist. The only place that constructs “period row missing” as an explicit check and raises is `generate_trial_balance` (169:81–82). The others depend on existing logic (e.g. snapshot lookup or downstream use of `period_record`); the single “missing period” RAISE in scope is the one above.

---

## 3. Summary

| Location type | Count | Bootstrap-safe at call site? |
|--------------|--------|------------------------------|
| **Report routes (reports/**)** | 10 route-level 404s | **Yes** for all: route has `business_id` and `period_start` when the guard runs; could call ensure/initialize for that date and retry. |
| **Exports (exports/**)** | 0 | VAT, levies, transactions do not hard-fail on missing period. |
| **RPC (generate_trial_balance)** | 1 RAISE | **N/A** in RPC; bootstrap only in caller. |

**Exact guard pattern (routes):**  
`const { data: period, error: periodError } = await supabase.from("accounting_periods").select(...).eq("business_id", businessId).eq("period_start", periodStart).single();`  
then  
`if (periodError || !period) { return NextResponse.json({ error: "Accounting period not found for period_start: " + periodStart }, { status: 404 }); }`

**Bootstrap-safe?** For every route 404 in this audit, the route has both `businessId` and `periodStart` when the guard runs. Calling something like `ensure_accounting_period(businessId, periodStart)` or `initialize_business_accounting_period(businessId, periodStart)` when the lookup fails, then re-querying for the period (or using the returned period), would allow the request to proceed without a 404. Whether to do that is a product/ops choice; technically it can be done safely (idempotent create for that month, no double-create if the bootstrap is written to match existing semantics).

---

**Document:** `ACCOUNTING_REPORTS_MISSING_PERIOD_FAILURES_AUDIT.md`  
**Scope:** Reports + exports under `app/api/accounting`, and RPCs they call. Evidence-based, read-only.
