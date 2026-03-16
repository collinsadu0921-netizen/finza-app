# Audit: Supplier Bill and Payment Posting Chain

**Goal:** Identify why supplier payments or supplier invoices may create balance sheet inconsistencies.

**Scope:** Audit only. No posting logic, ledger, or migrations changed.

**Date:** 2025-02-04

---

## 1. Supplier Invoice Posting Path (Bills)

### 1.1 API and trigger

| Step | Location | Detail |
|------|----------|--------|
| API | `app/api/bills/` (create flow: bill created then status set to `open`) | Bills created as draft or open; posting is trigger-driven on status. |
| Trigger | `supabase/migrations/043_accounting_core.sql` | `trigger_auto_post_bill` fires **AFTER INSERT OR UPDATE OF status** on `bills` when `NEW.status = 'open'`. |
| Handler | `trigger_post_bill()` (043) | Calls `post_bill_to_ledger(NEW.id)`. |

### 1.2 Posting function and journal entry

| Item | Location | Detail |
|------|----------|--------|
| Function | `post_bill_to_ledger(p_bill_id)` | `supabase/migrations/190_fix_posting_source_default_bug.sql` (canonical). |
| Period guard | Same file | `assert_accounting_period_is_open(business_id_val, bill_record.issue_date)` before building lines. |
| AP account | Same file | `get_control_account_code(business_id_val, 'AP')` → `get_account_by_control_key(business_id_val, 'AP')`. |
| Expense account | Same file | `get_account_by_code(business_id_val, '5200')` (Supplier Bills). |

**Journal entry (confirmed):**

- **Dr** Expense (5200) and tax accounts (from `tax_lines`)
- **Cr** Accounts Payable (control account for `'AP'`)

**Reference and metadata:**

| Field | Value |
|-------|--------|
| `reference_type` | `'bill'` |
| `reference_id` | `p_bill_id` |
| `business_id` | From `bills.business_id` |
| `period_id` | Set inside `post_journal_entry` from `accounting_periods` by `bill_record.issue_date` |
| `posting_source` | `'system'` (passed explicitly to `post_journal_entry`) |

**Conclusion (Step 1):** Supplier invoices (bills) post **Dr Expense / tax, Cr AP**; reference and period are set correctly; period is asserted in both `post_bill_to_ledger` and `post_journal_entry`.

---

## 2. Supplier Payment Posting Paths

There are **two** distinct payment flows: bill payments (against `bills`) and supplier payments (against `supplier_invoices`).

### 2.1 Bill payments (bills → bill_payments)

| Step | Location | Detail |
|------|----------|--------|
| API | `app/api/bills/[id]/payments/route.ts` | POST inserts into `bill_payments`. |
| Trigger | `supabase/migrations/043_accounting_core.sql` | `trigger_auto_post_bill_payment` **AFTER INSERT** on `bill_payments`. |
| Function | `post_bill_payment_to_ledger(p_bill_payment_id)` | `supabase/migrations/190_fix_posting_source_default_bug.sql`. |

**Journal entry (confirmed):**

- **Dr** Accounts Payable (via `get_control_account_code('AP')` / `get_account_by_control_key('AP')`)
- **Cr** Cash / Bank / MoMo (1000 / 1010 / 1020) per `payment_record.method`

**Reference and metadata:**

| Field | Value |
|-------|--------|
| `reference_type` | `'bill_payment'` |
| `reference_id` | `p_bill_payment_id` |
| `business_id` | From `bill_payments.business_id` |
| `period_id` | Set inside `post_journal_entry` by `payment_record.date` |
| `posting_source` | `'system'` |

**Period:** `post_bill_payment_to_ledger` does **not** call `assert_accounting_period_is_open` itself. Period integrity is enforced inside `post_journal_entry` (migration 253), which looks up the period for the payment date and calls `assert_accounting_period_is_open(p_business_id, v_normalized_date)` before insert. So bill payments cannot be posted into a closed period.

**Allocation / partial payments:**

- Bill status is updated elsewhere (e.g. when total paid ≥ bill total); allocation is operational (bills + bill_payments), not re-computed from ledger in this path.

**Vendor balance (supplier statement):**

- `app/api/suppliers/statement/[name]/route.ts` uses **bills** and **bill_payments** only (operational tables). Outstanding = totalBilled − totalPaid. It does **not** use the ledger AP balance. Any divergence between ledger AP and bills/bill_payments will show as inconsistency between statement “outstanding” and balance sheet AP.

### 2.2 Supplier payments (supplier_invoices → supplier_payments)

