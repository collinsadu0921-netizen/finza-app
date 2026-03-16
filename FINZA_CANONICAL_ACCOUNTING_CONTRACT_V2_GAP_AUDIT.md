# FINZA Canonical Accounting Contract v2.0 — GAP AUDIT

**Status:** Authoritative gap audit only. No refactors, migrations, patches, or alternative designs proposed.

**Audit scope:** Database migrations, SQL functions, API routes, services, and reporting code.

**Evidence:** File names and line references only.

---

## A. COMPLIANCE MATRIX

| Contract Clause | Implementation Location | Status |
|-----------------|-------------------------|--------|
| **1.1 Ledger as single source of truth** | Reporting uses `get_trial_balance_from_snapshot`, `get_*_from_trial_balance`; GL uses `get_general_ledger` (journal_entries/lines). On-screen reports use snapshot. | PASS |
| **1.2 Append-only ledger (no UPDATE/DELETE)** | `222_ledger_immutability_enforcement.sql`: REVOKE UPDATE,DELETE on journal_entries, journal_entry_lines from anon/authenticated. Triggers in 088/156. | PARTIAL — See Violation Report: migrations that UPDATE ledger. |
| **1.3 Double entry (SUM debit = SUM credit, tolerance 0.01)** | `252_contract_v11_enforcement.sql` lines 297–298; `228_revenue_recognition_guards.sql` lines 158–159. | PASS |
| **1.4 Monetary precision (NUMERIC, no float)** | Schema: journal_entry_lines.debit/credit NUMERIC. No float usage in posting. | PASS |
| **1.5 Currency scale enforcement** | `252_contract_v11_enforcement.sql`: `get_currency_scale()`, rounding in `post_journal_entry` (lines 64–76, 282–283, 367–368). | PASS |
| **2.1 Accounting start date** | Contract requires `businesses.accounting_start_date`. | FAIL — Column not present; no grep match in codebase. |
| **2.2 Posting restriction (posting_date < accounting_start_date)** | Depends on 2.1. | FAIL — No enforcement; adoption boundary not implemented. |
| **2.3 Historical reconstruction (backfill_reason, backfill_actor)** | `252`, `228`, `229`, `220`, `226`, etc.: backfill params enforced in `post_journal_entry` and posting wrappers. | PASS |
| **3.1 Invoice revenue recognition (posting_date = COALESCE(sent_at::date, issue_date))** | `226_accrual_ar_posting_invoice_finalisation.sql` lines 74–81; `228_revenue_recognition_guards.sql` lines 334–338. Draft blocked in `228` (post_invoice_to_ledger). | PASS |
| **3.2 Payment posting (posting date = payment.date)** | `217_payment_posting_period_guard.sql` line 79: `payment_record.date`. | PASS |
| **3.3 Expense posting (posting date = expense.date)** | `229_expense_posting_schema_aligned.sql` line 210: `expense_row.date`. | PASS |
| **3.4 POS sale (posting date = sale.created_at::date)** | `189_fix_ledger_posting_authorization.sql` line 557: `sale_record.created_at::DATE`. | PASS |
| **3.5 Refund/void (posting date = processing_date)** | `191_fix_refund_payment_method_and_enforcement.sql`, `192_unify_refund_void_posting_paths.sql`: use `CURRENT_DATE` (refund processing date). No `processing_date` column referenced. | PARTIAL — Implemented as processing date; contract wording "processing_date" may imply column. |
| **4 Timezone normalization** | `252_contract_v11_enforcement.sql`: businesses.timezone (line 54–56); `post_journal_entry` normalizes p_date (lines 284–287, 309–312). | PASS |
| **5.1 Mandatory period assignment** | `252`: `post_journal_entry` sets period_id (lines 307–318, 336, 355). Backfill in 252 for existing NULL period_id. | PASS |
| **5.2 Period resolution (period_start ≤ date ≤ period_end)** | `252` lines 309–317; fail if no period. | PASS |
| **5.3 Period lock (assert_accounting_period_is_open)** | Used in: 252, 227, 233, 229, 226, 228, 217, 220, 191, 192, 198, 197, 196, 151, 225 (close checks), etc. | PASS |
| **5.4 Period overlap prohibition** | `132_accounting_periods_phase1b_integrity.sql` lines 20–41: `exclude_overlapping_periods` constraint. | PASS |
| **6.1 Account code uniqueness (active)** | 248/249/250: partial unique index `accounts_unique_business_code_active_idx` (WHERE deleted_at IS NULL). | PASS |
| **6.2 Soft delete (no physical delete if referenced)** | Application/coa flows use soft delete; no evidence of hard delete of referenced accounts. | PASS |
| **6.3 create_system_accounts idempotent, not ON CONFLICT dependent** | `251_create_system_accounts_without_conflict.sql`: WHERE NOT EXISTS, no ON CONFLICT. | PASS |
| **7.1 Entry types** | post_journal_entry and callers use system, accountant, adjustment, backfill, reversal. | PASS |
| **7.2 Revenue recognition guards** | `252` lines 248–275: revenue only for reference_type=invoice or (adjustment + is_revenue_correction). | PASS |
| **7.3 Sent timestamp immutability** | `252` lines 17–47: trigger `prevent_invoice_sent_at_change_after_posting` on invoices. | PASS |
| **8.1 Snapshot authority (TB from ledger + opening balances)** | `247_snapshot_engine_v2_stale_aware.sql`: generate_trial_balance from period_opening_balances + journal_entry_lines. | PASS |
| **8.2 Snapshot key (period_id UNIQUE)** | `169_trial_balance_canonicalization.sql` line 40; `247` ON CONFLICT (period_id). | PASS |
| **8.3 Snapshot staleness (mark stale, do not block posting)** | 247: mark_trial_balance_snapshot_stale; posting does not block on snapshot. | PASS |
| **8.4 Snapshot reconciliation (total_debits != total_credits → fail)** | `247` lines 329–334: RAISE EXCEPTION if balance_difference > 0. | PASS |
| **9.1 Trial Balance from snapshot** | On-screen: `get_trial_balance_from_snapshot`. TB CSV export: snapshot. TB PDF export: uses `get_trial_balance` (date-range). | PARTIAL — See Violation Report. |
| **9.2 P&L from TB snapshot** | On-screen and getBalanceSheetReport: `get_profit_and_loss_from_trial_balance`. P&L/BS export routes: `get_profit_and_loss` / `get_balance_sheet` (date-range). | PARTIAL — Export routes violate. |
| **9.3 Balance Sheet from TB snapshot** | On-screen: `get_balance_sheet_from_trial_balance`. Export: `get_balance_sheet` (date-range). | PARTIAL — Export routes violate. |
| **10.1 VAT single source (ledger)** | Column `vat_returns.ledger_authority` added in 252 (lines 88–91). | PARTIAL — No enforcement found that sets or requires ledger_authority for new returns. |
| **10.2 VAT returns flag** | Column exists. | PASS |
| **10.3 VAT reconciliation** | No central enforcement point audited; operational VAT vs ledger reconciliation may be in app/scripts. | PARTIAL |
| **11.1 AR reconciliation** | `get_ar_balances_by_invoice`, run_period_close_checks use ledger AR vs operational. | PASS |
| **11.2 AP reconciliation** | Period close and AP logic exist; ledger AP vs bills/supplier payments. | PASS |
| **11.3 Cash reconciliation** | Cash accounts; reconciliation flows exist. | PASS |
| **12.1 Sent/paid invoice must have non-null invoice_number** | App: send route assigns invoice_number before sent. No DB constraint enforcing NOT NULL for status IN ('sent','paid'). | PARTIAL — App only. |
| **12.2 Invoice number uniqueness** | `032`, `035`, `036`: UNIQUE index on (business_id, invoice_number). | PASS |
| **13 Backfill governance** | backfill_reason/backfill_actor required when entry_type=backfill in post_journal_entry and wrappers. | PASS |
| **14 Period close (balanced TB, VAT, AR, AP, snapshot freshness)** | run_period_close_checks: TB balance, AR match, unresolved mismatches. Uses get_trial_balance (date-range), not snapshot. | FAIL — Wrong TB source; see below. |
| **15 Reporting integrity (exports use snapshot; no operational tables)** | Export PDF/CSV for TB, P&L, BS use date-range RPCs. Contract: use canonical snapshot-based functions. | FAIL |
| **16 Security and auditability (posting_source, created_by, posted_by_accountant_id)** | post_journal_entry and all posting paths set these. | PASS |
| **17 Data migration / bootstrap** | create_system_accounts, first period, opening balances; ensure_accounting_initialized in app. | PASS |
| **18 Failure behavior** | post_journal_entry and assert_accounting_period_is_open raise on period missing/locked, imbalance, revenue rule. | PASS |
| **19 Non-negotiable invariants** | Enforced as per matrix above; gaps listed in B–E. | PARTIAL |

