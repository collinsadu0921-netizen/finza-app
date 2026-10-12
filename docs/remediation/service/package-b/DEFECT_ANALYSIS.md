# Package B defect analysis

Register source: `docs/remediation/service/MASTER_DEFECT_REGISTER.md` in the Package A worktree `finza-payment-auth`. Those files are not on baseline `ee5cdb2`. Package B owns only LED-001, LED-002, LED-003, and LED-004.

Production financial rows were not read again. Amounts quoted from the register are the register's production evidence. Staging figures below are a separate read-only probe of `adonhhtooawkeemdqqeo`.

## LED-001 — duplicate live journals

Status in the register: CONFIRMED. Severity: P0.

Register evidence: after excluding journals that reverse another entry or have themselves been reversed, two credit-note references still have a second live journal (extra debit GHS 35,550, two businesses) and one invoice reference has a second live journal (extra debit GHS 1,200, one business).

Code evidence: `post_credit_note_to_ledger` neither locks nor returns an existing journal. Every call inserts another `credit_note` row. The credit-note trigger's existence check is not locked, so two concurrent applies can both pass it. Invoice posting does lock and return an existing invoice journal, so a remaining invoice duplicate is historical or came from a path that bypassed that check.

Staging probe, live predicate (`reverses_entry_id` is null and no other row points at the journal):

| `reference_type` | Live duplicate groups |
|---|---|
| `credit_note` | 1 group, 2 journals, combined line debit 110 |
| `invoice`, `bill`, `expense`, `payment`, `bill_payment`, `sale`, `payroll` | none |

Staging does not reproduce the production GHS 35,550 or GHS 1,200 groups. Those production rows still need the register's keep-or-reverse decision. This package does not reverse them.

## LED-002 — posting is check-then-insert

Status in the register: CONFIRMED. Severity: P0.

Root cause: `post_journal_entry` always inserts. Idempotency is left to each caller. There is no unique key on `(business_id, reference_type, reference_id)` for the document types in this package.

Staging function probe (`pg_advisory` present in the function body):

| Function | Advisory lock |
|---|---|
| `post_invoice_to_ledger` | yes |
| `post_expense_to_ledger` | yes |
| `post_payment_to_ledger` | yes |
| `post_sale_to_ledger` (5-argument) | yes |
| `post_credit_note_to_ledger` | no |
| `post_bill_to_ledger` | no |
| `post_invoice_payment_to_ledger` | no. The wrapper `post_payment_to_ledger` locks first |
| `post_bill_payment_to_ledger` | no |
| `post_journal_entry` (all overloads) | no |

Repository `548_bill_material_inventory_posting.sql` checks for an existing bill journal and then inserts, without a lock. Two concurrent bill posts can both see no row and both insert.

A unique index on `(business_id, reference_type, reference_id) WHERE reverses_entry_id IS NULL` is not safe:

- Immutability forbids updating the original row when it is reversed.
- The original therefore stays in that predicate forever.
- `repost_expense_to_ledger` then inserts another `reference_type = 'expense'` row for the same expense. The index would reject that legitimate repost.
- Retail refunds and voids use `reference_type = 'reversal'`, so a sale-only index would not block them. A global index still would not express "the previous row has been reversed," because a partial index cannot contain a subquery.

Payroll, reconciliation, and service-job usage returns already have their own partial unique indexes. They are not LED-002's hole, and a new index must not overlap them carelessly.

## LED-003 — expense pairs are reversals

Status in the register: NOT REPRODUCED.

A first count of repeated expense references looked like about GHS 1.4 million of duplicates. After excluding reversals, no live duplicate expense group remained. Staging also shows no live duplicate expense group under that predicate.

No expense-journal correction. LED-002 must keep treating a reversal plus a replacement post as legal. `324_expense_edit_ledger_repost.sql` is that path.

## LED-004 — orphan journal

Status in the register: CONFIRMED. Severity: P2.

Register evidence: one business has an orphan journal dated 10 May 2026, created 3 June 2026, description `Invoice #VERIFY-492-1780482856235`, debit and credit GHS 10, with no invoice row.

`reference_id` is polymorphic, so the database cannot foreign-key it to `invoices`. Deleting the invoice, or posting with an id that was never committed, leaves the journal in place. Immutability then prevents deleting it.

Staging probe: 4 `invoice` journals dated 2026-07-04, each with line debit 1,020, whose `reference_id` matches no `invoices` row. Credit-note orphans: 0. These are not the production GHS 10 journal. They are additional staging candidates for the same keep-or-reverse decision, not an automatic cleanup.

## Existing protections

- `post_journal_entry` rejects an entry when debits and credits differ by more than 0.01.
- `trigger_enforce_double_entry_balance` is enabled on staging.
- Immutability triggers are enabled on headers and lines. Update and delete are blocked, including for reversals.
- Period opening is enforced in `post_journal_entry` and `validate_period_open_for_entry`.
- Invoice, expense, customer-payment wrapper, and the current retail sale overload serialize with `pg_advisory_xact_lock` and return the existing journal.
- Payroll and payroll-reversal reference uniqueness is already enforced.

A staging scan that grouped line totals found one `payroll` journal dated 2098-03-01 whose rounded debit and credit are both 39,913. The absolute difference across payroll journals on that date is 0. That is not a Package B imbalance defect.

## Unverified risks

- Production LED-001 and LED-004 row identities were not re-read. The register remains the production evidence.
- Older `post_journal_entry` overloads still exist on staging. A caller that hits the 10-argument or 14-argument function skips the current signature. The baseline migration 418 does not drop those overloads.
- The 2-argument and 4-argument `post_sale_to_ledger` overloads on staging have no advisory lock. Retail code on this baseline calls the locked overload. A second sale overload is a drift risk, not a Retail code change.
- `SECURITY DEFINER` posters trust the business id on the source row. This investigation did not find a confirmed cross-tenant post. It also did not certify every poster.
- Direct inserts are still allowed by RLS insert policies. A client that can insert `journal_entries` bypasses the document posters. The proposed trigger is what closes that gap for the listed reference types.
- Closed periods, currency, and statement snapshots are enforced or tracked elsewhere. No new closed-period defect was reproduced. Package D already owns FIN-001, FIN-003, and FIN-004.

## What is not a Package B defect

PAY-001 and PAY-002 are Package A. PRL-001 and PRL-004 are Package E. MAT-001 is Package F. DOC-004 says there is no general manual journal screen and this programme does not add one. Period close not journaling retained earnings is FIN-004, Package D.
