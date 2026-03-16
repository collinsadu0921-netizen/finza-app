# Tax Engine Sanity Test Checklist

## Test Environment Setup
- Ensure database migration `083_add_generic_tax_columns.sql` has been applied
- Ensure business has `address_country` set (defaults to 'Ghana' or 'GH')
- Test with a business that has `apply_taxes = true`

## ⚠️ Known Limitations
- **Sales route (`app/api/sales/create/route.ts`)**: Still uses legacy tax columns (nhil, getfund, covid, vat) passed from frontend. POS frontend calculates taxes correctly using shared engine, but backend doesn't yet store `tax_lines` JSONB. This is tracked as TODO #5.

---

## ✅ Test 1: Invoice Sent at 2025-12-31 Includes COVID (Version A)

### Steps:
1. Create an invoice with:
   - `issue_date`: `2025-12-30`
   - `status`: `"sent"` (or set status to "sent" after creation)
   - `sent_at`: `2025-12-31T00:00:00Z` (or date string `2025-12-31`)
   - Line items with tax-inclusive prices
   - `apply_taxes`: `true`

### Expected Results:
- ✅ `tax_lines` JSONB contains COVID tax line with `code: "COVID"` and `amount > 0`
- ✅ Legacy `covid` column > 0
- ✅ Tax breakdown shows: NHIL, GETFund, **COVID**, VAT
- ✅ Multiplier = (1 + 0.025 + 0.025 + 0.01) × (1 + 0.15) = **1.219**
- ✅ Base amount × 1.219 = Total inclusive (reconciles)

### Verification SQL:
```sql
SELECT 
  id,
  invoice_number,
  sent_at,
  tax_lines->'tax_lines' as tax_lines_array,
  nhil,
  getfund,
  covid,  -- Should be > 0
  vat,
  total_tax,
  tax_engine_effective_from
FROM invoices
WHERE sent_at::date = '2025-12-31'
  AND apply_taxes = true
ORDER BY created_at DESC
LIMIT 1;
```

---

## ✅ Test 2: Invoice Sent at 2026-01-01 Excludes COVID (Version B)

### Steps:
1. Create an invoice with:
   - `issue_date`: `2026-01-01`
   - `status`: `"sent"`
   - `sent_at`: `2026-01-01T00:00:00Z` (or date string `2026-01-01`)
   - Line items with tax-inclusive prices
   - `apply_taxes`: `true`

### Expected Results:
- ✅ `tax_lines` JSONB does **NOT** contain COVID tax line (or has `amount = 0`)
- ✅ Legacy `covid` column = 0 (or NULL)
- ✅ Tax breakdown shows: NHIL, GETFund, VAT (NO COVID)
- ✅ Multiplier = (1 + 0.025 + 0.025 + 0) × (1 + 0.15) = **1.2075**
- ✅ Base amount × 1.2075 = Total inclusive (reconciles)

### Verification SQL:
```sql
SELECT 
  id,
  invoice_number,
  sent_at,
  tax_lines->'tax_lines' as tax_lines_array,
  nhil,
  getfund,
  covid,  -- Should be 0
  vat,
  total_tax,
  tax_engine_effective_from
FROM invoices
WHERE sent_at::date = '2026-01-01'
  AND apply_taxes = true
ORDER BY created_at DESC
LIMIT 1;
```

### Manual UI Check:
- Open invoice preview/PDF
- Tax breakdown section should show 3 tax lines (NHIL, GETFund, VAT)
- COVID should NOT appear in the list

---

## ✅ Test 3: POS Sale on 2026-01-01 Excludes COVID (Version B)

### Steps:
1. Set system date to 2026-01-01 (or manually test)
2. Create a sale via POS:
   - Add items to cart
   - Complete sale (creates record with `created_at = 2026-01-01`)
   - Ensure `retail_vat_inclusive = true`

### Expected Results:
- ✅ Sale record `tax_lines` JSONB does **NOT** contain COVID
- ✅ Legacy `covid` column = 0
- ✅ Tax calculation uses Version B multiplier (1.2075)
- ✅ Cart totals show: NHIL, GETFund, VAT (NO COVID)

### Verification SQL:
```sql
SELECT 
  id,
  sale_number,
  created_at::date as sale_date,
  tax_lines->'tax_lines' as tax_lines_array,
  nhil,
  getfund,
  covid,  -- Should be 0
  vat,
  total_tax,
  tax_engine_effective_from
FROM sales
WHERE created_at::date = '2026-01-01'
  AND nhil > 0  -- Has taxes applied
ORDER BY created_at DESC
LIMIT 1;
```

