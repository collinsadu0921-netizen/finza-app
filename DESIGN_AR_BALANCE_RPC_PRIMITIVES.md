# Design: AR Balance RPC Primitives for Scale

**Goal:** Add DB-side aggregation RPCs so clients stop pulling full GL and grouping in app. Keeps AR balance logic in one place and reduces payload and CPU at scale.

---

## 1. Proposed RPCs

### 1.1 `get_ar_balance_by_invoice`

**Purpose:** Return AR balance per invoice for a business/period, with optional filters.

| Aspect | Detail |
|--------|--------|
| **Inputs** | `p_business_id UUID`, `p_period_id UUID`, `p_invoice_id UUID` (optional), `p_customer_id UUID` (optional) |
| **Output** | `TABLE(invoice_id UUID, balance NUMERIC)` — one row per invoice with nonzero AR balance in that period. Balance = sum(debit − credit) for AR account, period dates, `reference_type = 'invoice'` and `reference_id = invoice_id`. |
| **Semantics** | Resolve `p_period_id` → `period_start`, `period_end` from `accounting_periods`. Restrict to AR account (lookup by business + type/code). Aggregate `journal_entry_lines` joined to `journal_entries` on that account and date range, `WHERE reference_type = 'invoice'`, grouped by `reference_id`. If `p_invoice_id` given, filter to that invoice; if `p_customer_id` given, restrict to invoices where `invoices.customer_id = p_customer_id`. |

### 1.2 `get_ar_balance_by_customer`

**Purpose:** Return AR balance per customer for a business/period, with optional filters.

| Aspect | Detail |
|--------|--------|
| **Inputs** | `p_business_id UUID`, `p_period_id UUID`, `p_customer_id UUID` (optional), `p_invoice_id UUID` (optional) |
| **Output** | `TABLE(customer_id UUID, balance NUMERIC)` — one row per customer with nonzero AR balance. Balance = sum of AR debits − credits for that customer’s invoices in the period. |
| **Semantics** | Same period and AR-account logic as above. Join `journal_entries` → `invoices` on `reference_type = 'invoice'` and `reference_id = invoices.id`, then group by `invoices.customer_id`. If `p_customer_id` given, return at most that customer; if `p_invoice_id` given, restrict to lines for that invoice (effectively “customer that owns this invoice”). |

---

## 2. Why `get_general_ledger` Is Insufficient at Scale

- **Line-volume:** GL returns every line (entry_date, journal_entry_id, reference_type, reference_id, debit, credit, running_balance). For “balance per invoice” or “per customer” the client must pull all AR lines in the date range, then filter `reference_type = 'invoice'` and group by `reference_id` (and for customer, join to invoices and group by customer_id). Row count is O(lines), not O(invoices) or O(customers).
- **No period_id:** GL takes `(p_start_date, p_end_date)`. Callers must resolve `period_id` → dates in app and pass them. That’s extra round-trips or caching and doesn’t centralize period semantics in the DB.
- **No server-side aggregation:** All grouping and summing happens in the client. For aging, reconciliation, or dashboards this multiplies transfer size and CPU by number of lines, and pushes business logic (AR = debits − credits for asset account) into every consumer.
- **Reconciliation today:** The reconciliation engine calls `get_general_ledger` for the AR account, then in JS filters rows to `reference_type === 'invoice'` and `reference_id === scope.invoiceId` and sums. One invoice still requires fetching all AR lines in the window.

A dedicated “AR balance by invoice” / “by customer” RPC returns O(invoices) or O(customers) rows and does period resolution and aggregation in the DB, so clients get pre-aggregated balances and can optionally narrow by `invoice_id` or `customer_id`.

---

## 3. Indexes

Existing indexes used by GL-style access:

- `idx_journal_entries_business_date_id` on `journal_entries(business_id, date, id)` — good for “business + date range”.
- `idx_journal_entry_lines_account_entry` on `journal_entry_lines(account_id, journal_entry_id)` — good for “AR account + entry set”.
- `idx_journal_entries_reference` on `journal_entries(reference_type, reference_id)` — supports “invoices only” and “this invoice”.

To make the new RPCs efficient:

1. **Period + AR + invoice**  
   - Resolve `p_period_id` with a single row from `accounting_periods` (PK lookup).  
   - Use `journal_entries` filtered by `business_id`, `date IN (period_start..period_end)`, and optionally `reference_type = 'invoice'` and `reference_id = p_invoice_id`.  
   - No new index strictly required if `idx_journal_entries_business_date_id` and `idx_journal_entries_reference` are used (e.g. filter entries first, then join lines).

2. **By-customer join**  
   - Join `journal_entries` → `invoices` on `reference_type = 'invoice'` and `reference_id = invoices.id`, then group by `invoices.customer_id`.  
   - **Suggested:** `CREATE INDEX idx_invoices_customer_id ON invoices(customer_id) WHERE deleted_at IS NULL` (if not already present) to speed “invoices for this customer” in the join.  
   - **Optional:** composite on `journal_entries(business_id, date, reference_type, reference_id)` to support “business + period + invoice” in one index and avoid separate reference lookup when filtering by invoice/customer.

3. **Minimal addition**  
   - If `invoices(customer_id)` is not indexed, add `idx_invoices_customer_id` as above.  
   - RPCs can be implemented using existing GL-oriented indexes plus period lookup; the optional composite on `journal_entries` is a follow-on optimization if profiling shows entry filtering as a bottleneck.

---

## 4. Summary

| RPC | Inputs | Output | Optional filters |
|-----|--------|--------|-------------------|
| `get_ar_balance_by_invoice` | business_id, period_id | (invoice_id, balance) | invoice_id, customer_id |
| `get_ar_balance_by_customer` | business_id, period_id | (customer_id, balance) | customer_id, invoice_id |

- **Inputs:** both take `p_business_id`, `p_period_id`; optional `p_invoice_id`, `p_customer_id` as per table above.
- **Indexes:** Rely on existing GL indexes; add `invoices(customer_id)` if missing; optionally add `journal_entries(business_id, date, reference_type, reference_id)` for “period + AR + invoice” access.
- **Why not GL:** GL returns all lines and has no period_id or aggregation; client-side grouping does not scale and duplicates AR logic. These RPCs shift aggregation and period semantics into the DB and return only balances.
