# Audit Report: Reconciliation Zero-Delta Bug (READ-ONLY)

**Date:** 2025-01-29  
**Scope:** Prove whether the reconciliation engine can produce `FAIL`/`WARN` when `delta = 0`, violating stated invariants.  
**Constraint:** No code changes; logic and invariant verification only.

---

## Canonical Invariants (Reference)

1. **Delta definition:** `delta = ledgerBalance - expectedBalance`
2. **Tolerance rules:** DISPLAY → 0.01; VALIDATE / PERIOD_CLOSE → 0
3. **Status dominance:** If `|delta| ≤ tolerance` → **status MUST be OK**
4. **Zero-delta invariant:** If `delta === 0` → status = OK, no diagnosis/fix/workflow/banner/period-close impact

---

## A. Engine-Level Audit

### Where delta, tolerance, and status are set

| Responsibility | File | Function / Location |
|----------------|------|---------------------|
| Tolerance | `lib/accounting/reconciliation/engine-impl.ts` | `getTolerance(context)` (lines 22–32): DISPLAY → 0.01, VALIDATE/PERIOD_CLOSE → 0 |
| Delta | `lib/accounting/reconciliation/engine-impl.ts` | `reconcileInvoice`: `const delta = ledgerBalance - expectedBalance` (line 221) |
| Status (normal path) | `lib/accounting/reconciliation/engine-impl.ts` | `statusFromDelta(delta, tolerance, context)` (line 224) |
| Status (error path) | `lib/accounting/reconciliation/engine-impl.ts` | `buildFailResult(scope, context, notes)` (lines 86–103) |

### Status derivation (normal path)

**File:** `lib/accounting/reconciliation/engine-impl.ts`

```ts
function statusFromDelta(delta, tolerance, context): ReconciliationStatus {
  const absDelta = Math.abs(delta)
  if (withinTolerance(delta, tolerance)) return ReconciliationStatus.OK   // line 41
  if (tolerance === 0.01 && absDelta > 0.01) return ReconciliationStatus.WARN
  if (tolerance === 0 && absDelta > 0) return ReconciliationStatus.FAIL
  return ReconciliationStatus.OK
}
```

**File:** `lib/accounting/reconciliation/money.ts`

```ts
export function withinTolerance(delta: number, tolerance: number): boolean {
  return Math.abs(delta) <= tolerance
}
```

When `delta === 0`:

- `withinTolerance(0, tolerance)` is **true** for any tolerance (0 or 0.01).
- So `statusFromDelta(0, ...)` always returns **OK** at line 41.

**Conclusion (normal path):** In the path where `delta` is computed from `ledgerBalance` and `expectedBalance`, **classification logic cannot override**: status is derived only from `statusFromDelta`; when `delta === 0`, status is always OK. There is no other assignment to `status` in that path.

### Status derivation (error path) — source of violation

**File:** `lib/accounting/reconciliation/engine-impl.ts`

`buildFailResult` (lines 86–103) returns:

```ts
return {
  scope, context,
  expectedBalance: 0,
  ledgerBalance: 0,
  delta: 0,
  tolerance,
  status: ReconciliationStatus.FAIL,  // ← FAIL with delta = 0
  notes,
}
```

This is used on every **early exit** (reconciliation not run or failed):

| Line(s) | Condition |
|--------|-----------|
| 113–114 | Missing `businessId` or `invoiceId` |
| 126–128 | Invoice fetch error or invoice not found |
| 166–169 | `get_ar_balances_by_invoice` throws (e.g. RPC/period error) |
| 176–178 | AR account not found (fallback path) |
| 185–189 | `get_general_ledger` error (fallback when no `periodId`) |

So **any** of these conditions produces a result with:

- `delta = 0`
- `expectedBalance = 0`
- `ledgerBalance = 0`
- **`status = FAIL`**

**Conclusion (engine):** The engine **can** return `FAIL` with `delta = 0`. It does so only via `buildFailResult`, i.e. when reconciliation does not run to a numeric comparison (validation/error path). The invariant **“If delta === 0, then status = OK”** is **violated** by these early-exit paths.

---

## B. Proposal Generation Audit

**File:** `lib/accounting/reconciliation/resolution.ts`

- **`classifyDelta(result)`** (lines 408–413): Uses `result.delta` only. When `delta === 0`, `absDelta <= ROUNDING_THRESHOLD` (0.01), so classification is **`"rounding_drift"`**. Classification does **not** set or override `result.status`; it is computed from the same `result` that already has `status === FAIL` when coming from `buildFailResult`.
- **`produceLedgerCorrectionProposal(result)`** (lines 420–513):
  - Always builds a **diagnosis** (including `classification`), so a result with `delta = 0`, `status = FAIL` still gets `classification = "rounding_drift"`.
  - **`proposed_fix`** is set only when (lines 476–481):
    - `result.status !== OK`, and
    - `result.scope.businessId`, and
    - **`Math.abs(result.delta) > ROUNDING_THRESHOLD`** (i.e. `> 0.01`), and
    - scope has invoice/customer/period.
  - For `delta === 0`, `Math.abs(0) > 0.01` is **false**, so **`proposed_fix` remains `null`**.