### Manual UI Check:
- POS cart totals should show 3 tax components (NHIL, GETFund, VAT)
- COVID should NOT appear

---

## ✅ Test 4: Discounts Reduce Tax Base (Invoicing)

### Steps:
1. Create an invoice with:
   - Line item: qty=1, unit_price=100, discount_amount=10
   - `apply_taxes`: `true`
   - Tax-inclusive pricing

### Expected Results:
- ✅ Taxable base = (1 × 100) - 10 = **90**
- ✅ Taxes calculated on base of 90, NOT 100
- ✅ `subtotal_excl_tax` = 90 (or reverse-calculated base if inclusive)
- ✅ All tax amounts (NHIL, GETFund, COVID, VAT) are calculated on discounted base

### Verification SQL:
```sql
SELECT 
  i.id,
  i.invoice_number,
  i.subtotal,
  i.total_tax,
  i.total,
  ii.qty,
  ii.unit_price,
  ii.discount_amount,
  (ii.qty * ii.unit_price - ii.discount_amount) as line_total_after_discount
FROM invoices i
JOIN invoice_items ii ON ii.invoice_id = i.id
WHERE i.apply_taxes = true
  AND ii.discount_amount > 0
ORDER BY i.created_at DESC
LIMIT 1;
```

### Manual Calculation Check:
- Base amount should exclude discount
- Tax calculation should use discounted base
- Total should reconcile: base + taxes = total_incl_tax

---

## ✅ Test 5: Discounts Reduce Tax Base (POS)

### Steps:
1. In POS, add item with discount
2. Complete sale

### Expected Results:
- ✅ Cart totals calculate tax on discounted line total
- ✅ Tax base excludes discount amount
- ✅ All tax components calculated correctly on reduced base

### Manual UI Check:
- Add item with price 100
- Apply discount of 10
- Verify tax calculated on 90, not 100

---

## ✅ Test 6: Tax-Inclusive Totals Reconcile with Dynamic Divisor

### Steps:
1. Create invoice with total_incl_tax = 121.90 (or known inclusive total)
2. Verify reverse calculation uses dynamic multiplier

### Expected Results:

#### For Version A (before 2026-01-01):
- ✅ Multiplier = (1 + 0.025 + 0.025 + 0.01) × (1 + 0.15) = **1.219**
- ✅ Base = 121.90 / 1.219 = **100.00** (approximately)
- ✅ Base + NHIL + GETFund + COVID + VAT = 121.90 (reconciles)

#### For Version B (>= 2026-01-01):
- ✅ Multiplier = (1 + 0.025 + 0.025 + 0) × (1 + 0.15) = **1.2075**
- ✅ Base = 121.90 / 1.2075 = **100.95** (approximately)
- ✅ Base + NHIL + GETFund + VAT = 121.90 (reconciles, no COVID)

### Verification SQL:
```sql
-- Check multiplier calculation matches stored tax_lines
SELECT 
  id,
  invoice_number,
  sent_at::date as effective_date,
  total as total_incl_tax,
  subtotal as base_amount,
  total_tax,
  -- Verify: base + total_tax should equal total
  (subtotal + total_tax) as calculated_total,
  CASE 
    WHEN sent_at::date < '2026-01-01' THEN 1.219
    WHEN sent_at::date >= '2026-01-01' THEN 1.2075
    ELSE NULL
  END as expected_multiplier,
  -- Verify reverse: total / multiplier should equal base
  (total / CASE 
    WHEN sent_at::date < '2026-01-01' THEN 1.219
    WHEN sent_at::date >= '2026-01-01' THEN 1.2075
    ELSE NULL
  END) as reverse_calculated_base
FROM invoices
WHERE apply_taxes = true
  AND sent_at IS NOT NULL
ORDER BY sent_at DESC
LIMIT 5;
```

### Expected Results:
- ✅ `calculated_total` should equal `total_incl_tax` (within rounding)
- ✅ `reverse_calculated_base` should approximately equal `base_amount` (within rounding)

---

## ✅ Test 7: Invoice Draft Uses issue_date, Sent Uses sent_at

### Steps:
1. Create invoice as draft with `issue_date = 2025-12-30`
2. Send invoice (sets `sent_at = 2026-01-01`)

### Expected Results:
- ✅ Draft calculation uses `issue_date` (2025-12-30) → Version A (includes COVID)
- ✅ After sending, calculation uses `sent_at` (2026-01-01) → Version B (excludes COVID)
- ✅ `tax_engine_effective_from` stores the effective date used
- ✅ Tax amounts may change when invoice is sent if dates cross version boundary