| Step | Location | Detail |
|------|----------|--------|
| API | `app/api/supplier-payments/route.ts` | POST inserts into `supplier_payments`, then calls RPC `post_supplier_payment_to_ledger`. |
| Function | `post_supplier_payment_to_ledger(p_supplier_payment_id)` | `supabase/migrations/198_supplier_management_purchase_orders_phase3.sql`. |

**Journal entry (confirmed):**

- **Dr** Accounts Payable
- **Cr** Payment account (Cash/Bank/Clearing from `resolve_payment_account_from_method`)

**AP account (mismatch — see Section 3):** AP is resolved as **`get_account_by_code(business_id_val, '2000')`** (hardcoded), **not** `get_control_account_code('AP')`.

**Reference and metadata:**

| Field | Value |
|-------|--------|
| `reference_type` | `'supplier_payment'` |
| `reference_id` | `p_supplier_payment_id` |
| `business_id` | From `supplier_payments.business_id` |
| `period_id` | Set inside `post_journal_entry` by `payment_record.payment_date` |
| `posting_source` | `'system'` |

**Period:** `post_supplier_payment_to_ledger` **does** call `assert_accounting_period_is_open(business_id_val, payment_record.payment_date)` before posting.

**Allocation:** After posting, if `supplier_invoice_id` is set, the function checks sum of `supplier_payments.amount` for that invoice and, if ≥ invoice total, sets `supplier_invoices.status = 'paid'`. Partial payments are supported by that sum.

**Conclusion (Step 2):** Both flows post **Dr AP, Cr Cash/Bank**. Bill payments use the AP control mapping; supplier payments use hardcoded `2000`, which can diverge from the control account (see Section 3).

---

## 3. AP Control Account Mapping

| Source | Detail |
|--------|--------|
| Control mapping | `get_control_account_code(business_id, 'AP')` reads `chart_of_accounts_control_map` (migration 098). |
| Default bootstrap | Migrations 176, 187, 244: `('AP', '2000')` inserted into `chart_of_accounts_control_map`. |
| Bills | Use `get_control_account_code` / `get_account_by_control_key('AP')` → always the mapped AP account. |
| Bill payments | Same → always the mapped AP account. |
| Supplier payments | Use **`get_account_by_code(business_id_val, '2000')`** → always account code `2000`. |

**Verification:**

- Supplier **invoices** (bills): always **credit** the AP control account (resolved via `'AP'`). ✅  
- Bill **payments**: always **debit** the AP control account (resolved via `'AP'`). ✅  
- Supplier **payments** (supplier_payments): always **debit** account code **2000** only. ✅ for default COA; ❌ if AP is remapped.

**Mismatch:** If a business has `'AP'` mapped to an account code other than `'2000'` in `chart_of_accounts_control_map`, then:

- Bills and bill payments post to the **mapped** AP account.
- Supplier payments (198) post to **2000** only.

Result: AP balance is split across two accounts; balance sheet “AP” (from trial balance, which includes all accounts) would show the sum, but any report or constraint that assumes “AP = one account” would be wrong, and reconciliation by account would show two AP accounts. **Root cause of potential balance sheet inconsistency:** two different AP targets for the same economic flow.

---

## 4. Balance Sheet Snapshot Aggregation

| Step | Location | Detail |
|------|----------|--------|
| Report API | `lib/accounting/reports/getBalanceSheetReport.ts` | Resolves period via `resolveAccountingPeriodForReport()`, then calls `get_balance_sheet_from_trial_balance(p_period_id)`. |
| RPC | `get_balance_sheet_from_trial_balance(p_period_id)` | `supabase/migrations/169_trial_balance_canonicalization.sql`: reads from `get_trial_balance_from_snapshot(p_period_id)`, filters `account_type IN ('asset', 'liability', 'equity')`. |
| Snapshot source | `get_trial_balance_from_snapshot` | Reads `trial_balance_snapshots` for that period; if missing, calls `generate_trial_balance(p_period_id, NULL)` which writes the snapshot from the ledger. |
| Ledger source | `generate_trial_balance` (169) | Sums `journal_entry_lines` joined to `journal_entries` where `je.date` in period and `je.business_id` matches; uses `accounts` for account list and types. |

**Confirmation:**

- AP account(s) are liability accounts; they are included in the trial balance and thus in `get_balance_sheet_from_trial_balance`. ✅  
- VAT (and other tax) liability accounts (e.g. 2100, 2110, 2120, 2130, 2200) are liabilities and included. ✅  
- Balance sheet uses **canonical** ledger path: trial balance snapshot ← `generate_trial_balance` ← `journal_entries` + `journal_entry_lines`. ✅  

**Snapshot aggregation mapping (high level):**

