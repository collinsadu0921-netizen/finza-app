# Stock Display Bug - Products Page

## Problem Summary
Stock displays correctly everywhere EXCEPT the products page. After adjusting stock, the products page shows 120 instead of 12.

## Symptoms

### What Works Correctly:
1. **Stock Adjustment Modal**: Shows correct current stock (12)
2. **Stock Adjustment Input**: User can enter quantity correctly
3. **Stock Adjustment Save**: Saves correctly to database (verified - stock is 12)
4. **POS Page**: Shows correct stock (12) and can only sell 12 units
5. **Inventory Page**: Shows correct stock
6. **All other pages**: Stock displays correctly

### What's Broken:
1. **Products Page Display**: After saving stock adjustment, shows "Stock: 120" instead of "Stock: 12"
2. **Timing**: Issue occurs AFTER save, during reload
3. **Scope**: Only affects products page, nowhere else

## User Flow That Triggers Bug:
1. User opens "Adjust Stock" modal for product "Belaqua small"
2. Modal shows "Current Stock: 12" ✅ (correct)
3. User selects "Add Stock", enters quantity "1"
4. User clicks "Submit"
5. Stock is saved to `products_stock` table ✅ (correct - value is 12)
6. Modal closes, `onSuccess()` calls `load()` to reload products
7. Products page reloads and displays "Stock: 120" ❌ (wrong - should be 12)

## Technical Details

### Database State:
- `products_stock.stock` = 12 (correct)
- `products_stock.stock_quantity` = 12 (correct)
- `products.stock` = may have old value (not used for display)
- `products.stock_quantity` = may have old value (not used for display)

### Code Flow:
1. `load()` function in `app/products/page.tsx` runs
2. Loads products from `products` table
3. Loads stock from `products_stock` table for active store
4. Merges stock data into product objects
5. Sets `products` state
6. Products page renders and displays stock

### Potential Causes:
1. **String Concatenation**: Stock value "12" being concatenated with "0" = "120"
2. **Type Coercion**: Number 12 being treated as string and concatenated
3. **Aggregation Issue**: "All stores" mode aggregating incorrectly (even with one store)
4. **Multiple Records**: Duplicate `products_stock` records being summed incorrectly
5. **Fallback Logic**: Falling back to `products` table which has wrong value
6. **Display Logic**: Display code reading wrong field or doing wrong conversion

## Files Involved:
- `app/products/page.tsx` - Products page (where bug occurs)
- `components/StockAdjustmentModal.tsx` - Stock adjustment (works correctly)
- `app/(dashboard)/pos/page.tsx` - POS page (works correctly)

## Current Status:
- Multiple fixes attempted but issue persists
- Debug logging added to trace the problem
- Need to identify exact point where 12 becomes 120

## Next Steps:
1. Check browser console logs after stock adjustment
2. Verify what value is actually in `products_stock` table
3. Check if "all stores" mode is causing aggregation issues
4. Verify if there are duplicate stock records
5. Check if products table has stale stock_quantity = 120

