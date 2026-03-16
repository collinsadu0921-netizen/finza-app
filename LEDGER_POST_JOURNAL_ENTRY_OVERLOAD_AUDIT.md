# FINZA — Ledger Function Overload Audit
## post_journal_entry "is not unique"
## READ-ONLY AUDIT — NO CHANGES

---

## 1. List of all overload signatures (as defined in migrations)

**Run this in the database to see what actually exists:**

```sql
SELECT
  p.oid,
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.pronargs AS param_count,
  pg_catalog.format_type(p.prorettype, NULL) AS return_type,
  n.nspname AS schema_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_journal_entry'
ORDER BY p.pronargs DESC, p.oid;
```

**To get full definition per overload:**

```sql
SELECT
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.pronargs,
  pg_get_functiondef(p.oid) AS full_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_journal_entry';
```

**Signatures that have appeared (from migration history):**

| Param count | Argument types (in order) | Source migration(s) |
|-------------|---------------------------|----------------------|
| 6  | UUID, DATE, TEXT, TEXT, UUID, JSONB | 043, 050, 165, 166 |
| 10 | UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID | 171, 188 wrapper, 189 wrapper, 190 wrapper |
| 13 | UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT | (dropped by 188, 189, 179) |
| 14 | UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID | 179, 184, 188, 189, 190, 228 wrapper |
| 15 | UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT | 189, 190 (posting_source added) |
| 16 | UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN | 228, 252, 253, 292, 324 (before 324 DROP) |
| 17 | … same as 16 …, BOOLEAN, UUID | 324 (p_reverses_entry_id added) |

**Return type:** UUID (all overloads).

**Schema:** public (all).

---

## 2. Migration timeline introducing overloads

| Order | Migration | Action | Signature introduced / dropped |
|-------|-----------|--------|-------------------------------|
| 043 | 043_accounting_core.sql | CREATE | 6-param (no defaults) |
| 050 | 050_fix_account_id_null.sql | REPLACE | 6-param (same) |
| 165 | 165_period_locking_posting_guards.sql | REPLACE | 6-param + period guard |
| 166 | 166_controlled_adjustments_soft_closed.sql | DROP 6-param; CREATE | New 6-param (adjustment logic) |
| 171 | 171_phase12_backfill_legacy_data.sql | DROP 10-param; CREATE | 10-param (backfill params) |
| 172 | 172_phase12b_backfill_completion_compatibility.sql | DROP 10-param | — |
| 179 | 179_retail_system_accountant_posting.sql | DROP 14,13,10,6; CREATE | 14-param + 10-param wrapper |
| 184 | 184_diagnostic_post_journal_entry_payload.sql | REPLACE | 14-param (JSONB fix) |
| 188 | 188_fix_journal_balance_enforcement.sql | DROP 14,13,10,6; CREATE | 14-param + 10-param wrapper, batch INSERT |
| 189 | 189_fix_ledger_posting_authorization.sql | DROP 14,13,10,6; CREATE | **15-param** (p_posting_source) + 14-param wrapper + 10-param wrapper |
| 190 | 190_fix_posting_source_default_bug.sql | DROP 15,14,10,6; CREATE | 15-param (posting_source required) + 14-param wrapper + 10-param wrapper |
| 228 | 228_revenue_recognition_guards.sql | DROP 15-param; CREATE | **16-param** (p_is_revenue_correction) + **14-param wrapper** (calls 16-param with named args) |
| 252 | 252_contract_v11_enforcement.sql | REPLACE | 16-param (rounding, period_id, timezone) |
| 253 | 253_accounting_adoption_boundary.sql | REPLACE | 16-param (adoption boundary) |
| 292 | 292_credit_note_revenue_guard.sql | REPLACE | 16-param (credit_note revenue) |
| 324 | 324_expense_edit_ledger_repost.sql | **DROP 16-param**; CREATE | **17-param** (p_reverses_entry_id UUID DEFAULT NULL). **Previously also created 16-param wrapper** (removed in repo fix). |

**When duplication was introduced:** In **324_expense_edit_ledger_repost.sql**. That migration:

1. Drops the single 16-param version.
2. Creates the 17-param version (canonical).
3. **Originally** created a 16-param wrapper that called the 17-param with `NULL::UUID` for the last argument.

A call with **16 arguments** could resolve to either the 16-param wrapper or the 17-param function (with default for the 17th), so PostgreSQL reported "function post_journal_entry(...) is not unique". The 16-param wrapper has since been removed from the migration file in the repo.

**Original vs modified signature:**

