# Journal architecture

Investigation baseline: `ee5cdb2256b59baccf85a598fbc53e083153e53b` (`origin/main`).

Evidence is the migration that last defines each object, plus a read-only inspection of staging project `adonhhtooawkeemdqqeo` on 12 October 2026. Production financial rows were not read.

## Tables

`journal_entries` is created in `supabase/migrations/043_accounting_core.sql` and extended by later migrations. Columns used by posting:

| Column | Role |
|---|---|
| `id`, `business_id`, `date`, `description` | Identity and posting date |
| `reference_type`, `reference_id` | Polymorphic source pointer |
| `reverses_entry_id` | Set only on a reversal row. Added in `324_expense_edit_ledger_repost.sql`. There is no `reversed_by` column |
| `is_adjustment`, `adjustment_reason`, `adjustment_ref` | Adjustment and reversal period rules |
| `entry_type`, `backfill_reason`, `backfill_actor` | Opening balance and backfill |
| `posting_source` | `system` or `accountant`. Required by `post_journal_entry` |
| `period_id` | Accounting period resolved at insert |
| `currency`, `fx_rate` | Not written by `post_journal_entry`. Default currency is `GHS`. `trigger_enforce_currency_fx_validation` validates them |
| `source_type`, `source_id`, `source_draft_id`, `input_hash`, `source_import_id` | Manual drafts and opening-balance imports. Document posters do not set `source_type` |

`journal_entry_lines` columns used by posting: `journal_entry_id`, `account_id`, `debit`, `credit`, `description`.

`reference_id` cannot have a foreign key. It points at invoices, credit notes, bills, expenses, payments, sales, or other journals depending on `reference_type`.

## Shared insert

Latest body: `supabase/migrations/418_post_journal_entry_allow_retail_sale_revenue.sql`.

`post_journal_entry(...)` always inserts. It does not look for an existing source journal and it does not take an advisory lock.

Before insert it:

- Requires `posting_source` of `system` or `accountant`.
- Rejects an unbalanced entry when `abs(debit - credit) > 0.01`.
- Resolves `accounting_periods` and calls `assert_accounting_period_is_open`. Locked periods block all posts. Soft-closed periods allow only `p_is_adjustment = true`.
- Blocks dates before `businesses.accounting_start_date` unless `entry_type` is `opening_balance` or `backfill`.
- Restricts revenue-account lines to invoice, credit note, sale, reversal, and flagged adjustment paths.

Reversals are new rows. The general-ledger route `app/api/accounting/reversal/route.ts` sets `reference_type = 'reversal'` and `is_adjustment = true`. It does not pass `p_reverses_entry_id`, so that column stays null on that path. Expense edit and retail refund/void do set `reverses_entry_id`.

## Document posters

Triggers are `AFTER` row triggers, so the journal insert commits or rolls back with the source statement, except retail sale posting, which is a separate RPC after the sale insert.

| Function | Latest migration | Advisory lock | Returns an existing live journal | `reference_type` | Invoked by |
|---|---|---|---|---|---|
| `post_invoice_to_ledger` | `551_invoice_sales_revenue_wording.sql` | Yes | Yes | `invoice` | `trigger_post_invoice` when status becomes `sent`, `paid`, or `partially_paid` |
| `post_credit_note_to_ledger` | `190_fix_posting_source_default_bug.sql` | No | No. Every call inserts | `credit_note` | `trigger_post_credit_note` when status becomes `applied` |
| `post_bill_to_ledger` | `548_bill_material_inventory_posting.sql` | No | Yes, but the check is before any lock | `bill` | `trigger_post_bill` when status becomes `open` |
| `post_expense_to_ledger` | `387_expense_ledger_fx_home_currency.sql` | Yes | Yes, ignoring a journal that already has a reversal | `expense` | `AFTER INSERT` on expenses. Edits call `repost_expense_to_ledger` |
| `post_payment_to_ledger` | `393_credit_note_customer_credit_liability_and_settlement.sql` | Yes | Yes | `payment` | `trigger_post_payment` `AFTER INSERT` on `payments` |
| `post_invoice_payment_to_ledger` | `436_wht_receivable_ensure_and_payment_posting.sql` | No | No | `payment` | Called by `post_payment_to_ledger` |
| `post_bill_payment_to_ledger` | `389_bill_payment_settlement_fx_rate.sql` | No | No check for an existing `bill_payment` journal | `bill_payment` | `AFTER INSERT` on `bill_payments` |
| `post_sale_to_ledger` | `417_post_sale_to_ledger_post_journal_entry_posting_source.sql` | Yes on the current overload | Yes | `sale` | `lib/sales/runRetailSaleCreationEngine.server.ts` after the sale insert |

