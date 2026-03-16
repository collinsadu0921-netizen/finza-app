# Bug Fixes Test Plan
## Testing the 3 Critical Bug Fixes

**Date**: Current  
**Status**: Ready for Testing

---

## 🐛 BUGS FIXED

### 1. ✅ Refund Stock Restoration Bug
**Fixed**: `app/api/override/refund-sale/route.ts`
- **Before**: Updated `products` table (wrong table)
- **After**: Updates `products_stock` table with proper `store_id` and `variant_id` handling

### 2. ✅ Void Sale Stock Restoration Missing
**Fixed**: `app/api/override/void-sale/route.ts`
- **Before**: No stock restoration (stock remained deducted)
- **After**: Restores stock to `products_stock` before deleting sale

### 3. ✅ Stock Reduction Error Handling
**Fixed**: `app/api/sales/create/route.ts`
- **Before**: Some errors were logged but sale continued
- **After**: Stock lookup errors now fail the sale properly

---

## 🧪 TEST PLAN

### Test 1: Refund Stock Restoration (Products)
**Goal**: Verify refunds restore stock correctly for regular products

**Steps**:
1. Create a product with stock = 10 in Store A
2. Make a sale: Sell 3 units
3. Verify stock = 7 after sale
4. Refund the sale (with supervisor approval)
5. **Expected**: Stock should be restored to 10
6. **Verify**: Check `products_stock` table for Store A

**Test Data**:
- Product: "Test Product A"
- Initial Stock: 10
- Sale Quantity: 3
- Expected After Refund: 10

---

### Test 2: Refund Stock Restoration (Variants)
**Goal**: Verify refunds restore stock correctly for variant products

**Steps**:
1. Create a product with variant "Large" (stock = 5) in Store A
2. Make a sale: Sell 2 units of "Large" variant
3. Verify variant stock = 3 after sale
4. Refund the sale (with supervisor approval)
5. **Expected**: Variant stock should be restored to 5
6. **Verify**: Check `products_stock` table with `variant_id` for Store A

**Test Data**:
- Product: "Test Product B" with variant "Large"
- Initial Variant Stock: 5
- Sale Quantity: 2
- Expected After Refund: 5

---

### Test 3: Refund Multi-Store Isolation
**Goal**: Verify refunds only affect the correct store

**Steps**:
1. Create product with stock = 10 in Store A and stock = 15 in Store B
2. Make a sale in Store A: Sell 3 units
3. Verify Store A stock = 7, Store B stock = 15 (unchanged)
4. Refund the sale
5. **Expected**: Store A stock = 10, Store B stock = 15 (unchanged)
6. **Verify**: Check both stores' stock in `products_stock` table

---

### Test 4: Void Sale Stock Restoration (Products)
**Goal**: Verify voided sales restore stock correctly

**Steps**:
1. Create a product with stock = 10 in Store A
2. Make a sale: Sell 3 units
3. Verify stock = 7 after sale
4. Void the sale (with supervisor approval)
5. **Expected**: Stock should be restored to 10
6. **Verify**: Check `products_stock` table for Store A
7. **Verify**: Sale should be deleted from `sales` table

**Test Data**:
- Product: "Test Product C"
- Initial Stock: 10
- Sale Quantity: 3
- Expected After Void: 10

---

### Test 5: Void Sale Stock Restoration (Variants)
**Goal**: Verify voided sales restore variant stock correctly

**Steps**:
1. Create a product with variant "Small" (stock = 8) in Store A
2. Make a sale: Sell 2 units of "Small" variant
3. Verify variant stock = 6 after sale
4. Void the sale (with supervisor approval)
5. **Expected**: Variant stock should be restored to 8
6. **Verify**: Check `products_stock` table with `variant_id` for Store A

---

### Test 6: Stock Reduction Error Handling
**Goal**: Verify stock lookup errors fail the sale

**Steps**:
1. Create a sale with a product
2. Simulate database error when fetching stock (or use invalid store_id)
3. **Expected**: Sale should fail with error message
4. **Verify**: No sale record created
5. **Verify**: No stock deducted

**Note**: This test may require mocking or database manipulation

---

