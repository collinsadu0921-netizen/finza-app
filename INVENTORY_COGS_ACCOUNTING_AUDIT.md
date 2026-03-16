# Inventory, COGS, and Ledger Posting Audit

**Date:** 2025-01-27  
**Auditor:** Accounting Systems Review  
**Scope:** Inventory reduction, COGS, and balance sheet impact  
**Purpose:** Trace operational inventory decreases and assess accounting treatment

---

## 1. How Inventory Decreases Today

### Operational Process

When a sale is recorded in the system, inventory reduction occurs at the application layer. The process happens in `app/api/sales/create/route.ts` during sale creation. The system queries the `products_stock` table to check current inventory levels, validates sufficient stock is available, then reduces the quantity on hand by the amount sold. Stock movements are recorded in the `stock_movements` table for audit trail purposes.

For each sale item, the system calculates cost of goods sold by multiplying the product's cost price by the quantity sold. This COGS amount is stored in the `sale_items` table in the `cogs` column, capturing a snapshot of the cost price at the time of sale.

The inventory reduction is a direct update to the `products_stock` table, decreasing the `stock` or `stock_quantity` field. This happens immediately when the sale is completed and occurs regardless of whether the sale is later posted to the general ledger.

### Accounting Process

When a sale is posted to the general ledger, the system calls the `post_sale_to_ledger` function. This function creates a journal entry that debits a cash or payment account for the sale amount and credits a revenue account for the sale proceeds, net of taxes. Tax liabilities are also credited to the appropriate tax control accounts.

However, the `post_sale_to_ledger` function does not create any journal entries related to inventory or cost of goods sold. The function only handles the revenue recognition side of the transaction, posting cash receipts and revenue earned. There are no debits to inventory asset accounts and no debits to cost of goods sold expense accounts.

---

## 2. Does Inventory Reduction Affect the Balance Sheet?

**No, inventory reduction does not currently affect the balance sheet.**

The system does not maintain an inventory asset account in the general ledger. There is no standard account code for inventory in the chart of accounts setup. While inventory quantities are tracked operationally in the `products_stock` table, this tracking is separate from the accounting records.

When inventory is reduced through sales, the balance sheet asset value remains unchanged because no journal entry reduces an inventory asset account. The balance sheet shows cash increasing and revenue being recognized, but the corresponding decrease in inventory assets is not recorded.

This means the balance sheet will overstate total assets over time, as inventory is depleted but the asset value remains on the books. The operational inventory tracking and the accounting asset tracking are disconnected.

---

## 3. Is COGS Reflected in the General Ledger?

**No, COGS is not reflected in the general ledger.**

The system calculates COGS for each sale item and stores it in the `sale_items` table. The chart of accounts includes an account code 5000 labeled "Cost of Sales" which is designated as the expense account for direct costs. However, the `post_sale_to_ledger` function never posts to this account.

When sales are posted to the ledger, the journal entries only recognize revenue. There are no corresponding expense entries to debit the Cost of Sales account and credit an Inventory asset account. The COGS calculation exists in the database but is never used in any ledger posting.

This means the income statement will show revenue without the corresponding cost of goods sold expense. Gross profit will be overstated because costs are not being recognized. The expense side of the sale transaction is completely missing from the accounting records.

---

## 4. The Accounting Contradiction

The system has a fundamental disconnect between operational inventory management and accounting inventory management. Operationally, inventory is tracked, reduced, and COGS is calculated. Accounting-wise, neither the inventory asset reduction nor the COGS expense are recorded in the general ledger.

This creates multiple accounting errors. The balance sheet will show incorrect asset values because inventory reductions are not reflected. The income statement will show incorrect gross profit because COGS expenses are not recognized. Revenue is recognized but the corresponding costs are not matched, violating the matching principle of accounting.

The system stores COGS data that is never used. The `sale_items.cogs` column captures the cost calculation, and account code 5000 exists to receive COGS postings, but no function ever connects these pieces. The operational system knows the cost of goods sold, but the accounting system never records it.

From a double-entry bookkeeping perspective, sales transactions are incomplete. The revenue side is posted, but the cost side is missing. The system creates unbalanced accounting in the sense that operational reality (inventory decreased, costs incurred) is not reflected in the ledger (inventory unchanged, no costs recorded).

This is not a temporary timing difference or a design choice for cash versus accrual accounting. It is a complete omission of the cost side of inventory-based sales transactions in the general ledger posting logic.

---

**Assessment Complete - No Code Changes Made**
