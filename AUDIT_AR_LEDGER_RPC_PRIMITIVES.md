# Audit: SQL/RPC Primitives Reusable for AR Balance from Ledger

**READ-ONLY AUDIT — NO FIXES. EVIDENCE ONLY.**

---

## 1. RPCs/Functions That Return journal_entry_lines (or Line-Level Data)

| Function | Input parameters | Returns | period_id filtering | reference_type / reference_id filtering |
|----------|------------------|---------|---------------------|----------------------------------------|
| **get_general_ledger** | p_business_id UUID, p_account_id UUID, p_start_date DATE, p_end_date DATE | TABLE(entry_date, journal_entry_id, journal_entry_description, **reference_type**, **reference_id**, line_id, line_description, debit, credit, running_balance) | **No.** Uses p_start_date / p_end_date only. Caller must pass period's period_start/period_end to emulate period. | **No filter params.** Rows include reference_type and reference_id; caller can filter/group in app (e.g. WHERE reference_type = 'invoice' GROUP BY reference_id). |
| **get_general_ledger_paginated** | p_business_id UUID, p_account_id UUID, p_start_date DATE, p_end_date DATE, p_limit INTEGER, p_cursor_entry_date DATE, p_cursor_journal_entry_id UUID, p_cursor_line_id UUID | Same TABLE as get_general_ledger | **No.** Same date-range only. | **No filter params.** Same as above; reference_type/reference_id are in the result. |

**Source:** `supabase/migrations/140_phase3_1_report_function_optimization.sql` (get_general_ledger L91–213, get_general_ledger_paginated L228–377).

---

## 2. RPCs/Functions That Return AR Balances (Aggregate, Not by Invoice/Customer)

| Function | Input parameters | Returns | period_id filtering | reference_type / reference_id filtering |
|----------|------------------|---------|---------------------|----------------------------------------|
| **get_trial_balance_from_snapshot** | p_period_id UUID | TABLE(account_id, account_code, account_name, account_type, opening_balance, debit_total, credit_total, closing_balance) — one row **per account** | **Yes.** p_period_id only. | **N/A.** Snapshot is by account. No reference_type/reference_id; no grouping by invoice or customer. |
| **get_trial_balance** (legacy) | p_business_id UUID, p_start_date DATE, p_end_date DATE | TABLE(account_id, account_code, account_name, account_type, debit_total, credit_total, ending_balance) — one row **per account** | **No.** Date range only. | **N/A.** Same: by account only. |
| **calculate_period_closing_balance_from_ledger** | p_business_id UUID, p_account_id UUID, p_period_id UUID | **NUMERIC** — single closing balance for that account in that period | **Yes.** p_period_id. | **N/A.** Single balance for one account; no reference breakdown. |

**Sources:**  
- get_trial_balance_from_snapshot: `supabase/migrations/169_trial_balance_canonicalization.sql` L216–262.  
- get_trial_balance: `supabase/migrations/140_phase3_1_report_function_optimization.sql` L22–82 (may be renamed to get_trial_balance_legacy by 169).  
- calculate_period_closing_balance_from_ledger: `supabase/migrations/168_opening_balances_rollforward_invariants.sql` L35–102.

---

## 3. RPCs/Functions That Return Balances Grouped by invoice_id

**None.** No existing RPC or SQL function returns rows of the form (invoice_id, balance) or (reference_id, balance) for AR.

The aging report (`app/api/reports/aging/route.ts`) does **not** call an RPC. It uses a direct Supabase query to `journal_entry_lines` joined to `journal_entries`, filtered by account_id = AR, `journal_entries.reference_type = 'invoice'`, then **groups by reference_id in application code** (invoiceBalances Map). So “AR balance by invoice” exists only as app-level logic, not as a reusable SQL/RPC primitive.

---

## 4. RPCs/Functions That Return Balances Grouped by customer_id

**None.** No existing RPC or SQL function returns rows of the form (customer_id, balance) or similar.

Customer-level AR would require either (a) grouping AR lines by invoice then joining invoices to get customer_id, or (b) an RPC that does that join/group in the DB. Neither exists today.

---

## 5. Usable AS-IS for Reconciliation

