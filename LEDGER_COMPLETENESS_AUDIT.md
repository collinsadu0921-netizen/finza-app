# Ledger Completeness Audit: Retail Sales to Trial Balance

**Date:** 2025-01-28  
**Auditor:** Accounting Systems Review  
**Scope:** Read-only audit of retail sales posting completeness vs operational reality  
**Objective:** Determine if FINZA can produce correct Trial Balance and P&L for retail sales today

---

## Executive Summary

This audit examines whether retail sales in FINZA are properly reflected in the general ledger, with particular focus on revenue recognition, tax liabilities, inventory asset reductions, and cost of goods sold. The analysis traces the data path from operational sale creation through to journal entry posting, identifying gaps that would prevent accurate financial statement generation.

---

## 1. Data Path for Retail Sale

### Operational Path

1. **Sales Creation** (`app/api/sales/create/route.ts`):
   - Sale record inserted into `sales` table
   - Sale items inserted into `sale_items` table (includes `cogs` calculation: `cost_price * quantity`)
   - Stock reduction: `products_stock` table updated (inventory quantity decreased)
   - Stock movement recorded in `stock_movements` table for audit trail

2. **Stock Movement**:
   - `stock_movements` records created with `type = 'sale'` and `related_sale_id` link
   - Negative `quantity_change` reflects inventory reduction
   - Links to `product_id` and optionally `store_id`

3. **COGS Calculation**:
   - Stored in `sale_items.cogs` column (numeric value)
   - Calculated at time of sale as `product.cost_price * quantity`
   - **Not used in any ledger posting**

### Accounting Path (Ledger Posting)

1. **Journal Entry Creation** (`post_sale_to_ledger` function):
   - Function location: `supabase/migrations/100_control_account_resolution.sql` (lines 467-610)
   - Creates journal entry via `post_journal_entry` function
   - Journal entry has `reference_type = 'sale'` and `reference_id = sale.id`

2. **Journal Entry Lines Posted**:
   - **Cash/Bank Account**: DEBIT (sale total amount)
   - **Revenue Account** (code 4000): CREDIT (subtotal, net of taxes)
   - **Tax Control Accounts** (codes from `tax_lines`): CREDIT (various tax amounts)
   - **Inventory Asset Account**: NOT POSTED
   - **COGS Account** (code 5000): NOT POSTED

3. **Critical Gap**:
   - `post_sale_to_ledger` function exists but may not be called automatically
   - No trigger found to auto-post sales to ledger
   - Application code (`app/api/sales/create/route.ts`) does NOT call `post_sale_to_ledger`
   - Sales may exist without corresponding journal entries

---

## 2. Verification Queries Required

To complete this audit, the following SQL queries must be executed against the production database:

```sql
-- Query 1: Check if last 50 sales have corresponding journal entries
SELECT 
  s.id AS sale_id,
  s.business_id,
  s.amount AS sale_amount,
  s.created_at AS sale_date,
  je.id AS journal_entry_id,
  je.reference_type,
  je.reference_id,
  CASE 
    WHEN je.id IS NOT NULL THEN 'Y'
    ELSE 'N'
  END AS posted_to_gl
FROM sales s
LEFT JOIN journal_entries je 
  ON je.reference_type = 'sale' 
  AND je.reference_id = s.id
ORDER BY s.created_at DESC
LIMIT 50;

-- Query 2: For sales with journal entries, check what accounts are posted
SELECT 
  s.id AS sale_id,
  s.amount AS sale_amount,
  je.id AS journal_entry_id,
  a.code AS account_code,
  a.name AS account_name,
  a.type AS account_type,
  jel.debit,
  jel.credit,
  jel.description
FROM sales s
JOIN journal_entries je 
  ON je.reference_type = 'sale' 
  AND je.reference_id = s.id
JOIN journal_entry_lines jel 
  ON jel.journal_entry_id = je.id
JOIN accounts a 
  ON a.id = jel.account_id
WHERE s.created_at >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY s.id, a.code;

-- Query 3: Check for revenue, tax, COGS, and inventory postings
SELECT 
  s.id AS sale_id,
  s.amount AS sale_amount,
  je.id AS journal_entry_id,
  MAX(CASE WHEN a.code LIKE '4000%' THEN 'Y' ELSE 'N' END) AS revenue_posted,
  MAX(CASE WHEN a.code LIKE '210%' OR a.code LIKE '211%' OR a.code LIKE '212%' OR a.code LIKE '213%' THEN 'Y' ELSE 'N' END) AS tax_posted,
  MAX(CASE WHEN a.code LIKE '5000%' THEN 'Y' ELSE 'N' END) AS cogs_posted,
  MAX(CASE WHEN a.code LIKE '1200%' OR a.code LIKE '13%' THEN 'Y' ELSE 'N' END) AS inventory_posted
FROM sales s
LEFT JOIN journal_entries je 
  ON je.reference_type = 'sale' 
  AND je.reference_id = s.id
LEFT JOIN journal_entry_lines jel 
  ON jel.journal_entry_id = je.id
LEFT JOIN accounts a 
  ON a.id = jel.account_id
WHERE s.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY s.id, s.amount, je.id
ORDER BY s.id;

-- Query 4: Check if post_sale_to_ledger is called (orphan sales)
SELECT 
  COUNT(*) AS total_sales,
  COUNT(je.id) AS sales_with_journal_entries,
  COUNT(*) - COUNT(je.id) AS orphan_sales_count
FROM sales s
LEFT JOIN journal_entries je 
  ON je.reference_type = 'sale' 
  AND je.reference_id = s.id
WHERE s.created_at >= CURRENT_DATE - INTERVAL '30 days';

-- Query 5: Verify stock movements exist for sales
SELECT 
  s.id AS sale_id,
  COUNT(sm.id) AS stock_movements_count,
  SUM(ABS(sm.quantity_change)) AS total_quantity_moved
FROM sales s
LEFT JOIN stock_movements sm 
  ON sm.related_sale_id = s.id
WHERE s.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY s.id
ORDER BY s.id;

-- Query 6: Check for COGS data in sale_items
SELECT 
  si.sale_id,
  COUNT(*) AS item_count,
  SUM(si.cogs) AS total_cogs_calculated,
  MAX(CASE WHEN si.cogs > 0 THEN 'Y' ELSE 'N' END) AS has_cogs_data
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
WHERE s.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY si.sale_id
ORDER BY si.sale_id;
```

