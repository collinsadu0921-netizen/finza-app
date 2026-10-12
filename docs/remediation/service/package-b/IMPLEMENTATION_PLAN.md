# Package B implementation plan

Staging migration `one_live_source_journal` (`20261012002953`) is applied. Staging migration `disambiguate_post_sale_two_arg` (`20261012224338`) replaces only the two-argument sale poster body. Historical journals were not reversed. Production is not applied. See `STAGING_RESULT.md`.

## Decision

Use a shared live-journal check under an advisory lock, plus a `BEFORE INSERT` trigger with the same predicate. Do not add a unique index on `(reference_type, reference_id)` in this package.

The index cannot see "a later row reverses this one," and immutability forbids stamping that fact onto the original row. Expense repost would then fail.

## Order

1. Owner approves this predicate and the decision not to add the unique index.
2. Apply one staging migration. Do not apply it to production in this package.
3. Run the database tests in `TEST_PLAN.md` on staging.
4. Separately, the owner signs a keep-or-reverse note for each LED-001 group, the production LED-004 journal, and any staging orphan the preflight still lists. That note is not part of the migration.
5. Retail routes stay unchanged. The sale fixture in the test plan is the Retail regression.

## Code change

One new migration. No TypeScript change is required for the posting rule. Application routes already call the existing triggers and RPCs.

### 1. Helper

`assert_one_live_source_journal(p_business_id uuid, p_reference_type text, p_reference_id uuid) returns uuid`

- Takes `pg_advisory_xact_lock(hashtext(p_business_id::text), hashtext(p_reference_type || ':' || p_reference_id::text))`.
- A live journal is `reference_type` and `reference_id` and `business_id` matching, `reverses_entry_id` null, and no row whose `reverses_entry_id` equals that journal.
- If one live journal exists, return its id.
- If none exists, return null.
- If more than one exists, raise. Do not pick a winner inside the helper. LED-001 cleanup is a separate approval.

Covered types: `invoice`, `credit_note`, `bill`, `expense`, `payment`, `bill_payment`, `sale`.

Not covered: `reversal`, `expense_reversal`, `payroll`, `payroll_reversal`, `reconciliation`, `service_job_usage_return`, `adjustment`, `manual`. Those already have their own rules or are the reversal row itself.

### 2. Call the helper before insert

Replace the bodies, keeping the current financial lines, of:

- `post_credit_note_to_ledger`
- `post_bill_to_ledger`
- `post_bill_payment_to_ledger`
- `post_invoice_payment_to_ledger`

Each one locks through the helper. If the helper returns an id, the function returns that id and does not insert. `post_payment_to_ledger` may keep its own lock. `post_invoice_payment_to_ledger` must still check, so a direct call cannot skip the wrapper.

`post_invoice_to_ledger`, `post_expense_to_ledger`, and the locked `post_sale_to_ledger` already return an existing journal. Point them at the same helper so the predicate cannot drift. Their line construction stays as it is.

`repost_expense_to_ledger` stays ordered as it is now: insert the `expense_reversal` row first, then call `post_expense_to_ledger`. The helper then sees the original expense journal as reversed and allows the replacement.

### 3. Trigger

`BEFORE INSERT` on `journal_entries`, for the covered types only, when `reverses_entry_id` is null:

- Take the same advisory lock.
- If another live journal already exists, raise.
- Do not try to return the old id from the trigger. A raw insert that loses the race fails the statement. The document functions avoid that by returning the existing id before they insert.

The advisory lock is re-entrant in the same transaction, so the function and the trigger can both take it.

Do not update the original journal. Immutability stays in place.

### 4. Overloads

In the same migration, drop staging's extra `post_journal_entry` overloads only if a repository search shows no remaining caller of the 10-argument or 14-argument signatures. Migration 418's 17-argument function is the one to keep. Dropping an overload that a trigger still calls would break posting, so the search is part of the implementation, not an assumption.

Do not drop `post_sale_to_ledger` overloads in this package. Retail is out of scope. The test fixture calls the locked 5-argument function and asserts a second call does not insert.

## What this change does not do

- It does not reverse the LED-001 journals or the LED-004 orphan.
- It does not delete the four staging invoice orphans dated 2026-07-04.
- It does not add a manual journal screen.
- It does not change payroll, VAT, withholding, inventory usage, or report snapshots.
- It does not change Package A payment authorization.
- It does not weaken immutability or period locks.

## Historical correction, after approval

For each duplicate group the preflight returns, the correction plan names both journal ids, the business, the debit total of the extra journal, and whether the extra row is reversed by a new `reversal` entry. Reversal goes through `post_journal_entry` with `reference_type = 'reversal'` and `reverses_entry_id` set, in an open or explicitly adjusted period. No bulk reversal script.

## Regression impact

| Path | Expected result |
|---|---|
| Second credit-note apply | Returns the first live journal. Credit note stays `applied` |
| Second bill open / payment insert | Returns the first live journal |
| Expense edit | Reversal row plus one new expense journal. Both succeed |
| Invoice send retry | Still returns the first invoice journal |
| Retail sale retry | Still returns the first sale journal |
| Retail refund or void | Still inserts a `reversal` row |
| Payroll approve | Unchanged. Existing payroll unique indexes stay |
| Closed period | Still rejected by the current period checks |
| Unbalanced lines | Still rejected by `post_journal_entry` |

If a historical duplicate group still has two live rows, the helper raises instead of posting a third. That is intentional. Those groups wait for the correction approval. New businesses with one live journal are unaffected.

## Size

- Database functions and one trigger: one migration.
- Application files: none, unless the overload search finds a caller that must name the 17-argument function.
- Historical data migration: none in this change.