| Primitive | Use case | Notes |
|-----------|----------|--------|
| **get_general_ledger** (with p_account_id = AR account) | Per-invoice AR balance for reconciliation | Caller must: (1) resolve period_id → period_start/period_end and pass as p_start_date/p_end_date; (2) filter returned rows to reference_type = 'invoice'; (3) group by reference_id and sum (debit − credit) for asset/AR. So **usable AS-IS** only in the sense “data is there”; **no period_id** and **no reference filter** in the RPC. |
| **get_general_ledger_paginated** | Same as above, when pagination is needed | Same as get_general_ledger: usable if caller does period→date and grouping. |
| **get_trial_balance_from_snapshot** | Total AR balance for a period (one number) | **Usable AS-IS** for “period-level AR total” reconciliation. Caller selects the row where account_id/code = AR and uses closing_balance (or equivalent). Has period_id. Does not give per-invoice or per-customer. |
| **calculate_period_closing_balance_from_ledger** | Total AR closing balance for a period | **Usable AS-IS** for “period-level AR total” when given (business_id, AR account_id, period_id). Has period_id. Single numeric; no invoice/customer breakdown. |

---

## 6. Missing Required Filters / Primitives

| Gap | Detail |
|-----|--------|
| **No period_id on get_general_ledger / get_general_ledger_paginated** | Reconciliation is defined per period. These RPCs only take date range. Caller must look up accounting_periods and pass period_start/period_end. So “support filtering by period_id” is **missing** in the RPC signature. |
| **No reference_type / reference_id filter in get_general_ledger** | RPC returns all lines for the account. To get “AR for invoices only,” caller must filter rows where reference_type = 'invoice'. Acceptable for reuse but **no server-side filter** by reference_type or reference_id. |
| **No RPC returning (invoice_id, balance)** | Per-invoice reconciliation needs “for each invoice, ledger AR balance.” Today that requires calling get_general_ledger (or querying journal_entry_lines) and grouping by reference_id in the client. **Missing:** a primitive that returns (invoice_id, ledger_balance) or (reference_id, balance) for reference_type = 'invoice'. |
| **No RPC returning (customer_id, balance)** | Per-customer reconciliation needs “for each customer, sum of AR balance for their invoices.” No RPC or function does this. **Missing** entirely. |
| **No RPC returning raw AR lines filtered by reference_type = 'invoice'** | get_general_ledger returns lines for one account; reference_type/reference_id are in the result. So “AR lines for invoices only” is **not** missing in terms of data—it’s just **no server-side filter**. Usable with client-side filter. |

---

## 7. Summary Table

| Function | Returns journal_entry_lines? | Returns AR balances? | Balances by invoice_id? | Balances by customer_id? | period_id supported? | reference_type/reference_id in params? | Usable AS-IS for reconciliation? |
|----------|------------------------------|----------------------|--------------------------|---------------------------|-----------------------|----------------------------------------|-----------------------------------|
| get_general_ledger | Yes (for one account) | Implicit (client sums) | No (client must group by reference_id) | No | No (date range only) | No (in result only) | Partially: yes for “lines for AR account”; caller must do period→date, filter reference_type, group by reference_id. |
| get_general_ledger_paginated | Yes | Implicit | No | No | No | No | Same as get_general_ledger. |
| get_trial_balance_from_snapshot | No | Yes (per account) | No | No | Yes | N/A | Yes for **total AR** for a period. Not for per-invoice/per-customer. |
| get_trial_balance (legacy) | No | Yes (per account) | No | No | No | N/A | Yes for total AR by date range only; no period_id. |
| calculate_period_closing_balance_from_ledger | No | Yes (single number) | No | No | Yes | N/A | Yes for **total AR closing balance** for (business, AR account, period). |

**Explicit statement:**

- **Usable AS-IS** for reconciliation **total AR for a period:** `get_trial_balance_from_snapshot(p_period_id)` (take AR account row) and `calculate_period_closing_balance_from_ledger(p_business_id, ar_account_id, p_period_id)`.
- **Usable with client-side work** for per-invoice AR: `get_general_ledger(p_business_id, ar_account_id, period_start, period_end)` then filter reference_type = 'invoice' and group by reference_id. **Missing in RPC:** period_id as input; optional reference_type/reference_id filter.
- **Not available AS-IS:** any RPC that returns (invoice_id, balance) or (customer_id, balance). Both are **missing**; aging and any ledger-based customer/invoice balance today require app-side grouping or a new primitive.
