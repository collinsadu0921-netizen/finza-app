# Sales Query Refund Analysis

## Investigation: All Files/APIs That Query Sales Table

### Pattern Analysis (Correct Implementations)

**Reference Implementations (CORRECT):**
1. **Inventory Dashboard** (`app/admin/retail/inventory-dashboard/page.tsx`):
   - Lines 341-346: `.eq("payment_status", "paid")` ✅
   - Purpose: Top-selling items calculation
   - **Rule**: Exclude refunded sales from sales statistics

2. **Sales History API** (`app/api/sales-history/list/route.ts`):
   - Lines 152-161: Conditional filter based on status parameter
   - If `status === "completed"`: `.eq("payment_status", "paid")` ✅
   - If `status === "refunded"`: `.eq("payment_status", "refunded")` ✅
   - **Rule**: Filter by payment_status based on user's status selection

3. **Retail Dashboard** (`app/retail/dashboard/page.tsx`):
   - Lines 104-108: `.eq("payment_status", "paid")` ✅
   - Purpose: Today's sales count and revenue
   - **Rule**: Exclude refunded sales from revenue calculations

4. **Analytics Page** (`app/admin/retail/analytics/page.tsx`):
   - Lines 355-358: Client-side filter: `s.payment_status === undefined || s.payment_status === "paid" || s.payment_status === null` ✅
   - Line 698: Query filter: `.eq("payment_status", "paid")` ✅
   - **Rule**: Exclude refunded sales from analytics calculations

5. **Store Dashboard** (`app/admin/retail/store/[storeId]/page.tsx`):
   - Lines 303-308: `.eq("payment_status", "paid")` ✅
   - Purpose: Today's sales for specific store
   - **Rule**: Exclude refunded sales from store statistics

6. **VAT Reports** (`app/reports/vat/page.tsx`, `app/reports/vat/diagnostic/page.tsx`):
   - Lines 105, 131: `.eq("payment_status", "paid")` ✅ (FIXED)
   - **Rule**: Exclude refunded sales from tax calculations

**Inferred Rule:**
- **Revenue/Statistics/Reports**: MUST exclude refunded sales (use `.eq("payment_status", "paid")`)
- **Sales History/List Views**: Conditional - show based on status filter parameter
- **Individual Sale Views**: Include all sales (for viewing details, receipts, etc.)

---

## Complete Findings Table

