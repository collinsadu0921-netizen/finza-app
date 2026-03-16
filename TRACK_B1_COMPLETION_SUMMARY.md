# Track B1 — Report Bypass Containment: Completion Summary

**Date:** 2025-01-17  
**Status:** ✅ COMPLETE

---

## TASK B1.1 — Report Route Enumeration

**Deliverable:** `REPORT_ROUTE_CLASSIFICATION.md`

**Classification Results:**

### CANONICAL Routes (7 total)
- `/api/accounting/reports/trial-balance` - Uses `get_trial_balance_from_snapshot`
- `/api/accounting/reports/profit-and-loss` - Uses `get_profit_and_loss_from_trial_balance`
- `/api/accounting/reports/balance-sheet` - Uses `get_balance_sheet_from_trial_balance`
- `/api/accounting/reports/general-ledger` - Direct ledger queries
- `/api/reports/trial-balance` - Uses `get_trial_balance_from_snapshot` (legacy wrapper)
- `/api/reports/profit-loss` - Uses `get_profit_and_loss_from_trial_balance` (legacy wrapper)
- `/api/reports/balance-sheet` - Uses `get_balance_sheet_from_trial_balance` (legacy wrapper)

### LEGACY Routes (4 total)
- `/api/reports/aging` - Reads `invoices`, `payments`
- `/api/reports/tax-summary` - Reads `invoices`, `expenses`, `bills`, `sales`, `credit_notes`
- `/api/reports/cash-office` - Reads `sales`, `registers`, `cashier_sessions`
- `/api/reports/sales-summary` - Reads `invoices`, `credit_notes`

---

## TASK B1.2 — Gate LEGACY Reports

**All 4 LEGACY routes have been gated:**

### Route: `/api/reports/aging`
- **File:** `app/api/reports/aging/route.ts`
- **Guard Added:** ✅ Lines 8-18
- **Guard Logic:** Checks for `?legacy_ok=1`, returns HTTP 410 if missing
- **Proof:** See file, guard is first check before any queries

### Route: `/api/reports/tax-summary`
- **File:** `app/api/reports/tax-summary/route.ts`
- **Guard Added:** ✅ Lines 44-54
- **Guard Logic:** Checks for `?legacy_ok=1`, returns HTTP 410 if missing
- **Proof:** See file, guard is after auth check, before operational queries

### Route: `/api/reports/cash-office`
- **File:** `app/api/reports/cash-office/route.ts`
- **Guard Added:** ✅ Lines 87-99
- **Guard Logic:** Checks for `?legacy_ok=1`, returns HTTP 410 if missing
- **Proof:** See file, guard is after auth/access checks, before operational queries

### Route: `/api/reports/sales-summary`
- **File:** `app/api/reports/sales-summary/route.ts`
- **Guard Added:** ✅ Lines 22-34
- **Guard Logic:** Checks for `?legacy_ok=1`, returns HTTP 410 if missing
- **Proof:** See file, guard is after auth check, before operational queries

**Guard Pattern (All Routes):**
```typescript
const legacyOk = searchParams.get("legacy_ok")
if (legacyOk !== "1") {
  return NextResponse.json(
    {
      error: "This report is deprecated. Use accounting reports.",
      deprecated: true,
      canonical_alternative: "...",
    },
    { status: 410 }
  )
}
```

**Behavior:**
- ✅ Returns HTTP 410 Gone if `legacy_ok=1` is missing
- ✅ Allows explicit bypass when `?legacy_ok=1` is provided
- ✅ Does NOT change existing query logic
- ✅ Does NOT add feature flags or environment checks

---

## TASK B1.3 — Detection Script

**Deliverable:** `scripts/detect-report-bypass.ts`

**Script Capabilities:**
- ✅ Scans all report routes in `app/api/reports/*` and `app/api/accounting/reports/*`
- ✅ Detects routes reading from operational tables
- ✅ Detects routes missing LEGACY guard
- ✅ Flags routes that read operational tables but don't use canonical functions AND aren't marked LEGACY
- ✅ Exit code 0 if compliant, 1 if violations found

**Usage:**
```bash
ts-node scripts/detect-report-bypass.ts
```

**Output:**
- Lists any routes that read operational tables without LEGACY guard
- Provides guidance on marking routes as LEGACY
- References `REPORT_ROUTE_CLASSIFICATION.md` for LEGACY route examples

---

## Verification

### All LEGACY Routes Gated

| Route | Guard Status | HTTP Code | Opt-in Required |
|-------|--------------|-----------|-----------------|
| `/api/reports/aging` | ✅ GUARDED | 410 Gone | `?legacy_ok=1` |
| `/api/reports/tax-summary` | ✅ GUARDED | 410 Gone | `?legacy_ok=1` |
| `/api/reports/cash-office` | ✅ GUARDED | 410 Gone | `?legacy_ok=1` |
| `/api/reports/sales-summary` | ✅ GUARDED | 410 Gone | `?legacy_ok=1` |

### Detection Script

| Script | Location | Purpose |
|--------|----------|---------|
| `detect-report-bypass.ts` | `scripts/detect-report-bypass.ts` | Scans routes, flags operational table reads without LEGACY guard |

---

## Restrictions Followed

✅ **No modifications to:**
- Ledger schema
- Canonical accounting report routes
- Report query logic
- Retail/Service UI
- Tax calculation logic

✅ **Only added:**
- Guards requiring `?legacy_ok=1` parameter
- HTTP 410 Gone responses for unguarded legacy routes
- Detection script for CI checks
- Documentation (`REPORT_ROUTE_CLASSIFICATION.md`)

---

## Next Steps

**Track B1 is COMPLETE.** All deliverables met:

1. ✅ Report route classification document
2. ✅ All LEGACY routes gated with `?legacy_ok=1` requirement
3. ✅ Detection script for CI/audit purposes

**Ready for Track B2 approval.**

---

**END OF TRACK B1 SUMMARY**