### Test 7: Stock Movement Records
**Goal**: Verify stock movements are logged correctly

**Steps**:
1. Make a sale
2. Check `stock_movements` table
3. **Expected**: Record with `type: "sale"`, `quantity_change: -X`
4. Refund the sale
5. Check `stock_movements` table again
6. **Expected**: New record with `type: "refund"`, `quantity_change: +X`
7. Void a sale
8. Check `stock_movements` table
9. **Expected**: Record with `type: "adjustment"`, `quantity_change: +X` (for void)

---

### Test 8: Edge Cases

#### 8.1 Refund Product Without Stock Record
**Steps**:
1. Make a sale (stock record exists)
2. Manually delete the stock record from `products_stock`
3. Refund the sale
4. **Expected**: New stock record should be created with refunded quantity

#### 8.2 Void Sale Without Stock Record
**Steps**:
1. Make a sale (stock record exists)
2. Manually delete the stock record from `products_stock`
3. Void the sale
4. **Expected**: New stock record should be created with voided quantity

#### 8.3 Multiple Items in Sale
**Steps**:
1. Create sale with 3 different products
2. Refund the sale
3. **Expected**: All 3 products' stock should be restored

---

## ✅ VERIFICATION CHECKLIST

After each test, verify:

- [ ] Stock is restored to correct value in `products_stock` table
- [ ] Correct `store_id` is used (multi-store isolation)
- [ ] Variants are handled correctly (if applicable)
- [ ] Stock movement records are created
- [ ] Stock movement records have correct `type` and `quantity_change`
- [ ] Stock movement records include `store_id`
- [ ] No errors in console logs
- [ ] Sale status is correct (refunded/voided)

---

## 🔍 SQL QUERIES FOR VERIFICATION

### Check Stock After Refund/Void
```sql
SELECT 
  ps.id,
  ps.product_id,
  ps.variant_id,
  ps.store_id,
  ps.stock,
  ps.stock_quantity,
  p.name as product_name,
  pv.variant_name
FROM products_stock ps
LEFT JOIN products p ON p.id = ps.product_id
LEFT JOIN products_variants pv ON pv.id = ps.variant_id
WHERE ps.product_id = 'YOUR_PRODUCT_ID'
  AND ps.store_id = 'YOUR_STORE_ID'
ORDER BY ps.variant_id NULLS FIRST;
```

### Check Stock Movements
```sql
SELECT 
  sm.id,
  sm.product_id,
  sm.variant_id,
  sm.store_id,
  sm.quantity_change,
  sm.type,
  sm.note,
  sm.created_at,
  sm.related_sale_id
FROM stock_movements sm
WHERE sm.related_sale_id = 'YOUR_SALE_ID'
ORDER BY sm.created_at;
```

### Check Sale Status
```sql
SELECT 
  id,
  payment_status,
  store_id,
  created_at
FROM sales
WHERE id = 'YOUR_SALE_ID';
```

---

## 📝 TEST RESULTS TEMPLATE

### Test 1: Refund Stock Restoration (Products)
- [ ] Pass
- [ ] Fail
- **Notes**: 

### Test 2: Refund Stock Restoration (Variants)
- [ ] Pass
- [ ] Fail
- **Notes**: 

### Test 3: Refund Multi-Store Isolation
- [ ] Pass
- [ ] Fail
- **Notes**: 

### Test 4: Void Sale Stock Restoration (Products)
- [ ] Pass
- [ ] Fail
- **Notes**: 

### Test 5: Void Sale Stock Restoration (Variants)
- [ ] Pass
- [ ] Fail
- **Notes**: 

### Test 6: Stock Reduction Error Handling
- [ ] Pass
- [ ] Fail
- **Notes**: 

### Test 7: Stock Movement Records
- [ ] Pass
- [ ] Fail
- **Notes**: 

### Test 8: Edge Cases
- [ ] Pass
- [ ] Fail
- **Notes**: 

---

## 🚀 READY FOR TESTING

All three bugs have been fixed. The system is now ready for comprehensive testing.

**Next Steps**:
1. Run through all test cases
2. Document results
3. Fix any issues found
4. Re-test until all pass
5. Mark as ready for launch





