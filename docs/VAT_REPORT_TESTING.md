# VAT Report Testing Guide

## Quick Test Methods

### Method 1: Manual POS Testing (Recommended)

1. **Create a test product**:
   - Go to Products page
   - Create a product with price: **GHS 254.03** (VAT-inclusive)
   - Assign to a category with VAT type: **Standard**

2. **Make a test sale**:
   - Go to POS
   - Add the product (quantity: 1)
   - Complete payment
   - Note the sale amount

3. **Verify in VAT Report**:
   - Go to Reports → VAT Report
   - Select "Today" filter
   - Check:
     - Standard Rated Sales = **GHS 254.03**
     - Taxable Base = **GHS 208.40**
     - NHIL = **GHS 5.21**
     - GETFund = **GHS 5.21**
     - COVID = **GHS 2.08**
     - VAT = **GHS 33.14**
     - Total Tax = **GHS 45.63**

### Method 2: Test with Known Amounts

Use these test cases to verify calculations:

#### Test Case 1: GHS 254.03 (Single Item)
```
Expected Results:
- Standard Rated Sales: 254.03
- Taxable Base: 208.40
- NHIL (2.5%): 5.21
- GETFund (2.5%): 5.21
- COVID (1%): 2.08
- VAT (15%): 33.14
- Total Tax: 45.63
- Verification: 208.40 + 45.63 = 254.03 ✓
```

#### Test Case 2: GHS 516.37 (Multiple Items)
```
Expected Results:
- Standard Rated Sales: 516.37
- Taxable Base: 423.60
- NHIL (2.5%): 10.59
- GETFund (2.5%): 10.59
- COVID (1%): 4.24
- VAT (15%): 67.35
- Total Tax: 92.77
- Verification: 423.60 + 92.77 = 516.37 ✓
```

#### Test Case 3: GHS 562.00 (From Your Report)
```
Expected Results:
- Standard Rated Sales: 562.00
- Taxable Base: 461.00 (approximately)
- Total Tax: 101.00 (approximately)
- Verification: 461.00 + 101.00 = 562.00 ✓
```

### Method 3: Browser Console Testing

Open browser console (F12) and run:

```javascript
// Test calculation function
function testVATCalculation(amount) {
  const base = amount / 1.219;
  const nhil = base * 0.025;
  const getfund = base * 0.025;
  const covid = base * 0.01;
  const vatBase = base + nhil + getfund + covid;
  const vat = vatBase * 0.15;
  const totalTax = nhil + getfund + covid + vat;
  
  console.log('Amount (VAT-inclusive):', amount.toFixed(2));
  console.log('Base:', base.toFixed(2));
  console.log('NHIL:', nhil.toFixed(2));
  console.log('GETFund:', getfund.toFixed(2));
  console.log('COVID:', covid.toFixed(2));
  console.log('VAT:', vat.toFixed(2));
  console.log('Total Tax:', totalTax.toFixed(2));
  console.log('Verification:', (base + totalTax).toFixed(2));
  
  return { base, nhil, getfund, covid, vat, totalTax };
}

// Test with your amount
testVATCalculation(562.00);
```

### Method 4: Check Database Directly

1. **Check sales table**:
```sql
SELECT 
  id,
  amount,
  nhil,
  getfund,
  covid,
  vat,
  (nhil + getfund + covid + vat) as total_tax,
  created_at
FROM sales
WHERE store_id = 'your-store-id'
  AND created_at >= CURRENT_DATE
ORDER BY created_at DESC;
```

2. **Check sale_items**:
```sql
SELECT 
  si.sale_id,
  si.product_id,
  si.price,
  si.qty,
  (si.price * si.qty) as line_total,
  p.category_id,
  c.vat_type
FROM sale_items si
LEFT JOIN products p ON si.product_id = p.id
LEFT JOIN categories c ON p.category_id = c.id
WHERE si.sale_id IN (
  SELECT id FROM sales 
  WHERE store_id = 'your-store-id' 
    AND created_at >= CURRENT_DATE
)
ORDER BY si.created_at DESC;
```