`repost_expense_to_ledger` (`324_expense_edit_ledger_repost.sql`) inserts `reference_type = 'expense_reversal'` with `reverses_entry_id` set, then calls `post_expense_to_ledger` again. The original expense row stays immutable and keeps `reverses_entry_id` null.

Retail refund and void (`419_retail_refund_void_ledger_reversal_reference.sql`) write `reference_type = 'reversal'` and set `reverses_entry_id`. They are not a second `sale` journal.

Payroll already has partial unique indexes from `555_harden_atomic_payroll_approval.sql` and `557_payroll_reversal_and_corrections.sql`. Service-job usage returns have `idx_journal_entries_service_job_usage_return`.

## Immutability, balance, period, currency

On staging, these triggers are enabled:

| Trigger | Function | Effect |
|---|---|---|
| `trigger_prevent_journal_entry_modification` | `prevent_journal_entry_modification` | Blocks `UPDATE` and `DELETE` on `journal_entries`. No reversal exception |
| `trigger_prevent_journal_entry_line_modification` | `prevent_journal_entry_line_modification` | Blocks `UPDATE` and `DELETE` on lines |
| `trigger_enforce_double_entry_balance` | `enforce_double_entry_balance_statement` | Statement-level balance check on lines |
| `trigger_enforce_period_state_on_entry` | `validate_period_open_for_entry` | Blocks locked periods. Soft-closed periods allow `adjustment` or `reversal` |
| `trigger_enforce_currency_fx_validation` | `enforce_currency_fx_validation` | Currency and rate check |

Because posted rows cannot be updated, a reversal cannot flip a flag on the original journal. The original row remains in any unique index whose predicate is `reverses_entry_id IS NULL`.

## Uniqueness that exists today

`idx_journal_entries_reference` on `(reference_type, reference_id)` is not unique.

Partial unique indexes exist for manual drafts, opening-balance imports, reconciliation, payroll, payroll reversal, and `service_job_usage_return`. None of those cover invoice, credit note, bill, expense, payment, bill payment, or sale.

## RLS

Staging has RLS enabled and not forced on both journal tables. Policies allow select and insert for business and firm scopes. There is no update or delete policy on `journal_entries`. Posting functions are `SECURITY DEFINER`, so system posts do not depend on the caller's RLS. Tenant identity has to come from the source document inside the function.

## Staging drift

Staging still has two older `post_journal_entry` overloads (10 arguments and 14 arguments) besides the 17-argument function in migration 418. `CREATE OR REPLACE` does not drop other overloads. Staging also has three `post_sale_to_ledger` overloads. The 5-argument sale function has an advisory lock. The 4-argument and 2-argument sale functions do not.

## Lifecycle

1. A source document changes (`sent`, `applied`, `open`, expense insert, payment insert, or a retail RPC).
2. The trigger or RPC calls a document poster.
3. The poster either returns an existing journal or calls `post_journal_entry`.
4. `post_journal_entry` checks balance, period, and revenue rules, then inserts the header and lines.
5. Immutability triggers reject later updates and deletes.
6. A correction inserts a new reversal row. Expense edit then inserts a replacement source journal.