**Conclusion (proposal):** The proposal generator does **not** generate a non-null `proposed_fix` when `delta === 0`. It does still produce a full proposal object (diagnosis, audit_metadata, verification_plan) with `classification = "rounding_drift"` when given a result with `delta = 0` and `status = FAIL`. So the UI can show “classification: rounding_drift” and diagnosis/summary even though no fix is proposed.

---

## C. Mismatch Aggregation Audit

**File:** `app/api/accounting/reconciliation/mismatches/route.ts`

- Invoices: `from("invoices").select("id").eq("business_id", ...).neq("status", "draft")...` (lines 62–69).
- For each invoice, `engine.reconcileInvoice(..., ReconciliationContext.DISPLAY)` is called (lines 80–85).
- Results are kept only when (lines 89–93):
  - `result.status === ReconciliationStatus.WARN || result.status === ReconciliationStatus.FAIL`
- There is **no** filter on `delta` or classification. So any result with `status === FAIL` (including from `buildFailResult` with `delta = 0`) is pushed into `results` and gets a proposal via `produceLedgerCorrectionProposal(result)`.

**Conclusion (mismatches API):** Filtering is strictly by **status !== OK** (WARN or FAIL). There is no guard that excludes zero-delta results. So **FAIL with delta = 0** (from `buildFailResult`) **will** appear in `results` and in `mismatches`, and will trigger the dashboard banner.

---

## D. Dashboard Indicator Audit

**File:** `app/dashboard/page.tsx` (lines 543–553)

- Fetches: `GET /api/accounting/reconciliation/mismatches?businessId=...&limit=1`.
- Banner condition: `setHasReconciliationDiscrepancy(Array.isArray(json.results) ? json.results.length > 0 : false)`.
- So the banner **“Accounting discrepancies detected”** is shown whenever **`results.length > 0`**, i.e. whenever the API returns at least one WARN or FAIL result.

Any single `buildFailResult` (e.g. one invoice not found, or one RPC error) yields one FAIL result with `delta = 0`. That result is included in `results`, so `results.length > 0` and the banner appears.

**Conclusion (dashboard):** Zero-delta FAIL results **do** cause a “false positive” discrepancy banner: the banner is driven only by “any WARN/FAIL result”, not by “nonzero delta” or “proposed_fix non-null”.

---

## Evidence Summary

| Question | Answer |
|----------|--------|
| Can `delta = 0` produce a FAIL reconciliation result under the current code? | **Yes.** |
| Where exactly? | **`lib/accounting/reconciliation/engine-impl.ts`**, function **`buildFailResult`** (lines 86–103), used at early-exit sites (lines 113–114, 126–128, 166–169, 176–178, 185–189). |
| Which invariant is violated? | **Zero-delta invariant:** “If delta === 0, then status = OK”. The code uses `status = FAIL` with `delta = 0` to mean “reconciliation could not be run” (validation/error), which is distinct from “reconciliation ran and |delta| > tolerance”. |
| Does classification override status? | **No.** Status is never set from classification. Classification is derived from `delta` after the fact; when the engine returns `buildFailResult`, it has already set `status = FAIL` and `delta = 0`. |
| Does the proposal generator create a fix when delta = 0? | **No.** `proposed_fix` is only set when `Math.abs(result.delta) > ROUNDING_THRESHOLD` (0.01), so it stays `null` when `delta === 0`. |
| Can zero-delta FAIL rows appear in mismatches? | **Yes.** Mismatches API keeps all WARN/FAIL results; no filter on delta. |
| Can zero-delta FAIL cause the dashboard banner? | **Yes.** Banner is shown when `results.length > 0`. |

---

## Minimal Correctness Statement (No Fixes Yet)

For the stated invariants to hold under the current design:

1. **Status dominance:** For any result that has a **numerically computed** `delta` (from `ledgerBalance` and `expectedBalance`), status **must** be derived only from `|delta|` and `tolerance` (as in `statusFromDelta`). **Current code satisfies this** on the normal path.
2. **Zero-delta invariant:** No result with `delta === 0` should ever have `status !== OK`. So either:
   - Results that represent “reconciliation could not be run” (e.g. missing scope, invoice not found, RPC error) must **not** use `delta = 0` and `status = FAIL` in the same object, or
   - The mismatches API / dashboard must **not** treat such results as “discrepancies” (e.g. by excluding them from the WARN/FAIL list or by a separate “error” vs “mismatch” concept).

**Current violation:** `buildFailResult` returns `delta = 0` and `status = FAIL`. Those results are included in mismatches and drive the banner, so the zero-delta invariant is violated in production behavior.

---

## Exact Condition That Allows FAIL with delta = 0

**Condition:** `reconcileInvoice` exits early via `return buildFailResult(scope, context, notes)`.

**Triggering cases:**

1. `!scope.businessId || !scope.invoiceId`
2. Invoice fetch error or no invoice row
3. `get_ar_balances_by_invoice` throws (when `scope.periodId` is set)
4. AR account not found (fallback path when `scope.periodId` is missing)
5. `get_general_ledger` returns an error (fallback path)

Under any of these, the API still receives an invoice id (from the list of non-draft invoices), so the most plausible real-world case is (3) or (4) or (5) for some invoice (e.g. period or RPC issue, or missing AR account in fallback), producing a FAIL with `ledgerBalance = 0`, `expectedBalance = 0`, `delta = 0`, and `classification = "rounding_drift"` in the proposal.

---

*End of audit. No fixes proposed.*