- **Original (043):** 6 params, no optional args.
- **Modified over time:** Optional params added in order: p_is_adjustment, p_adjustment_reason, p_adjustment_ref, p_created_by, p_entry_type, p_backfill_reason, p_backfill_actor, p_posted_by_accountant_id, p_posting_source, p_is_revenue_correction, p_reverses_entry_id.
- **Argument types:** No change to types; only new trailing params with defaults.

---

## 3. All call sites with argument list

**Inside migrations (SQL):**

| File | Line | Params passed | Count | Notes |
|------|------|----------------|-------|--------|
| 072_fix_payment_ledger_balance.sql | 92 | business_id_val, date, desc, 'payment', p_payment_id, jsonb_build_array(...) | 6 | Literals: TEXT, TEXT |
| 075_fix_payment_ledger_final.sql | 112 | (same pattern) | 6 | |
| 091_step5_payment_settlement_ledger.sql | 96, 204 | (same pattern) | 6 | |
| 092_step6_credit_note_recognition_reversal.sql | 180 | business_id_val, cn_record.date, desc, 'credit_note', p_credit_note_id, journal_lines | 6 | |
| 094_accounting_periods.sql | 240, 365, 490, 621, 781 | (same 6-arg pattern) | 6 | |
| 100_control_account_resolution.sql | 167, 309 | (same 6-arg pattern) | 6 | |
| 101_settlement_coa_validation.sql | 110, 233 | (same 6-arg pattern) | 6 | |
| 130_refactor_ledger_posting_to_use_tax_lines_canonical.sql | 193, 395 | (same 6-arg pattern) | 6 | |
| 137_adjusting_journals_phase2e.sql | 133 | p_business_id, p_entry_date, p_description, 'adjustment', NULL, p_lines | 6 | NULL = reference_id |
| 162_complete_sale_ledger_postings.sql | 244 | (6-arg) | 6 | |
| 175_retail_control_account_mapping.sql | 297 | ..., journal_lines, FALSE, NULL, NULL, NULL, p_entry_type, p_backfill_reason, p_backfill_actor | 10 | |
| 180_retail_ledger_null_credit_fix.sql | 633 | ..., journal_lines, FALSE, NULL, NULL, NULL, p_entry_type, p_backfill_reason, p_backfill_actor, p_posted_by_accountant_id | 14 | No p_posting_source |
| 182_add_debug_logging_to_post_sale.sql | 466 | (same as 180) | 14 | |
| 190_fix_posting_source_default_bug.sql | 488, 655, 822, 955, 1092, 1224, 1441 | ..., NULL, 'system' | 15 | p_posted_by_accountant_id NULL, p_posting_source 'system' |
| 191_fix_refund_payment_method_and_enforcement.sql | 323 | ..., NULL, 'system' | 15 | |
| 192_unify_refund_void_posting_paths.sql | 332, 641 | ..., NULL, 'system' | 15 | |
| 259_sale_refund_void_posting_idempotency.sql | 306, 504, 696 | 14 or 15 args; refund/void: ..., NULL, 'system' | 14 / 15 | |
| 263_reconciliation_advisory_lock_business_id.sql | 51 | ..., COALESCE(p_posting_source, 'accountant'), FALSE | 16 | |
| 264_supplier_payment_ap_control_mapping.sql | 107 | ..., NULL, 'system' | 15 | |
| 270_bill_payment_open_status_guard.sql | 116 | (15+ args) | 15 | |
| 322_service_job_usage_ledger.sql | 68 | ..., NULL, 'system', FALSE | 16 | |
| 323_service_job_cancel_reversal.sql | 82 | ..., NULL, 'system' | 15 | No p_is_revenue_correction |
| 324_expense_edit_ledger_repost.sql | 506 | business_id_val, expense_row.date, v_description, 'expense', p_expense_id, journal_lines, FALSE, NULL, NULL, NULL, p_entry_type, p_backfill_reason, p_backfill_actor, NULL, 'system', FALSE, NULL::UUID | 17 | Explicit 17th arg NULL::UUID |

**Call-site argument patterns:**

- **NULLs:** p_adjustment_reason, p_adjustment_ref, p_created_by, p_entry_type, p_backfill_reason, p_backfill_actor, p_posted_by_accountant_id often passed as NULL.
- **String literals:** p_reference_type ('payment', 'invoice', 'expense', 'sale', 'credit_note', 'bill', 'bill_payment', 'refund', 'void', 'system' for posting_source, 'accountant').
- **Boolean literals:** p_is_adjustment FALSE, p_is_revenue_correction FALSE.
- **Explicit cast:** 324 post_expense_to_ledger uses NULL::UUID for p_reverses_entry_id.
- **Untyped:** Most NULLs are untyped; only 324 and a few wrappers use NULL::UUID.

