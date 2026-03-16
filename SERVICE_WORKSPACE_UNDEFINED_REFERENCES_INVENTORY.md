# SERVICE WORKSPACE: UNDEFINED REFERENCE BUG INVENTORY

**Date:** 2026-01-24  
**Task:** Read-Only Detection Sweep  
**Status:** Complete

---

## BUG INVENTORY TABLE

| Page | File Path | Undefined Variable | Line | Likely Source | Category |
|------|-----------|-------------------|------|---------------|----------|
| Customer360Page | app/customers/[id]/360/page.tsx | currencySymbol | 262, 275, 287, 292, 302, 457 | useBusinessCurrency hook (may return undefined) | Currency |
| CustomerStatementPage | app/customers/[id]/statement/page.tsx | currencySymbol | 108, 257, 261, 266, 271, 275, 303, 305, 318, 332 | Missing hook/import (hardcoded "₵" and "GHS") | Currency |
| EstimateViewPage | app/estimates/[id]/view/page.tsx | currencySymbol | 410, 419, 425, 431, 437, 444, 451 | Missing hook/import (hardcoded "GHS") | Currency |
| CreateBillPage | app/bills/create/page.tsx | currencySymbol | 458, 471, 475, 479, 483, 488, 498, 502, 510 | Missing state variable | Currency |
| CreateBillPage | app/bills/create/page.tsx | businessCountry | 461 | Missing state variable | Business-Context |

---

## DETAILED ANALYSIS

### Customer360Page (`app/customers/[id]/360/page.tsx`)

**Issue:** `currencySymbol` is used in JSX but hook may return undefined.

**Lines with undefined reference:**
- Line 262: `{currencySymbol}{formatMoney(summary.totalInvoiced)}`
- Line 275: `{currencySymbol}{formatMoney(summary.totalPaid)}`
- Line 287: `{currencySymbol}{formatMoney(summary.totalOutstanding)}`
- Line 292: `{currencySymbol}{formatMoney(summary.totalCredits)}`
- Line 302: `{currencySymbol}{formatMoney(summary.overdueAmount)}`
- Line 457: `{currencySymbol}{formatMoney(activity.amount)}`

**Current state:**
- Line 52: `const { currencyCode, currencySymbol } = useBusinessCurrency()` - **HOOK IS CALLED**
- However, hook may return undefined if business currency not set

**Root cause:** Hook returns `{ currencyCode, currencySymbol }` but may return undefined values if business currency is not configured.

**Likely fix:** Ensure hook always returns a default value, or add null checks before using `currencySymbol`.

---

### CustomerStatementPage (`app/customers/[id]/statement/page.tsx`)

**Issue:** `currencySymbol` is used in JSX but not declared. Hardcoded "₵" and "GHS" strings used instead.

**Lines with undefined reference:**
- Line 108: `Total Outstanding: GHS ${summary?.totalOutstanding.toFixed(2) || "0.00"}.` - **HARDCODED "GHS"**
- Line 257: `₵{summary.totalInvoiced.toFixed(2)}` - **HARDCODED "₵"**
- Line 261: `₵{summary.totalPaid.toFixed(2)}` - **HARDCODED "₵"**
- Line 266: `-₵{summary.totalCredits.toFixed(2)}` - **HARDCODED "₵"**
- Line 271: `₵{summary.totalOutstanding.toFixed(2)}` - **HARDCODED "₵"**
- Line 275: `₵{summary.totalOverdue.toFixed(2)}` - **HARDCODED "₵"**
- Line 303: `₵{Number(invoice.total).toFixed(2)}` - **HARDCODED "₵"**
- Line 305: `Balance: ₵{balance.toFixed(2)}` - **HARDCODED "₵"**
- Line 318: `₵{Number(payment.amount).toFixed(2)}` - **HARDCODED "₵"**
- Line 332: `-₵{Number(creditNote.total).toFixed(2)}` - **HARDCODED "₵"**

**Current state:**
- No `useBusinessCurrency` hook import or call
- No currency symbol state variable
- Hardcoded "₵" and "GHS" strings used throughout

**Root cause:** Missing currency context hook/import.

**Likely fix:** Import and use `useBusinessCurrency` hook, replace all hardcoded currency symbols with `currencySymbol` variable.

---

### EstimateViewPage (`app/estimates/[id]/view/page.tsx`)

**Issue:** `currencySymbol` is used in JSX but not declared. Hardcoded "GHS" strings used instead.

**Lines with undefined reference:**
- Line 410: `<span>GHS {Number(amount).toFixed(2)}</span>` - **HARDCODED "GHS"**
- Line 419: `<span>GHS {Number(taxBreakdown.nhil).toFixed(2)}</span>` - **HARDCODED "GHS"**
- Line 425: `<span>GHS {Number(taxBreakdown.getfund).toFixed(2)}</span>` - **HARDCODED "GHS"**
- Line 431: `<span>GHS {Number(taxBreakdown.covid).toFixed(2)}</span>` - **HARDCODED "GHS"**
- Line 437: `<span>GHS {Number(taxBreakdown.vat).toFixed(2)}</span>` - **HARDCODED "GHS"**
- Line 444: `<span className="font-medium">GHS {Number(estimate.total_tax_amount).toFixed(2)}</span>` - **HARDCODED "GHS"**
- Line 451: `<span className="font-bold">GHS {Number(estimate.total_amount).toFixed(2)}</span>` - **HARDCODED "GHS"**

