# Contract v2.0 Simulation Evidence

**Mode:** Simulation + Evidence Output. No schema changes, no migrations, no refactors.

Run the workflow steps below (via app or API), then run **`scripts/contract-v2-simulation-evidence.sql`** in Supabase SQL Editor to get PASS/FAIL and evidence per scenario.

---

## 1) Full Invoice Lifecycle

| Step | Action | Code reference |
|------|--------|----------------|
| Create draft invoice | POST create invoice (draft) | `app/api/invoices/create/route.ts` |
| Send invoice | POST `.../invoices/[id]/send` → status=sent, sent_at set | `app/api/invoices/[id]/send/route.ts` L36-41 → trigger posts |
| Revenue JE created | Trigger `trigger_auto_post_invoice` → `post_invoice_to_ledger` | `supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql` L75-76, L196-198 |
| JE date = sent_at date | posting_date := COALESCE(sent_at::date, issue_date) | `226_accrual_ar_posting_invoice_finalisation.sql` L75-78, L198 |
| Partial payment | POST payments (or mark-paid) | `app/api/invoices/[id]/mark-paid/route.ts`, payment trigger posts |
| Final payment | Same; invoice status → paid via trigger | Payment JE: period guard in `217_payment_posting_period_guard.sql` |
| AR clears to zero | Sum of payments = invoice.total; AR balance from ledger = 0 | Evidence script: reconciliation_result |

**Evidence script:** Returns latest sent invoice with JE; PASS if `je.date = expected_je_date` and (when paid) payments match total.

---

## 2) Expense Lifecycle

| Step | Action | Code reference |
|------|--------|----------------|
| Create expense | POST `.../expenses/create` or insert into `expenses` | `app/api/expenses/create/route.ts`; trigger posts |
| JE created | `post_expense_to_ledger` (trigger) | `supabase/migrations/229_expense_posting_schema_aligned.sql` |
| Posting date = expense.date | posting_date from expense row | `229_expense_posting_schema_aligned.sql` (date from expense); period guard L121 |

**Evidence script:** Returns latest expense with JE; PASS if `je.date = expense.date`.

---

## 3) POS Sale

| Step | Action | Code reference |
|------|--------|----------------|
| Create sale | POST `.../sales/create` | `app/api/sales/create/route.ts` |
| Revenue + cash JE | Sale trigger posts Dr Cash / Cr Revenue (and tax if any) | e.g. `supabase/migrations/189_fix_ledger_posting_authorization.sql` L417; `197_layaway_installments_phase2.sql` L369 |
| Posting date = sale.created_at::date | assert_accounting_period_is_open(..., sale_record.created_at::DATE) | `174_track_a_refund_posting_and_sale_idempotency.sql` L83; `197_layaway_installments_phase2.sql` L197 |

**Evidence script:** Returns latest sale with JE; PASS if `je.date = sale.created_at::date`.

---

## 4) Refund Flow

| Step | Action | Code reference |
|------|--------|----------------|
| Process refund | Refund/void flow creates reversal | `supabase/migrations/192_unify_refund_void_posting_paths.sql`; reference_type 'refund' or 'sale_refund' |
| Reversal JE created | Refund posting path | `192_unify_refund_void_posting_paths.sql` L127, L438 |
| Posts in processing period | posting_date = CURRENT_DATE or sale date; period guard | `191_fix_refund_payment_method_and_enforcement.sql` L101; `192_unify_refund_void_posting_paths.sql` L127, L438 |

**Evidence script:** Returns latest refund JE; PASS if refund JE exists with period_id set.

---

## 5) Adoption Boundary Guard

| Step | Action | Code reference |
|------|--------|----------------|
| Attempt posting before accounting_start_date | Call `post_journal_entry` with p_date < business.accounting_start_date, entry_type NOT opening_balance/backfill | `supabase/migrations/253_accounting_adoption_boundary.sql` L170-174 |
| Confirm rejection | RAISE EXCEPTION 'Posting date precedes accounting adoption date...' | L171-173 |
| Backfill posting | Same function with p_entry_type = 'backfill' (and backfill_reason, backfill_actor) | L169: allowed when entry_type IN ('opening_balance','backfill') |

**Evidence script:** PASS if no operational JEs with `date < accounting_start_date`. Backfill/opening_balance allowed by rule.

---

## 6) Period Lock Guard

| Step | Action | Code reference |
|------|--------|----------------|
| Close period | POST `.../accounting/periods/close` with action lock (or request_close → approve → lock) | `app/api/accounting/periods/close/route.ts` L204 (run_period_close_checks), L342 (soft_closed), L444 (lock) |
| Attempt posting into closed period | Any post (invoice send, payment, expense, manual JE) with date in locked period | `assert_accounting_period_is_open` in `post_journal_entry` (253 L187); triggers in 217, 229, 226, etc. |
| Confirm rejection | 4xx + message (period closed/locked) | DB raises; API returns error |

**Evidence script:** Reports enforcement present (253 L187; triggers). No DB row “rejection”; run integration test to verify (e.g. `app/api/accounting/periods/__tests__/posting-block.test.ts` or `opening-balances/__tests__/period-lock-enforcement.test.ts`).

---

## Output format (from script)

For each scenario the script returns:

| Column | Meaning |
|--------|--------|
| scenario | 1_invoice_lifecycle \| 2_expense_lifecycle \| 3_pos_sale \| 4_refund_flow \| 5_adoption_boundary \| 6_period_lock |
| result | PASS \| FAIL |
| journal_entry_id | UUID of representative JE (null for 5/6 or when no data) |
| ledger_lines_summary | JSON/text of debit/credit lines |
| period_assigned | period_id for the JE |
| reconciliation_result | Short explanation (dates, paid total, or enforcement ref) |

Run **`scripts/contract-v2-simulation-evidence.sql`** after executing the flows to populate the evidence table.