---

## B. VIOLATION REPORT

### B.1 Ledger UPDATE/DELETE (contract 1.2)

- **`248_deduplicate_chart_of_accounts.sql`** lines 110–114: `UPDATE journal_entry_lines jel SET account_id = c.canonical_account_id`. Modifies ledger lines (account_id reassignment). Contract prohibits UPDATE journal_entry_lines.
- **`252_contract_v11_enforcement.sql`** lines 133–136: `UPDATE journal_entries je SET period_id = p.period_id` (governance-approved backfill for NULL period_id). Contract allows only governance-approved backfill; this is documented as safe backfill.
- **`134_opening_balances_phase2c.sql`**, **`135_carry_forward_phase2d.sql`**, **`136_carry_forward_phase2d_patch_remove_offset.sql`**, **`137_adjusting_journals_phase2e.sql`**: UPDATE journal_entries (metadata/period linkage in historical migrations). Not append-only.
- **`189_fix_ledger_posting_authorization.sql`**, **`190_fix_posting_source_default_bug.sql`**: UPDATE journal_entries (posting_source/metadata). Contract 1.2 prohibits UPDATE journal_entries except governance-approved backfill/adjustment/reversal.

### B.2 Reporting: snapshot vs date-range (contract 9, 15)

- **`app/api/accounting/reports/trial-balance/export/pdf/route.ts`** line 84: calls `get_trial_balance(p_business_id, p_start_date, p_end_date)`. Contract 9.1: TB SHALL be derived from `get_trial_balance_from_snapshot()`. After migration 169, `get_trial_balance(UUID, DATE, DATE)` is renamed to `get_trial_balance_legacy`, so this RPC name may be invalid at runtime.
- **`app/api/accounting/reports/balance-sheet/export/pdf/route.ts`** line 53: calls `get_balance_sheet(p_business_id, p_as_of_date)`. Line 96: `get_profit_and_loss(p_business_id, p_start_date, p_end_date)`. Contract 9.2/9.3: P&L and BS derived ONLY from TB snapshot. After 169 these are renamed to `get_balance_sheet_legacy` and `get_profit_and_loss_legacy`.
- **`app/api/accounting/reports/balance-sheet/export/csv/route.ts`** line 67: `get_balance_sheet`; line 96: `get_profit_and_loss`. Same violation.
- **`app/api/accounting/reports/profit-and-loss/export/pdf/route.ts`** line 111: `get_profit_and_loss`. Same violation.
- **`app/api/accounting/reports/profit-and-loss/export/csv/route.ts`** line 79: `get_profit_and_loss`. Same violation.