| File / API | Uses sales table | payment_status filter (exact) | Correct / Incorrect | Recommended action |
|------------|------------------|-------------------------------|---------------------|-------------------|
| `app/reports/vat/page.tsx` | Yes | `.eq("payment_status", "paid")` (line 105) | ✅ Correct (FIXED) | exclude |
| `app/reports/vat/diagnostic/page.tsx` | Yes | `.eq("payment_status", "paid")` (line 131) | ✅ Correct (FIXED) | exclude |
| `app/admin/retail/inventory-dashboard/page.tsx` | Yes | `.eq("payment_status", "paid")` (lines 345, 432, 463) | ✅ Correct | exclude |
| `app/api/sales-history/list/route.ts` | Yes | Conditional: `.eq("payment_status", "paid")` if status="completed" (line 154), `.eq("payment_status", "refunded")` if status="refunded" (line 156) | ✅ Correct | conditional |
| `app/retail/dashboard/page.tsx` | Yes | `.eq("payment_status", "paid")` (lines 108, 126) | ✅ Correct | exclude |
| `app/admin/retail/analytics/page.tsx` | Yes | **Initial query (line 265-270)**: None. **Client-side filter (lines 355-358)**: `s.payment_status === undefined \|\| s.payment_status === "paid" \|\| s.payment_status === null`. **Session sales query (line 698)**: `.eq("payment_status", "paid")` | ⚠️ Partially Incorrect | exclude (add `.eq("payment_status", "paid")` to initial query at line 270, remove client-side filter) |
| `app/admin/retail/store/[storeId]/page.tsx` | Yes | `.eq("payment_status", "paid")` (lines 307, 318) | ✅ Correct | exclude |
| `app/reports/registers/page.tsx` | Yes | None (lines 83-89) | ❌ Incorrect | exclude |
| `app/api/reports/cash-office/route.ts` | Yes | None (lines 200-206) | ❌ Incorrect | exclude |
| `app/sales/page.tsx` | Yes | None (lines 175-181) | ✅ Correct | include (list view - shows all statuses with badges) |
| `app/sales-history/[id]/page.tsx` | Yes | None (lines 244-260) - queries by ID only | ✅ Correct | include (individual sale detail view) |
| `app/api/sales-history/[id]/receipt/route.ts` | Yes | None (lines 120-135) - queries by ID only | ✅ Correct | include (receipt view - shows all statuses) |
| `app/api/override/refund-sale/route.ts` | Yes | None (lines 59-62) - reads by ID only | ✅ Correct | include (refund operation - needs to read sale) |
| `app/api/override/void-sale/route.ts` | Yes | None (lines 54-57) - reads by ID only | ✅ Correct | include (void operation - needs to read sale) |
| `app/api/override/discount/route.ts` | Yes | None (lines 66-69) - reads by ID only | ✅ Correct | include (discount operation - needs to read sale) |
| `app/api/sales/create/route.ts` | Yes | None (lines 343-346, 574, 617, 662, 673, 713, 759, 815) - INSERT/DELETE only | ✅ Correct | N/A (creates/deletes sales, doesn't query for reporting) |
| `app/api/reports/tax-summary/route.ts` | No | N/A | ✅ Correct | N/A (queries invoices, not sales) |
| `app/api/reports/profit-loss/route.ts` | No | N/A | ✅ Correct | N/A (queries journal entries, not sales) |
| `app/api/reports/balance-sheet/route.ts` | No | N/A | ✅ Correct | N/A (queries journal entries, not sales) |
| `app/api/reports/trial-balance/route.ts` | No | N/A | ✅ Correct | N/A (queries journal entries, not sales) |
| `app/admin/retail/stores/page.tsx` | Yes | None (lines 218-221) - existence check only (`.limit(1)`) | ✅ Correct | include (just checking if store has any sales) |
| `app/dashboard/page.tsx` | No | N/A | ✅ Correct | N/A (queries invoices/payments, not sales) |

---

## Summary

### Files Requiring Fixes

1. **`app/reports/registers/page.tsx`** (Line 83-89)
   - **Issue**: Queries all sales without payment_status filter
   - **Impact**: Refunded sales included in register statistics
   - **Fix**: Add `.eq("payment_status", "paid")` before `.not("register_id", "is", null)`

2. **`app/api/reports/cash-office/route.ts`** (Line 200-206)
   - **Issue**: Queries all sales without payment_status filter
   - **Impact**: Refunded sales included in cash office report totals
   - **Fix**: Add `.eq("payment_status", "paid")` after `.in("cashier_session_id", sessionIds)`

3. **`app/admin/retail/analytics/page.tsx`** (Line 265-270)
   - **Issue**: Initial query doesn't filter by payment_status (relies on client-side filter at line 355-358)
   - **Impact**: Inefficient - fetches refunded sales then filters client-side
   - **Fix**: Add `.eq("payment_status", "paid")` to initial query (line 265-270) and remove client-side filter (line 355-358)

### Files That Are Correct (No Changes Needed)

- **Individual Sale Views**: `app/sales-history/[id]/page.tsx`, `app/api/sales-history/[id]/receipt/route.ts` - Should show all sales (including refunded) for viewing details
- **Sales List Page**: `app/sales/page.tsx` - Shows all sales with status badges (correct behavior for list view)
- **Refund/Void Operations**: `app/api/override/refund-sale/route.ts`, `app/api/override/void-sale/route.ts`, `app/api/override/discount/route.ts` - Need to read sale by ID regardless of status
- **Store Existence Check**: `app/admin/retail/stores/page.tsx` - Just checking if store has sales (correct)

### Pattern Summary

**MUST EXCLUDE refunded sales:**
- Revenue/statistics calculations
- Dashboard KPIs
- Tax/VAT reports
- Cash office reports
- Register reports
- Analytics/reporting queries

**SHOULD INCLUDE refunded sales:**
- Individual sale detail views
- Sales history list (when user selects "refunded" filter)
- Receipt views
- Refund/void operations (need to read sale)

**CONDITIONAL:**
- Sales history list (filters by user's status selection)

