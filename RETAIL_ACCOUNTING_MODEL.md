# Minimum Correct Accounting Model: Retail Sales with Inventory

**Date:** 2025-01-28  
**Architect:** Accounting Systems Design  
**Scope:** Canonical accounting event definition and data model authority  
**Purpose:** Establish the minimum correct double-entry bookkeeping model for retail inventory sales

---

## 1. Canonical Accounting Event Definition

A retail sale with inventory is a single atomic accounting event that occurs when:
- A customer receives goods (inventory items)
- Payment is received (cash or payment method)
- Legal title to inventory transfers from business to customer

This event triggers one journal entry with exactly five mandatory ledger movements.

---

## 2. Mandatory Ledger Movements

Every retail sale with inventory MUST create the following five journal entry lines:

| Movement | Account Type | Debit/Credit | Purpose |
|----------|--------------|--------------|---------|
| 1 | Cash/Bank (Asset) | DEBIT | Records receipt of payment |
| 2 | Revenue (Income) | CREDIT | Recognizes income earned |
| 3 | Tax Payable (Liability) | CREDIT | Records tax obligation (if applicable) |
| 4 | Cost of Goods Sold (Expense) | DEBIT | Recognizes expense of goods sold |
| 5 | Inventory (Asset) | CREDIT | Reduces inventory asset value |

**Accounting Equation Verification:**
- DEBIT side: Cash + COGS
- CREDIT side: Revenue + Tax Payable + Inventory Reduction
- Equation must balance: Total Debits = Total Credits

**Missing any of these five movements makes the accounting record incorrect and prevents accurate financial statements.**

---

## 3. Table Authority Classification

### Authoritative Tables (Financial Truth)

These tables contain the official accounting records and are the sole source of truth for financial reporting:

1. **`journal_entries`**: Journal entry headers (date, description, reference links)
2. **`journal_entry_lines`**: Individual debit/credit movements (account_id, debit, credit)
3. **`accounts`**: Chart of accounts (account codes, names, types)

**Rule:** Financial statements are generated exclusively from these tables. No other tables contribute to Trial Balance, P&L, or Balance Sheet calculations.

### Supporting Tables (Operational Evidence)

These tables contain operational data that supports business operations but are NOT part of the accounting record:

1. **`sales`**: Operational sale records (amounts, dates, customer references)
2. **`sale_items`**: Line items for each sale (product, quantity, price)
3. **`products_stock`**: Current inventory quantities (operational tracking)
4. **`stock_movements`**: Inventory movement history (audit trail)
5. **`products`**: Product master data (names, prices, cost prices)

**Rule:** These tables inform the accounting record but are not the accounting record. They cannot be used to generate financial statements.

---

## 4. Operational Data Classification

### Stock Movements

**Classification:** Operational evidence, not accounting events.

Stock movements record the physical movement of inventory quantities. They provide audit trail and operational visibility but are not accounting transactions. A stock movement does not create a journal entry. Stock movements support the creation of accounting entries by providing evidence of what was sold.

**Authority:** Stock movements are supporting data only. They cannot be used to calculate inventory asset values or COGS for financial statements.

### Sale Items COGS

**Classification:** Helper value, not accounting truth.

The `sale_items.cogs` column stores a calculated value (cost_price × quantity) for operational purposes. This value is computed data that helps determine what to post to the ledger, but it is not an accounting record.

**Authority:** COGS only becomes accounting truth when posted as a DEBIT to a Cost of Goods Sold expense account in `journal_entry_lines`. The value in `sale_items.cogs` is reference data only and must not be used directly in financial statement calculations.

---

## 5. Authoritative Ledger Structure

**Single Authoritative Structure:** `journal_entries` + `journal_entry_lines`

This is the ONLY ledger structure that must be used for all accounting transactions going forward. This structure:

1. Enforces proper double-entry bookkeeping (debit/credit balance validation)
2. Maintains immutable accounting records (no UPDATE/DELETE via triggers)
3. Provides proper reference tracking (`reference_type`, `reference_id`)
4. Supports complete financial statement generation (Trial Balance, P&L, Balance Sheet)

**Secondary/Legacy Structure:** `ledger_entries` table is not authoritative and must not be used for new accounting transactions. It may exist for historical or reporting purposes but is not part of the minimum correct accounting model.

**Rule:** All posting functions (`post_sale_to_ledger`, `post_invoice_to_ledger`, etc.) MUST write exclusively to `journal_entries` and `journal_entry_lines`. No posting functions write to `ledger_entries`.

---

## 6. Accounting Event Completeness Rules

For a retail sale to be correctly accounted:

1. **One journal entry exists** with `reference_type = 'sale'` and `reference_id = sale.id`
2. **Five journal entry lines exist** with the accounts specified in Section 2
3. **Debits equal credits** for the journal entry
4. **All amounts reconcile** between operational tables (`sales`, `sale_items`) and accounting tables (`journal_entry_lines`)

**Incomplete accounting:** Any sale that violates these rules produces incorrect financial statements and must be corrected before reporting.

---

## 7. Financial Statement Generation Rules

**Trial Balance:**
- Generated exclusively from `journal_entry_lines` grouped by `account_id`
- Sums all debits and credits per account
- Does not reference `sales`, `sale_items`, or `products_stock`

**Profit & Loss Statement:**
- Revenue: Sum of credits to revenue accounts from `journal_entry_lines`
- COGS: Sum of debits to COGS expense accounts from `journal_entry_lines`
- Gross Profit: Revenue minus COGS (both from ledger, not operational tables)

**Balance Sheet:**
- Inventory Asset: Sum of debits minus credits to inventory asset accounts from `journal_entry_lines`
- Does not use `products_stock` quantities or values
- Cash/Bank: Sum of debits minus credits to cash/bank asset accounts from `journal_entry_lines`

**Rule:** Financial statements are ledger-only. Operational tables provide context but are never the source of financial figures.

---

**Model Definition Complete - No Implementation Details Provided**
