# Refund Handling End-to-End Investigation

## 1. Database Records Created/Updated on Refund

### File: `app/api/override/refund-sale/route.ts`

**Records Updated:**

1. **`sales` table** (Lines 177-188)
   - Field updated: `payment_status = "refunded"`
   - Field preserved: `store_id` (never modified)
   - Condition: `WHERE id = sale_id`
   - No reversal transaction created
   - No separate refund record created
   - Original sale record is modified in-place

2. **`overrides` table** (Lines 136-141)
   - Record INSERTED (not updated)
   - Fields: `action_type = "refund_sale"`, `reference_id = sale_id`, `cashier_id`, `supervisor_id`
   - This is an audit/log record, not a transaction record

3. **`cashier_sessions` table** (Lines 151-167)
   - Field updated: `supervised_actions_count` (incremented)
   - Condition: `WHERE id = sale.cashier_session_id` (if session exists)
   - Optional update (only if session exists)

4. **`products_stock` table** (Lines 273-277, 340-345, 291-299, 359-367)
   - Fields updated: `stock` and `stock_quantity` (ADDED back/restored)
   - Condition: `WHERE id = productStock.id` or variant stock record
   - Stock IS restored (positive quantity added)
   - Multiple records updated (one per product/variant in refunded sale)

5. **`stock_movements` table** (Lines 396-398)
   - Record INSERTED
   - Fields: `type = "refund"`, `quantity_change` (positive), `user_id = supervisorId`, `related_sale_id = sale_id`, `store_id = itemStoreId`
   - Audit trail record for stock restoration

**Summary:**
- Original `sales` record is updated (payment_status changed to "refunded")
- Stock IS restored to `products_stock` table
- Audit records created: `overrides` and `stock_movements`
- NO reversal journal entries created
- NO separate refund transaction record created
- NO accounting/ledger integration (no journal_entries created)

## 2. Refund Transaction Structure

### Does refund create reversal journal entries?
**NO** - No journal entries are created for refunds
- No queries to `journal_entries`, `ledger_entries`, or `vouchers` tables
- No accounting/ledger integration in refund API
- Refund API does not call any accounting functions (e.g., `post_journal_entry`)

### Does refund flag the original sale?
**YES** - `sales.payment_status` is updated to `"refunded"`
- The original sale record is modified in-place
- No separate flag field, uses existing `payment_status` field
- Field: `sales.payment_status = "refunded"` (line 174)

### Does refund create a separate refund transaction?
**NO** - No separate refund record is created
- Only an audit record in `overrides` table
- Stock movement record in `stock_movements` table (for inventory tracking)
- Original sale record is updated, not duplicated

## 3. How VAT/Tax Reports Query Data

### File: `app/reports/vat/page.tsx`

**Query Location**: Lines 99-104
```typescript
const { data: sales, error: salesError } = await supabase
  .from("sales")
  .select("id, amount, nhil, getfund, covid, vat, created_at, store_id")
  .eq("business_id", business.id)
  .eq("store_id", activeStoreId)
  .gte("created_at", startDate.toISOString())
```

**Filter Status**: ❌ **NO FILTER BY PAYMENT_STATUS**
- Query includes ALL sales regardless of `payment_status`
- Refunded sales (`payment_status = "refunded"`) are included in results
- No `.neq("payment_status", "refunded")` or `.eq("payment_status", "paid")` filter

**Tax Calculation**: Lines 186-192
```typescript
// Sum tax totals from sales table
for (const sale of sales) {
  nhil_total += Number(sale.nhil || 0)
  getfund_total += Number(sale.getfund || 0)
  covid_total += Number(sale.covid || 0)
  vat_total += Number(sale.vat || 0)
}
```
- Loops through ALL sales (including refunded)
- Adds tax amounts from refunded sales to totals
- No exclusion logic for refunded sales

### File: `app/reports/vat/diagnostic/page.tsx`

**Query Location**: Lines 125-131
```typescript
const { data: sales, error: salesError } = await supabase
  .from("sales")
  .select("id, amount, nhil, getfund, covid, vat, created_at, store_id")
  .eq("business_id", business.id)
  .eq("store_id", activeStoreId)
  .gte("created_at", startDate.toISOString())
  .order("created_at", { ascending: false })
```

**Filter Status**: ❌ **NO FILTER BY PAYMENT_STATUS**
- Same issue as main VAT report
- Includes refunded sales in diagnostic calculations

### File: `app/api/vat-returns/calculate/route.ts`

**Query Location**: Lines 50-58
```typescript
let invoiceQuery = supabase
  .from("invoices")
  .select("subtotal, nhil, getfund, covid, vat, total_tax, apply_taxes")
  .eq("business_id", business.id)
  .eq("status", "paid") // ONLY PAID invoices
  .eq("apply_taxes", true)
  .gte("issue_date", period_start_date)
  .lte("issue_date", period_end_date)
  .is("deleted_at", null)
```

**Filter Status**: ✅ **CORRECT** (invoices only, not sales)
- Filters by `status = "paid"` for invoices
- This API handles invoices, not POS sales
- Note: This is for invoice-based VAT, not retail sales

**Summary:**
- VAT reports query ALL sales without filtering by `payment_status`
- Refunded sales are included in tax calculations
- Tax totals include amounts from refunded sales
- No exclusion logic for `payment_status = "refunded"`

## 4. How Stock Calculations Query Data