- **Assets:** `account_type = 'asset'` → current_assets (e.g. 1000–1599), fixed_assets (e.g. 1600–1999) per `groupKeyFromAccount` in `getBalanceSheetReport.ts`.  
- **Liabilities:** `account_type = 'liability'` → current_liabilities (e.g. 2000–2499), long_term_liabilities otherwise. AP (2000) and VAT etc. fall in current_liabilities.  
- **Equity:** `account_type = 'equity'` → equity group.  
- **Telemetry:** `source: "trial_balance"` in response.

---

## 5. Period Integrity

| Flow | period_id | JE date in period | Snapshot rollup |
|------|-----------|-------------------|------------------|
| Bill (supplier invoice) | Set in `post_journal_entry` from `bill_record.issue_date` | Yes (period lookup by date) | `generate_trial_balance` includes all JEs with `je.date` in period; snapshot includes them. ✅ |
| Bill payment | Set in `post_journal_entry` from `payment_record.date` | Yes | Same. ✅ |
| Supplier payment | Set in `post_journal_entry` from `payment_record.payment_date` | Yes | Same. ✅ |

- **Bill:** `post_bill_to_ledger` calls `assert_accounting_period_is_open(business_id_val, bill_record.issue_date)`; `post_journal_entry` also asserts period and sets `period_id`. ✅  
- **Bill payment:** No direct period assert in `post_bill_payment_to_ledger`; `post_journal_entry` does the period lookup and `assert_accounting_period_is_open`. ✅  
- **Supplier payment:** `post_supplier_payment_to_ledger` calls `assert_accounting_period_is_open`; `post_journal_entry` again enforces period and `period_id`. ✅  

So all three flows have `period_id` set and JE date within period boundaries, and snapshot rollups include them.

---

## 6. Summary: Mismatches and Missing References

### 6.1 AP account mismatch (critical for consistency)

- **Where:** `post_supplier_payment_to_ledger` (migration 198).  
- **What:** Uses hardcoded `get_account_by_code(business_id_val, '2000')` for the AP debit instead of `get_control_account_code(business_id_val, 'AP')` / `get_account_by_control_key(business_id_val, 'AP')`.  
- **Impact:** If `'AP'` is mapped to any account code other than `'2000'`, supplier payments post to 2000 while bills and bill payments post to the mapped AP account. AP is then split across two accounts; balance sheet total liabilities still include both, but “AP” is no longer a single control account and reconciliation/expectations can be wrong.

### 6.2 Vendor balance not ledger-derived

- **Where:** Supplier statement `app/api/suppliers/statement/[name]/route.ts`.  
- **What:** Outstanding balance = sum of (bills) − sum of (bill_payments) from operational tables only. It does not use ledger AP balance.  
- **Impact:** If ledger and operational data diverge (e.g. manual adjustment, backfill, or bug), statement “outstanding” can disagree with balance sheet AP. No missing reference in the posting chain itself, but a source of perceived inconsistency.

### 6.3 No other missing references

- Bill JE: `reference_type = 'bill'`, `reference_id = bill_id`. ✅  
- Bill payment JE: `reference_type = 'bill_payment'`, `reference_id = bill_payment_id`. ✅  
- Supplier payment JE: `reference_type = 'supplier_payment'`, `reference_id = supplier_payment_id`. ✅  
- All use `business_id` and `post_journal_entry` sets `period_id` and enforces open period.

---

## 7. Output Checklist (Requested)

| # | Item | Status |
|---|------|--------|
| 1 | Full supplier invoice posting path | Section 1: API/trigger → `post_bill_to_ledger` → `post_journal_entry`; Dr Expense/tax, Cr AP; reference_type `bill`, reference_id bill id; period asserted; posting_source `system`. |
| 2 | Full supplier payment posting paths | Section 2: (1) Bill payments: API → trigger → `post_bill_payment_to_ledger` → `post_journal_entry`; (2) Supplier payments: API → `post_supplier_payment_to_ledger` → `post_journal_entry`; both Dr AP, Cr Cash/Bank; allocation/partial logic described. |
| 3 | AP control account mapping confirmation | Section 3: Bills and bill payments use control `'AP'`; supplier payments use hardcoded `2000`; mismatch if AP ≠ 2000. |
| 4 | Snapshot aggregation mapping list | Section 4: getBalanceSheetReport → get_balance_sheet_from_trial_balance → get_trial_balance_from_snapshot → trial_balance_snapshots / generate_trial_balance; asset/liability/equity; AP and VAT in current_liabilities. |
| 5 | Mismatches or missing references | Section 6: (1) AP mismatch in supplier payment (2000 vs control); (2) Vendor balance from operational tables only; (3) No other missing references. |

---

**End of audit.** No code or schema was modified.