### B.3 Period close checks (contract 14)

- **`225_period_close_checks_rpc_and_log.sql`** lines 92–96: `FROM get_trial_balance(p_business_id, v_period_start, v_period_end)`. Contract 9.1: all TB from snapshot. Migration 169 renames `get_trial_balance(UUID, DATE, DATE)` to `get_trial_balance_legacy`; no later migration recreates `get_trial_balance`. So run_period_close_checks calls a function that no longer exists → runtime failure, and violates contract (must use get_trial_balance_from_snapshot(period_id)).

### B.4 Adoption boundary (contract 2)

- **businesses table:** No column `accounting_start_date` found. Contract 2.1 requires it.
- No enforcement that posting_date < accounting_start_date only allows opening balance or backfill entries.

### B.5 Invoice number (contract 12.1)

- No DB constraint or trigger enforcing `invoice_number IS NOT NULL` when `status IN ('sent', 'paid')`. App layer (send route) assigns number before send; DB layer does not enforce.

### B.6 VAT ledger authority (contract 10)

- **vat_returns.ledger_authority** exists (252). No code path found that sets `ledger_authority = TRUE` when creating ledger-derived VAT returns; no enforcement that VAT returns are flagged as ledger-authoritative where applicable.

---

## C. RISK CLASSIFICATION

