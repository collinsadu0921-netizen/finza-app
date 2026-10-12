# Package B test plan

Staging execution is recorded in `STAGING_RESULT.md`. The original 20 cases passed. The two previously blocked checks, real concurrency and the two-argument sale poster, are closed in that file. The cases below remain the specification.

## Unit tests

SQL-level tests against a transaction that rolls back. One fixture business, one chart of accounts, one open period.

| Case | Assert |
|---|---|
| Balanced invoice post | One journal. Debits equal credits |
| Unbalanced lines passed to `post_journal_entry` | Exception contains `Journal entry must balance` |
| Second `post_credit_note_to_ledger` for the same credit note | Same journal id. `count(*)` for that reference stays 1 |
| Second `post_bill_to_ledger` | Same journal id |
| Second `post_bill_payment_to_ledger` | Same journal id |
| Second `post_invoice_to_ledger` | Same journal id. Existing behaviour preserved |
| Expense post, `repost_expense_to_ledger`, then the live-journal count | One live `expense` journal. One `expense_reversal` row. The replacement insert succeeds |
| Reversal of an invoice journal | New row with `reference_type = 'reversal'`. Original row unchanged |
| Second reversal of the same original | Does not insert another reversal for that original |
| Direct `INSERT` of a second live `credit_note` journal | Trigger raises. The first row remains |
| `sale` post twice through the locked `post_sale_to_ledger` | One `sale` journal |
| `post_sale_refund_to_ledger` or `post_sale_void_to_ledger` after that sale | One `reversal` row. The sale journal remains |
| Post into a locked period | Existing period exception. No new journal |
| Soft-closed period with `is_adjustment = false` | Rejected |
| Soft-closed period reversal (`is_adjustment = true`, `reference_type = 'reversal'`) | Allowed by the current period rule |
| Journal `business_id` taken from the source document | A document in business A does not create a journal in business B |

The sale cases use a fixture sale. They do not change Retail routes.

## Concurrency

Two sessions, same credit note, same business.

1. Session A calls `post_credit_note_to_ledger` and waits before commit.
2. Session B calls it and blocks on the advisory lock.
3. Session A commits.
4. Session B returns session A's journal id.
5. Exactly one `credit_note` journal exists.

Repeat the pair for `post_bill_to_ledger`.

A third session inserts a raw second `credit_note` journal while the first transaction is open. It waits, then the trigger raises after the first commit.

## Database checks that are not unit tests

Run `MIGRATION_SAFETY.md` preflight before the migration. After the migration, repeat the live-duplicate count. It must not grow. Existing duplicate groups remain until the separate correction approval. The migration does not delete them.

Confirm immutability by attempting `UPDATE` and `DELETE` on a fixture journal. Both fail. Do not run that against a real customer journal.

## HTTP

Not required to prove the lock. The database functions are the enforcement point.

If an HTTP test is added later, it is one retry of credit-note apply and one retry of bill create, asserting one journal each. It does not replace the concurrency test. It does not charge a payment and it does not resume Package A.

## Cross-module regression

| Module | What must stay true |
|---|---|
| Invoices | Send still posts one invoice journal |
| Credit notes | Apply still posts one credit-note journal |
| Bills and bill payments | Open and pay still post one journal each |
| Expenses | Create posts once. Edit reverses and reposts |
| Customer payments | `post_payment_to_ledger` still posts one payment journal. Package A behaviour is untouched |
| Payroll | Draft approve still posts one payroll journal. The payroll unique indexes stay |
| Retail sale, refund, void | One sale journal, then a reversal row. No Retail file edit |
| Reports | This migration does not change report SQL. Historical duplicate journals still appear until they are reversed under the separate approval |
| VAT and withholding | No new journal shape. Payment and bill line construction is not rewritten |

## Legitimate repeated transactions

These must still insert a new journal:

- Two different credit notes for the same customer.
- Two expenses, then an edit of one of them.
- A sale and a later refund of that sale.
- A payroll run and a later payroll reversal.
- An explicit general-ledger reversal.

These must not insert a second live journal:

- Retry of the same invoice, credit note, bill, expense, payment, bill payment, or sale source.
- Webhook or API retry that calls the same poster again.
- A second click that updates the source status again.