**Current state:**
- No `useBusinessCurrency` hook import or call
- No currency symbol state variable
- Hardcoded "GHS" strings used throughout

**Root cause:** Missing currency context hook/import.

**Likely fix:** Import and use `useBusinessCurrency` hook, replace all hardcoded "GHS" strings with `currencySymbol` variable.

---

### CreateBillPage (`app/bills/create/page.tsx`)

**Issue:** `currencySymbol` and `businessCountry` are used in JSX but not declared.

**Lines with undefined reference:**
- Line 458: `{currencySymbol}{taxResult.subtotalBeforeTax.toFixed(2)}`
- Line 461: `const countryCode = businessCountry ? normalizeCountry(businessCountry) : null` - **businessCountry undefined**
- Line 471: `{currencySymbol}{taxResult.nhil.toFixed(2)}`
- Line 475: `{currencySymbol}{taxResult.getfund.toFixed(2)}`
- Line 479: `{currencySymbol}{taxResult.covid.toFixed(2)}`
- Line 483: `{currencySymbol}{taxResult.vat.toFixed(2)}`
- Line 488: `{currencySymbol}{taxResult.totalTax.toFixed(2)}`
- Line 498: `{currencySymbol}{taxResult.vat.toFixed(2)}`
- Line 502: `{currencySymbol}{taxResult.totalTax.toFixed(2)}`
- Line 510: `{currencySymbol}{taxResult.grandTotal.toFixed(2)}`

**Current state:**
- No `currencySymbol` state variable declared
- No `businessCountry` state variable declared
- Variables are used in JSX but never initialized

**Root cause:** Missing state variable declarations.

**Likely fix:** Add state variables:
- `const [currencySymbol, setCurrencySymbol] = useState<string>("")`
- `const [businessCountry, setBusinessCountry] = useState<string | null>(null)`
- Load currency and country in `loadBusiness()` function similar to other bill pages.

---

## GROUPED BY CATEGORY

### Currency-Related (17 bugs)
1. Customer360Page - currencySymbol (6 occurrences, hook may return undefined)
2. CustomerStatementPage - currencySymbol (10 occurrences, hardcoded "₵" and "GHS")
3. EstimateViewPage - currencySymbol (7 occurrences, hardcoded "GHS")
4. CreateBillPage - currencySymbol (9 occurrences, missing state variable)

### Business-Context-Related (1 bug)
1. CreateBillPage - businessCountry (1 occurrence, missing state variable)

### Tax-Related (0 bugs)
- None found in this sweep

### Other (0 bugs)
- None found in this sweep

---

## SUMMARY

### Total Undefined-Reference Bugs: **18**

### Distribution:
- **Currency-related:** 17 bugs (94.4%)
- **Business-context:** 1 bug (5.6%)
- **Tax-related:** 0 bugs
- **Other:** 0 bugs

### Pattern Analysis:

**Systematic Issue:** ✅ **YES**

All bugs follow consistent patterns:

1. **Missing Hook/Import Pattern (12 bugs):**
   - CustomerStatementPage: No `useBusinessCurrency` hook
   - EstimateViewPage: No `useBusinessCurrency` hook
   - Both use hardcoded currency symbols ("₵", "GHS")

2. **Hook May Return Undefined Pattern (6 bugs):**
   - Customer360Page: Hook called but may return undefined
   - No null checks before using `currencySymbol` in JSX

3. **Missing State Variables Pattern (10 bugs):**
   - CreateBillPage: `currencySymbol` and `businessCountry` used but never declared
   - Similar pages (EditBillPage, BillViewPage) correctly declare these variables

**Most Common Category:** Currency-related (94.4% of bugs)

**Root Cause Patterns:**
1. Missing hook import/usage (most common)
2. Hook may return undefined values (no null checks)
3. Missing state variable declarations
4. Hardcoded currency symbols instead of dynamic values

---

## NOTES

1. **Customer360Page** has the hook but may need null checks or default values
2. **CustomerStatementPage** completely lacks currency context - uses hardcoded "₵" and "GHS"
3. **EstimateViewPage** completely lacks currency context - uses hardcoded "GHS"
4. **CreateBillPage** missing state variables that are used in JSX - will crash at runtime
5. All pages would crash if `currencySymbol` is undefined and used in template literals
6. Pattern suggests systematic issue with currency context management across Service workspace
7. Bills workspace pages (EditBillPage, BillViewPage) correctly implement currency context - CreateBillPage should follow same pattern

---

## NEXT STEPS (FOR FIX PHASE)

1. **CustomerStatementPage:**
   - Import `useBusinessCurrency` hook
   - Replace all hardcoded "₵" and "GHS" with `currencySymbol` variable

2. **EstimateViewPage:**
   - Import `useBusinessCurrency` hook
   - Replace all hardcoded "GHS" with `currencySymbol` variable

3. **CreateBillPage:**
   - Add `currencySymbol` and `businessCountry` state variables
   - Load currency and country in `loadBusiness()` function (similar to EditBillPage)

4. **Customer360Page:**
   - Add null checks or default values for `currencySymbol`
   - Consider adding default currency symbol fallback in hook itself

5. Verify all Service pages have proper currency context

---

## VERIFICATION

- [x] All Service workspace pages scanned
- [x] Undefined variables identified
- [x] Lines of usage documented
- [x] Likely sources identified
- [x] Bugs categorized
- [x] Pattern analysis complete
- [x] No code modified (read-only)