**No application/API code** calls `post_journal_entry` directly; only SQL in migrations and other DB functions (e.g. post_invoice_to_ledger, post_sale_to_ledger, post_expense_to_ledger).

---

## 4. Canonical intended signature

**Canonical signature (single source of truth):**

- **17 parameters:**  
  `(p_business_id UUID, p_date DATE, p_description TEXT, p_reference_type TEXT, p_reference_id UUID, p_lines JSONB, p_is_adjustment BOOLEAN DEFAULT FALSE, p_adjustment_reason TEXT DEFAULT NULL, p_adjustment_ref TEXT DEFAULT NULL, p_created_by UUID DEFAULT NULL, p_entry_type TEXT DEFAULT NULL, p_backfill_reason TEXT DEFAULT NULL, p_backfill_actor TEXT DEFAULT NULL, p_posted_by_accountant_id UUID DEFAULT NULL, p_posting_source TEXT DEFAULT NULL, p_is_revenue_correction BOOLEAN DEFAULT FALSE, p_reverses_entry_id UUID DEFAULT NULL)`  
  Return: UUID.

- **Defined in:** 324_expense_edit_ledger_repost.sql (after DROP of 16-param).
- **Used for:** All flows — expenses (including reversal via p_reverses_entry_id), invoices, sales, refunds, void, credit notes, bills, payments, supplier payments, adjustments, reconciliation, service job usage/cancel.

**Newer overload:** The 17th parameter (p_reverses_entry_id) was added intentionally in 324 for expense-edit reversal. It is not an accidental overload; the accidental part was adding a **16-param wrapper** in the same migration, which created ambiguity for 16-arg calls.

**Call sites and canonical:**

- Call sites that pass 15 or 16 arguments rely on the **same** canonical function (17-param) via trailing defaults.
- No caller is intended to use a different "newer" overload; the only intended overload is the 17-param one.

---

## 5. Default-parameter and duplication check

- **Simulated defaults:** Yes. Multiple migrations (189, 190, 228, 324) added **wrapper** functions with fewer parameters that call the "full" version with extra args (e.g. p_posting_source => 'accountant', p_is_revenue_correction => FALSE, NULL::UUID for p_reverses_entry_id). So callers could use 10, 14, 15, or 16 args.
- **Optional args vs named:** The canonical function uses DEFAULT in the signature. Wrappers use named arguments when calling it.
- **Duplication:** 324 **replaced** the 16-param implementation with a 17-param one and **also** added a 16-param wrapper. That created two functions that both match a 16-arg call (wrapper exact match, 17-param with default). So the duplication was "duplicate function" (wrapper + main), not "someone replaced and left an old body behind."

---

## 6. Structural risk assessment

1. **Is the duplication accidental?**  
   **Yes.** The 16-param wrapper in 324 was for "backward compatibility" but made 16-arg calls ambiguous. The intended design is a single 17-param function with defaults.

2. **Is it safe to drop one overload?**  
   **Yes.** Dropping the 16-param wrapper is safe. All 16-arg callers resolve to the 17-param function with `p_reverses_entry_id = NULL`. No caller needs the wrapper to exist.

3. **Should we standardize to one signature?**  
   **Yes.** Standardize on the **17-parameter** signature as the only version. No wrappers (10, 14, 16 param) should remain; callers can pass 15 or 16 args and rely on defaults.

4. **Are any call sites relying on the newer signature?**  
   **No.** "Newer" here means the 17th param. Only 324's `post_expense_to_ledger` passes 17 args (and explicitly NULL for reversal when not a reversal). All other call sites pass 15 or 16 args and are fine with the 17-param function plus defaults.

5. **Risk to historical data if we drop one?**  
   **None.** Dropping the 16-param wrapper does not change stored data. It only removes an alternative resolution for 16-arg calls. Existing journal_entries were written by the same underlying logic (now in the 17-param function).

---

## 7. Recommendation (no changes made in this audit)

- **Drop the 16-param overload** (the wrapper that calls 17-param with `NULL::UUID`), so that only the **17-param** `post_journal_entry` exists.
- **Do not add** any other overloads or wrappers; keep a single canonical 17-param function.
- **Optional hardening:** In migrations that still create or replace `post_journal_entry`, add an explicit `DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN);` before creating the 17-param version, so that any leftover 16-param wrapper from an older 324 run is removed.
- **Casting:** No need to change call sites to add casts if there is only one overload; current 15/16-arg calls already resolve once the wrapper is gone.

**Status in repo:** The 16-param wrapper has already been removed from `324_expense_edit_ledger_repost.sql`. If the database was migrated before that edit, run the DROP above (or re-run 324 after the fix) so the live database has only the 17-param function.