| Item | Classification | Description |
|------|----------------|----------------|
| run_period_close_checks calls get_trial_balance (nonexistent after 169) | **BLOCKING** | Period close check RPC will fail at runtime; prevents period close. |
| TB/P&L/BS export routes call get_trial_balance, get_profit_and_loss, get_balance_sheet | **BLOCKING** | After 169 these names are legacy; RPC calls may fail. Contract violation: exports must use snapshot. |
| No accounting_start_date; no adoption-boundary enforcement | **DATA CORRUPTION RISK** | Pre-adoption operational posting not blocked; can create entries before adoption boundary. |
| UPDATE journal_entry_lines in 248 (COA dedup) | **DATA CORRUPTION RISK** | One-time migration altered historical ledger lines; violates immutability. |
| UPDATE journal_entries in 134–137, 189, 190 (metadata/period) | **AUDIT RISK** | Ledger rows modified; audit trail expects append-only. |
| Invoice number not enforced at DB for sent/paid | **AUDIT RISK** | Sent/paid invoices could theoretically have null invoice_number if app bypassed. |
| VAT ledger_authority never set | **AUDIT RISK** | Cannot distinguish ledger-derived vs non-ledger VAT returns. |
| Refund posting uses CURRENT_DATE vs contract “processing_date” | **UX RISK** | If contract implies a stored processing_date column, reporting could be inconsistent. |

---

## D. MISSING ENFORCEMENT POINTS

1. **Accounting start date (2.1, 2.2)**  
   - No `businesses.accounting_start_date` column.  
   - No check in `post_journal_entry` or in any posting function that rejects operational posting when `posting_date < accounting_start_date` (and allows only opening balance / backfill).

2. **Period close — Trial Balance source (9.1, 14)**  
   - `run_period_close_checks` does not call `get_trial_balance_from_snapshot(p_period_id)` (or equivalent). It uses date-range TB; after 169 that function name no longer exists.

3. **Export reports — snapshot-only (9, 15)**  
   - Trial balance PDF, Balance Sheet PDF/CSV, P&L PDF/CSV do not use `get_trial_balance_from_snapshot`, `get_balance_sheet_from_trial_balance`, `get_profit_and_loss_from_trial_balance` with period_id. No server-side enforcement that exports use only snapshot-based RPCs.

4. **Invoice number (12.1)**  
   - No DB constraint or trigger ensuring `invoice_number IS NOT NULL` for `status IN ('sent', 'paid')`.

5. **VAT ledger authority (10.1, 10.2)**  
   - No enforcement that new ledger-derived VAT returns set `vat_returns.ledger_authority = TRUE`; no guard that VAT reporting uses only ledger when ledger_authority is required.

---

## E. UNSAFE LEGACY PATHS

1. **`get_trial_balance(p_business_id, p_start_date, p_end_date)`**  
   - Renamed to `get_trial_balance_legacy` in 169. Still referenced by:  
     - `app/api/accounting/reports/trial-balance/export/pdf/route.ts` (line 84)  
     - `225_period_close_checks_rpc_and_log.sql` (line 92)  
   - Bypasses snapshot; contract requires snapshot-only TB.

2. **`get_profit_and_loss(p_business_id, p_start_date, p_end_date)`**  
   - Renamed to `get_profit_and_loss_legacy` in 169. Referenced by:  
     - `app/api/accounting/reports/profit-and-loss/export/pdf/route.ts` (line 111)  
     - `app/api/accounting/reports/profit-and-loss/export/csv/route.ts` (line 79)  
     - `app/api/accounting/reports/balance-sheet/export/pdf/route.ts` (line 96)  
     - `app/api/accounting/reports/balance-sheet/export/csv/route.ts` (line 96)  
   - Bypasses snapshot; contract requires P&L from TB snapshot.

3. **`get_balance_sheet(p_business_id, p_as_of_date)`**  
   - Renamed to `get_balance_sheet_legacy` in 169. Referenced by:  
     - `app/api/accounting/reports/balance-sheet/export/pdf/route.ts` (line 53)  
     - `app/api/accounting/reports/balance-sheet/export/csv/route.ts` (line 67)  
   - Bypasses snapshot; contract requires BS from TB snapshot.

4. **`run_period_close_checks`**  
   - Uses date-range TB (get_trial_balance) instead of snapshot; also calls a function name that no longer exists after 169. Bypasses snapshot contract and is broken at runtime.

5. **General ledger**  
   - `get_general_ledger` / `get_general_ledger_paginated` read journal_entries + journal_entry_lines only (ledger). Contract 15 forbids reading operational tables for exports; GL is ledger-only, so not in violation. No snapshot required for GL by contract.