---

## 3. Ledger Completeness Matrix

*Note: This matrix must be populated by executing the verification queries in Section 2 above. Each row represents a sale from the sample set (last 50 sales or representative sample).*

| Sale ID | Posted to GL? | Revenue Posted? | Tax Posted? | COGS Posted? | Inventory Asset Reduced? | Mismatch Notes |
|---------|---------------|-----------------|-------------|--------------|-------------------------|----------------|
| *[Execute Query 1-6 above to populate]* | | | | | | |

---

## 4. Identified Systemic Gaps

Based on code analysis (awaiting data verification):

### Gap 1: Missing Automatic Posting
- **Finding**: `post_sale_to_ledger` function exists but is not called by the sales creation API endpoint.
- **Impact**: Sales may be created without corresponding journal entries.
- **Evidence**: `app/api/sales/create/route.ts` (lines 1-1024) contains no call to `post_sale_to_ledger`.
- **Severity**: HIGH - Financial statements will be incomplete.

### Gap 2: Missing Inventory Asset Posting
- **Finding**: `post_sale_to_ledger` function does not create journal entries to reduce inventory asset accounts.
- **Impact**: Balance sheet will overstate inventory assets.
- **Evidence**: `supabase/migrations/100_control_account_resolution.sql` lines 550-606 show only Cash, Revenue, and Tax postings.
- **Severity**: HIGH - Balance sheet accuracy compromised.

### Gap 3: Missing COGS Expense Posting
- **Finding**: COGS is calculated and stored in `sale_items.cogs` but never posted to account code 5000.
- **Impact**: Income statement will overstate gross profit (revenue without matching expenses).
- **Evidence**: `post_sale_to_ledger` function contains no logic to post COGS to expense accounts.
- **Severity**: HIGH - P&L accuracy compromised.

### Gap 4: Orphaned Stock Movements
- **Finding**: Stock movements are created for sales but may not link to ledger entries if sales are not posted.
- **Impact**: Audit trail disconnect between operational inventory and accounting records.
- **Severity**: MEDIUM - Operational data integrity concern.

### Gap 5: Multiple Ledger Systems
- **Finding**: Both `journal_entries`/`journal_entry_lines` and `ledger_entries` tables exist in schema.
- **Impact**: Unclear which is authoritative for financial reporting.
- **Evidence**: `ledger_entries` created in migration 034, `journal_entries` in migration 043.
- **Severity**: MEDIUM - Potential confusion about authoritative ledger.

### Gap 6: Reference Type Reliability
- **Finding**: Journal entries use `reference_type = 'sale'` and `reference_id` to link to sales.
- **Impact**: Reliable linkage exists IF posting occurs.
- **Severity**: LOW - Linkage mechanism is sound if posting is executed.

---

## 5. Authority of Ledger Tables

### Primary Ledger (Authoritative)
- **`journal_entries` + `journal_entry_lines`**: This appears to be the authoritative general ledger.
  - Used by all posting functions (`post_sale_to_ledger`, `post_invoice_to_ledger`, etc.)
  - Has proper double-entry structure (debit/credit columns)
  - Has reference tracking (`reference_type`/`reference_id`)
  - Immutability enforced via triggers

### Secondary/Historical Ledger
- **`ledger_entries`**: Appears to be legacy or alternative ledger structure.
  - Created in earlier migration (034)
  - Simpler structure (no separate header/lines)
  - May be used for specific reporting or historical purposes
  - Not used by current posting functions

**Recommendation**: Use `journal_entries`/`journal_entry_lines` as the authoritative source for financial statements.

---

## 6. Conclusion

**Current State**: FINZA cannot produce correct Trial Balance and P&L for retail sales today.

**Primary Reasons**:
1. Sales posting to ledger is not automatic and may not occur for all sales.
2. Even when posted, revenue and tax are recorded but COGS and inventory reductions are missing.
3. This creates both completeness errors (missing transactions) and accuracy errors (incomplete transaction recording).

**Financial Statement Impact**:
- **Trial Balance**: Will be incomplete (missing sales if not posted) and unbalanced (inventory assets overstated).
- **P&L Statement**: Will overstate gross profit (revenue without COGS expense).
- **Balance Sheet**: Will overstate assets (inventory not reduced) and overstate equity (due to overstated profit).

**Immediate Action Required**: Execute verification queries to confirm the actual state of posted sales vs operational sales, then implement fixes for the identified gaps.

---

**Assessment Complete - Analysis Only - No Code Changes Made**