### Verification SQL:
```sql
SELECT 
  id,
  invoice_number,
  issue_date,
  sent_at,
  tax_engine_effective_from,
  covid,
  CASE 
    WHEN sent_at IS NOT NULL THEN sent_at::date
    ELSE issue_date
  END as effective_date_used,
  CASE 
    WHEN (COALESCE(sent_at::date, issue_date) < '2026-01-01') THEN 'Version A (COVID included)'
    ELSE 'Version B (COVID excluded)'
  END as expected_version
FROM invoices
WHERE id = '<invoice_id>';
```

---

## ✅ Test 8: POS Uses created_at as Effective Date

### Steps:
1. Create sale via POS on 2026-01-01

### Expected Results:
- ✅ Sale `tax_engine_effective_from` = `created_at` date
- ✅ Uses Version B (no COVID) if created_at >= 2026-01-01
- ✅ Tax calculation matches invoice calculation for same date

---

## ✅ Test 9: Generic Tax Columns Stored Correctly

### Steps:
1. Create invoice with taxes applied
2. Check database record

### Expected Results:
- ✅ `tax_lines` JSONB contains array of tax line objects:
  ```json
  {
    "tax_lines": [
      {"code": "NHIL", "name": "NHIL", "rate": 0.025, "base": 100, "amount": 2.5},
      {"code": "GETFUND", "name": "GETFund", "rate": 0.025, "base": 100, "amount": 2.5},
      {"code": "COVID", "name": "COVID", "rate": 0.01, "base": 100, "amount": 1.0},  -- Only if Version A
      {"code": "VAT", "name": "VAT", "rate": 0.15, "base": 105, "amount": 15.75}
    ],
    "subtotal_excl_tax": 100,
    "tax_total": 21.75,
    "total_incl_tax": 121.75
  }
  ```
- ✅ `tax_engine_code` = `"ghana"`
- ✅ `tax_engine_effective_from` = effective date (YYYY-MM-DD)
- ✅ `tax_jurisdiction` = business country code (e.g., "GH")
- ✅ Legacy columns (`nhil`, `getfund`, `covid`, `vat`) derived from `tax_lines`

---

## ✅ Test 10: FinancialDocument Renders Tax Lines Dynamically

### Steps:
1. Generate invoice PDF/preview
2. Check HTML output

### Expected Results:
- ✅ Tax breakdown section shows tax lines dynamically
- ✅ Labels use `taxLine.name` (e.g., "NHIL", "GETFund", "COVID", "VAT")
- ✅ Rates shown as `(rate * 100).toFixed(1)%` (e.g., "2.5%", "15.0%")
- ✅ No hard-coded labels like "COVID (1%)"
- ✅ COVID only appears if `amount > 0`

### Verification:
- View invoice PDF/preview HTML source
- Search for tax breakdown section
- Verify dynamic rendering: `${taxLine.name} (${(taxLine.rate * 100).toFixed(1)}%)`

---

## Edge Cases to Test

### Edge Case 1: Invoice Created Before 2026, Sent After 2026
- Create draft on 2025-12-31 (Version A, includes COVID)
- Send on 2026-01-01 (should recalculate with Version B, excludes COVID)
- Tax amounts should update when status changes to "sent"

### Edge Case 2: Business Country Not Set
- Business with `address_country = NULL` or empty string
- Should default to "GH" (Ghana)
- Tax engine should still work

### Edge Case 3: Zero Amount Tax Lines
- Tax line with rate > 0 but amount = 0 (rounding)
- Should not appear in UI (filtered by `amount > 0`)

### Edge Case 4: Multiple Discounts
- Multiple line items, each with discounts
- Each discount should reduce that line's taxable base
- Total tax should sum correctly

---

## Automated Test Suggestions

Consider creating unit tests for:
1. `getRatesForDate()` function - verify version selection
2. `getCompoundMultiplier()` function - verify multiplier calculation
3. `calculateFromAmount()` - verify tax calculation
4. `reverseCalculate()` - verify reverse calculation reconciles
5. `deriveLegacyGhanaTaxAmounts()` - verify legacy column derivation

---

## Notes

- All monetary values should be rounded to 2 decimal places
- Tax calculations may have small rounding differences (acceptable)
- The dynamic multiplier eliminates the hard-coded `1.219` magic number
- COVID tax is conditionally included based on effective date version

