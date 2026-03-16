# Commit B: Retail Tax Migration Plan - B0 Inventory

## B0 - Inventory of Retail Read Paths

### Files Reading Legacy Tax Columns for SALES

1. **Receipts (Web)**
   - `app/sales/[id]/receipt/page.tsx` (line 591)
     - Status: ✅ Uses `getGhanaLegacyView(sale.tax_lines)`
     - Issue: Has fallback to legacy columns on line 592
   - `app/sales-history/[id]/receipt/page.tsx` (line 282)
     - Status: ✅ Uses `getGhanaLegacyView(sale.tax_lines)`
     - Issue: Has fallback to legacy columns on line 283

2. **Receipts (ESC/POS)**
   - `lib/escpos.ts` (lines 211, 486)
     - Status: Receives data from receipt pages (already uses canonical via pages)
     - No direct reads - data comes from receipt pages

3. **VAT Reports**
   - `app/reports/vat/page.tsx` (line 230)
     - Status: ✅ Uses `getGhanaLegacyView(sale.tax_lines)`
     - Issue: Hardcoded levy divisor `0.06` on lines 266-268
   - `app/reports/vat/diagnostic/page.tsx` (line 308)
     - Status: ✅ Uses `getGhanaLegacyView(sale.tax_lines)`
     - Issue: Hardcoded levy divisor `0.06` on lines 317-319

4. **Analytics**
   - `app/admin/retail/analytics/page.tsx` (line 467)
     - Status: ✅ Uses `getGhanaLegacyView(sale.tax_lines)`
     - Issue: Has fallback to legacy column on line 468

### Files NOT Including Sales (Out of Scope)

- `app/api/reports/tax-summary/route.ts` - System-wide report, does not include sales
- `app/api/vat-returns/calculate/route.ts` - Invoice-only, does not include sales

---

## Migration Checklist

- [x] B0: Inventory complete
- [ ] B1: Utilities exist - verify/test
- [ ] B2: Remove fallbacks from receipts
- [ ] B4: Remove hardcoded levy divisors from VAT reports
- [ ] B4: Remove fallback from analytics