---

## F. POSTING FLOW TRACE AND CONTRACT COMPLIANCE

### Invoice posting

- **Trigger:** `trigger_auto_post_invoice` (043, 948–953) AFTER INSERT OR UPDATE OF status ON invoices. Fires when status becomes sent (or similar); checks no existing JE for invoice then calls `post_invoice_to_ledger(NEW.id)`.
- **Canonical path:** `post_invoice_to_ledger` → `226_accrual_ar_posting_invoice_finalisation.sql` (and 228 for draft guard).  
  - Posting date: `COALESCE((invoice_record.sent_at AT TIME ZONE 'UTC')::DATE, invoice_record.issue_date)` (226 lines 74–81). **Contract 3.1:** PASS.  
  - Draft: `post_invoice_to_ledger` in 228 raises for draft; draft does not post. **Contract 3.1:** PASS.  
  - Period: `assert_accounting_period_is_open(business_id_val, posting_date)` (226 line 109). **Contract 5.3:** PASS.  
  - Revenue: reference_type=invoice, issued invoice only. **Contract 7.2:** PASS.  
  - Final JE via `post_journal_entry` (252): period_id set, rounding, double-entry check. **Contract 1.3, 1.5, 5.1:** PASS.

### Payment posting

- **Trigger:** `trigger_post_payment` (043, 218) AFTER INSERT ON payments; later 227 draft-invoice guard. Calls `post_payment_to_ledger(NEW.id)` → `post_invoice_payment_to_ledger` (227).
- **Canonical path:** `post_invoice_payment_to_ledger` / `post_payment_to_ledger` (217, 227).  
  - Posting date: `payment_record.date` (217 line 79). **Contract 3.2:** PASS.  
  - Period: `assert_accounting_period_is_open(business_id_val, payment_record.date)` (217 line 44). **Contract 5.3:** PASS.  
  - No revenue lines; Dr Cash/Bank, Cr AR. **Contract 7.2:** PASS.  
  - `post_journal_entry` (252): period_id, rounding, balance. **Contract:** PASS.

### Expense posting

- **Trigger:** `trigger_post_expense` (043, 1081–1096) AFTER INSERT on expenses; calls `post_expense_to_ledger(NEW.id)`.
- **Canonical path:** `post_expense_to_ledger` (229_expense_posting_schema_aligned.sql).  
  - Posting date: `expense_row.date` (229 line 210). **Contract 3.3:** PASS.  
  - Period: `assert_accounting_period_is_open(business_id_val, expense_row.date)` (229 line 121). **Contract 5.3:** PASS.  
  - `post_journal_entry`: period_id, rounding, balance. **Contract:** PASS.

### POS sale posting

- **Invocation:** Trigger or explicit call after sale insert; `post_sale_to_ledger(p_sale_id)` (189, 227, etc.).
- **Canonical path:** `post_sale_to_ledger` (189_fix_ledger_posting_authorization.sql).  
  - Posting date: `sale_record.created_at::DATE` (189 line 557). **Contract 3.4:** PASS.  
  - Period: `assert_accounting_period_is_open(business_id_val, sale_record.created_at::DATE)` (189 line 417). **Contract 5.3:** PASS.  
  - Revenue: POS posts revenue via invoice or sale reference; controls in post_journal_entry. **Contract 7.2:** PASS.  
  - `post_journal_entry`: period_id, rounding. **Contract:** PASS.

### Refund posting

- **Invocation:** `post_sale_refund_to_ledger(p_sale_id)` (191, 192).
- **Canonical path:** 192_unify_refund_void_posting_paths.sql.  
  - Posting date: `CURRENT_DATE` (192 line 334) documented as refund processing date. **Contract 3.5:** PARTIAL — “processing_date” satisfied by processing-time date; no column `processing_date` used.  
  - Period: `assert_accounting_period_is_open(business_id_val, CURRENT_DATE)` (191 line 101, 192 line 127). **Contract 5.3:** PASS.  
  - Reversal entry; no revenue. **Contract:** PASS.

**Summary:** Invoice, payment, expense, POS, and refund posting flows use correct posting dates, period checks, and `post_journal_entry` (period_id, rounding, double-entry). Gaps are adoption boundary (no check), and refund uses CURRENT_DATE rather than a stored processing_date column.

---

**End of gap audit. No refactors, migrations, patches, or alternative designs proposed.**