### Stock Restoration (Refund API)
**File**: `app/api/override/refund-sale/route.ts` (Lines 195-419)
- ✅ Stock IS restored correctly to `products_stock` table
- ✅ Stock movement records are created with `type = "refund"`
- ✅ Stock restoration uses per-store inventory (`products_stock.store_id`)

### Inventory Reports
**File**: `app/inventory/history/page.tsx` (Lines 99-123)
- Queries `stock_movements` table
- Filters by `type` if `typeFilter !== "all"`
- Stock movement history correctly shows refund movements

**File**: `app/admin/retail/inventory-dashboard/page.tsx` (Lines 341-358)
- Sales query filters by `payment_status = "paid"` (line 345)
- ✅ Correctly excludes refunded sales from top-selling items
- Query: `.eq("payment_status", "paid")`

**Summary:**
- Stock restoration works correctly
- Stock movements are tracked correctly
- Inventory dashboard correctly excludes refunded sales
- Stock calculations are correct

## 5. Exact Reason Refunded Sales Are Still Included

### Root Cause: Missing Payment Status Filter in VAT Reports

**Primary Issue**: VAT reports do not filter by `payment_status`

**Affected Files:**
1. `app/reports/vat/page.tsx` (Lines 99-104)
   - Query: `.from("sales").select(...).eq("business_id", ...).eq("store_id", ...).gte("created_at", ...)`
   - **Missing**: `.neq("payment_status", "refunded")` or `.eq("payment_status", "paid")`

2. `app/reports/vat/diagnostic/page.tsx` (Lines 125-131)
   - Same query structure
   - **Missing**: Payment status filter

**Why This Happens:**
- Query builder does not exclude refunded sales
- Tax calculation loops process all sales, including refunded ones
- No business logic to skip refunded sales in tax aggregation

**Evidence:**
- VAT report query includes ALL sales from date range
- Tax totals sum amounts from refunded sales (lines 186-192 in `app/reports/vat/page.tsx`)
- No conditional logic to exclude `payment_status = "refunded"` sales

### Comparison with Other Reports

**Sales History API** (`app/api/sales-history/list/route.ts`):
- Lines 152-161: Has status filter logic
- If `status = "completed"`, filters by `payment_status = "paid"`
- If `status = "refunded"`, filters by `payment_status = "refunded"`
- ✅ Correctly handles payment status filtering

**Inventory Dashboard** (`app/admin/retail/inventory-dashboard/page.tsx`):
- Line 345: `.eq("payment_status", "paid")`
- ✅ Correctly excludes refunded sales

**Cash Office Report** (`app/api/reports/cash-office/route.ts`):
- Needs investigation - query structure not fully visible in search results
- Likely has similar issue if it queries sales without payment_status filter

**Analytics Page** (`app/admin/retail/analytics/page.tsx`):
- Lines 355-358: Client-side filter: `s.payment_status === undefined || s.payment_status === "paid" || s.payment_status === null`
- ✅ Correctly excludes refunded sales (only includes paid/undefined/null)

### Summary Table

| Report/Query | File | Filters by payment_status? | Includes Refunded Sales? |
|-------------|------|---------------------------|-------------------------|
| VAT Report | `app/reports/vat/page.tsx` | ❌ NO | ✅ YES (incorrect) |
| VAT Diagnostic | `app/reports/vat/diagnostic/page.tsx` | ❌ NO | ✅ YES (incorrect) |
| Sales History | `app/api/sales-history/list/route.ts` | ✅ YES | ❌ NO (correct) |
| Inventory Dashboard | `app/admin/retail/inventory-dashboard/page.tsx` | ✅ YES | ❌ NO (correct) |
| Analytics | `app/admin/retail/analytics/page.tsx` | ✅ YES (client-side) | ❌ NO (correct) |

---

## Findings Summary

1. **Refund Database Records**: ✅ Correct
   - Sale status updated to "refunded"
   - Stock restored correctly
   - Audit records created
   - No journal entries (by design - refunds are not integrated with accounting ledger)

2. **Refund Transaction Structure**: ✅ Correct
   - Original sale flagged (payment_status = "refunded")
   - No separate refund transaction (by design)
   - No reversal journal entries (by design)

3. **VAT/Tax Reports**: ❌ **INCORRECT**
   - Queries do NOT filter by `payment_status`
   - Refunded sales are included in tax calculations
   - Tax totals incorrectly include refunded sale amounts

4. **Stock Calculations**: ✅ Correct
   - Stock restoration works correctly
   - Stock movements tracked correctly
   - Inventory reports correctly exclude refunded sales

5. **Root Cause**: 
   - VAT reports (`app/reports/vat/page.tsx` and `app/reports/vat/diagnostic/page.tsx`) query ALL sales without filtering by `payment_status`
   - Tax calculation loops process all sales, including refunded ones
   - Missing filter: `.neq("payment_status", "refunded")` or `.eq("payment_status", "paid")`

## Affected Tables and Fields

**Tables:**
- `sales` (payment_status field)
- `overrides` (audit records)
- `products_stock` (stock restoration)
- `stock_movements` (audit trail)

**Fields:**
- `sales.payment_status` (used to flag refunded sales, but not filtered in VAT queries)
- `sales.nhil`, `sales.getfund`, `sales.covid`, `sales.vat` (tax amounts included in totals even when refunded)

**Queries to Fix:**
1. `app/reports/vat/page.tsx` - Line 99-104: Add `.neq("payment_status", "refunded")` or `.eq("payment_status", "paid")`
2. `app/reports/vat/diagnostic/page.tsx` - Line 125-131: Add `.neq("payment_status", "refunded")` or `.eq("payment_status", "paid")`