3. **Verify calculations**:
```sql
-- Sum of line totals by VAT type
SELECT 
  COALESCE(c.vat_type, 'standard') as vat_type,
  SUM(si.price * si.qty) as total_sales
FROM sale_items si
LEFT JOIN products p ON si.product_id = p.id
LEFT JOIN categories c ON p.category_id = c.id
WHERE si.sale_id IN (
  SELECT id FROM sales 
  WHERE store_id = 'your-store-id' 
    AND created_at >= CURRENT_DATE
)
GROUP BY COALESCE(c.vat_type, 'standard');
```

## Validation Checklist

### ✅ Basic Validation
- [ ] Standard Rated Sales = Sum of line totals (VAT-inclusive) for standard items
- [ ] Taxable Base = Reverse-calculated from tax amounts
- [ ] Standard Rated Sales = Taxable Base + Total Tax
- [ ] Tax totals match sum of individual taxes

### ✅ Tax Calculation Validation
- [ ] NHIL = Taxable Base × 0.025
- [ ] GETFund = Taxable Base × 0.025
- [ ] COVID = Taxable Base × 0.01
- [ ] VAT = (Taxable Base + NHIL + GETFund + COVID) × 0.15
- [ ] Total Tax = NHIL + GETFund + COVID + VAT

### ✅ Edge Cases
- [ ] Sales with zero-rated items (should show in Zero Rated Sales)
- [ ] Sales with exempt items (should show in Exempt Sales)
- [ ] Sales with mixed VAT types (standard + exempt)
- [ ] Products without categories (defaults to standard)
- [ ] Empty sales (shows zeros)
- [ ] Date filter changes (Today, Week, Month)

## Debugging Tips

### 1. Check Console Logs
Open browser console and look for:
- `VAT Report Validation Failed` errors
- Calculation details in console.error

### 2. Verify Store Context
- Ensure a store is selected (not "all")
- Check `activeStoreId` in session storage

### 3. Check VAT Settings
- Verify `retail_vat_inclusive = true` in businesses table
- Confirm categories have correct `vat_type`

### 4. Common Issues

**Issue**: Taxable Base doesn't match tax calculations
- **Fix**: Taxes are calculated on combined subtotal, not per-item
- **Solution**: Reverse-calculate base from tax amounts

**Issue**: Standard Rated Sales ≠ Taxable Base + Total Tax
- **Fix**: Check if sales have mixed VAT types
- **Solution**: Ensure only standard-rated items are included

**Issue**: Taxes are zero
- **Fix**: Check if products have categories with VAT type
- **Solution**: Default to "standard" if category missing

## Quick Test Script

Run this in Node.js to verify calculations:

```javascript
const testAmounts = [254.03, 516.37, 562.00, 100.00, 1000.00];

testAmounts.forEach(amount => {
  const base = amount / 1.219;
  const nhil = base * 0.025;
  const getfund = base * 0.025;
  const covid = base * 0.01;
  const vatBase = base + nhil + getfund + covid;
  const vat = vatBase * 0.15;
  const totalTax = nhil + getfund + covid + vat;
  const verification = base + totalTax;
  
  console.log(`\nAmount: ${amount.toFixed(2)}`);
  console.log(`Base: ${base.toFixed(2)}`);
  console.log(`Tax: ${totalTax.toFixed(2)}`);
  console.log(`Verification: ${verification.toFixed(2)}`);
  console.log(`Match: ${Math.abs(amount - verification) < 0.01 ? '✓' : '✗'}`);
});
```

## Expected Results Summary

For **GHS 562.00** (from your report):
- **Taxable Base**: ~208.40 (if taxes = 45.63)
- **OR Taxable Base**: ~461.00 (if calculated from 562.00)
- **Issue**: The taxes shown (45.63) suggest base = 208.40, but Standard Rated Sales = 562.00
- **This indicates**: Either taxes are incorrect, or there are multiple sales being aggregated

**Solution**: Check individual sales to see which one has the correct tax amounts.

