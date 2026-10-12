# Package B staging result

Date: 12 October 2026. Worktree `C:\projects\finza-web\finza-package-b-journal`. Baseline `ee5cdb2256b59baccf85a598fbc53e083153e53b`. Not committed.

## Migration

| Item | Value |
|---|---|
| File | `supabase/migrations/589_one_live_source_journal.sql` |
| Staging name | `one_live_source_journal` |
| Staging version | `20261012002953` |
| Project | `adonhhtooawkeemdqqeo` (Staging Finza) |
| Applied | Yes |
| Production | Not applied |

## Preflight, before apply

- Helper and trigger were absent.
- Immutability triggers were enabled.
- Journal headers: 1,716. Lines: 3,926.
- Live duplicate groups: 1 credit-note group, 2 journals.
- Invoice journals with no invoice row: 4.
- `post_journal_entry` still had the 10-argument, 14-argument, and 17-argument overloads. They were left in place. The 14-argument wrapper still sets `posting_source` for short named calls.
- Credit-note, bill, bill-payment, and invoice-payment posters had no advisory lock.

The migration was allowed to proceed. It does not delete or rewrite the existing duplicate group. The counts in this section are the state around migration 589. The later concurrency fixture is in "Final validation gaps".

## Predicate

A live journal matches `business_id`, `reference_type`, and `reference_id`, has `reverses_entry_id` null, and has no other row whose `reverses_entry_id` equals its id.

Covered types: `invoice`, `credit_note`, `bill`, `expense`, `payment`, `bill_payment`, `sale`.

`assert_one_live_source_journal` takes `pg_advisory_xact_lock(hashtext(business_id), hashtext(reference_type || ':' || reference_id))`. One live row returns that id. None returns null. More than one raises `multiple live journals`.

`trigger_enforce_one_live_source_journal` is `BEFORE INSERT` and calls the same helper. A second live insert raises `duplicate live journal`. Posting wrappers return the existing id before `INSERT`, so a retry does not reach the trigger. Reversal rows and uncovered types, including payroll, are ignored.

## Functions and triggers

Added:

- `assert_one_live_source_journal(uuid, text, uuid)`
- `enforce_one_live_source_journal()`
- `trigger_enforce_one_live_source_journal` on `journal_entries`

Renamed the previous financial bodies, then created wrappers that return a live journal before calling the body:

- `post_credit_note_to_ledger(uuid)`
- `post_bill_to_ledger(uuid, text, text, text)`
- `post_bill_payment_to_ledger(uuid)`
- `post_invoice_payment_to_ledger(uuid)`
- `post_invoice_to_ledger(uuid, text, text, text)`
- `post_expense_to_ledger(uuid, text, text, text)`
- `post_sale_to_ledger(uuid, text, text, text)`
- `post_sale_to_ledger(uuid, text, text, text, uuid)`

Bodies keep the suffix `_pkgb_body`, `_pkgb_body4`, or `_pkgb_body5`. No application file changed. No Retail file changed. No unique index was added. No journal row was updated or deleted.

## Deviations from the written design

- The financial bodies were wrapped instead of copied. The journal lines are the previous function bodies.
- The four-argument sale poster was wrapped as well as the five-argument poster. Retail's two-argument function forwards to the four-argument signature, and that signature had no lock.
- `post_journal_entry` overloads were not dropped.
- LED-004 was not implemented. `reference_id` is polymorphic, so a source-row check is not safe for every journal type.

## After apply

Journal headers remained 1,716. Lines remained 3,926. Live duplicate groups remained 1. Orphan invoice journals remained 4. Immutability triggers remained enabled. The synthetic test businesses from this run were rolled back. Count of businesses named `PKG-B%` was 0 at this point. The concurrency fixture committed later is listed under "Final validation gaps".

## Tests

Executed on staging inside transactions that ended in an exception, so the fixture rolled back. No TypeScript change, so the typecheck was not run.

Passed: 20. Failed: 0. The two checks blocked in this first run are closed below.

Passed:

1. Balanced invoice journal in the source business.
2. Second invoice post returns the same journal.
3. Credit-note post is idempotent.
4. Two different credit notes each post once.
5. A raw second live credit-note insert is rejected.
6. A different reference type may use the same source id.
7. Bill post is idempotent.
8. Two bill payments post two journals, and a repeat of the first returns the same journal.
9. Two invoice payments do the same, including a direct call to `post_invoice_payment_to_ledger`.
10. Expense post is idempotent.
11. Expense edit posts one reversal and one replacement live journal.
12. Unbalanced lines are rejected.
13. Update of a posted journal is rejected.
14. Delete of a posted journal is rejected.
15. Two payroll journals with different references post, and the existing payroll unique index rejects a repeat.
16. A soft-closed period rejects an ordinary journal.
17. A soft-closed period accepts an adjustment reversal.
18. A locked period rejects a journal.
19. The five-argument sale poster returns the same journal on retry.
20. Sale refund posts one reversal, a second refund returns it, and the sale journal remains.

Those two checks were blocked at the first staging run. Both are closed in "Final validation gaps" below. The 20 rolled-back cases were not repeated.

## Left untouched

- The staging credit-note duplicate group.
- The four staging invoice journals with no invoice row.
- Production LED-001 extras and the production GHS 10 orphan. Production was not queried.

## Production rollout, not authorized here

1. Run the two read-only preflight queries in this file on production under a separate read approval.
2. Apply `589_one_live_source_journal.sql` only after that preflight.
3. Do not reverse historical journals in that migration.
4. A later signed list can reverse specific duplicate or orphan journals through a normal reversal, not a delete.
5. Do not put this migration on `release/service-package-a-staging-rc`.

## Final validation gaps

Closed on 12 October 2026 against staging `adonhhtooawkeemdqqeo` only. Migration 589 was not edited. Production was not used.

### Concurrency method

`dblink` is not installed. Two real PostgreSQL backends were used instead of sequential calls.

Same-source cases used two parallel staging SQL API calls. Each call is its own backend. The first session posts and holds the transaction with `pg_sleep`. The second session waits 2 seconds, then posts the same credit note. Distinct backend pids and a multi-second lock wait are the overlap evidence.

Different-source proof used two independent `pg` clients on the staging session pooler, port 5432, user `postgres.adonhhtooawkeemdqqeo`. Each client ran `BEGIN`, posted, and `COMMIT`. The first held `pg_sleep(6)`. The second started 1.5 seconds later. A third session read `pg_stat_activity` and `pg_locks` during the wait. The script refused any connection string containing the production project. Parallel SQL API calls for this pair started one after the other, so they were not used as proof.

Fixture business: `PKG-B concurrency test`. Applied credit notes were inserted with `trigger_auto_post_credit_note` disabled inside that transaction, then the trigger was enabled before commit. It is enabled (`O`).

| Scenario | Result | Evidence |
|---|---|---|
| Same-source simultaneous posting | PASS | Sessions 3399887 and 3399886. First posted journal `e77374a6-7d6c-4c55-9b59-3942b1d56440` at 22:45:23 and held until 22:45:33. Second started at 22:45:22 and received that same id at 22:45:33 after 10078 ms. Live journals 1, lines 2, debit 20, credit 20. |
| Lock contention | PASS | Same pair. The second session waited on the first transaction's source lock and returned the existing journal after the first commit. |
| First transaction rollback | PASS | First attempt, sessions 3399890 and 3399891: second waited 4493 ms, then posted a different balanced journal because the first rolled back. Both sessions then rolled back, so the committed count was 0. Repeat, sessions 3399907 and 3399906: first journal `cb254bdf-aece-4887-82b7-e053b1d2481b` is absent. Second waited 6151 ms and committed journal `1b0b602b-41cb-4f75-a25c-18e3e8844e78`. Live count 1, debit 21, credit 21, advisory locks held 0. |
| Different sources | PASS | Sessions 3399953 and 3399954. Credit notes `PKGB-CONC-A4E` and `PKGB-CONC-A4F`. Source lock keys 2111578601 and 1979950686. Journals `a27e7266-0575-4912-923e-56868d6dbcb2` (26 = 26) and `3ff53ae8-027f-4e42-ac45-20667056250b` (27 = 27). The second post waited 5089 ms on `transactionid`, blocked by the first pid. That wait is the existing snapshot-job insert `ON CONFLICT (business_id, period_start, period_end, job_type) WHERE status = 'pending'`, not the live-journal advisory lock. Both journals committed. |

### Retail function resolution

Root cause, older than migration 589. Migration 190's `post_sale_to_ledger(uuid, uuid)` calls `post_sale_to_ledger` with four named arguments and ignores the accountant id. Migration 417 added `post_sale_to_ledger(uuid, text, text, text, uuid)` with defaults on every argument after `p_sale_id`. A four-argument call matches both the four-argument function and the five-argument function. PostgreSQL raises `function post_sale_to_ledger(uuid, text, text, text) is not unique`. Migration 589 kept both public signatures, so the ambiguity stayed.

The Retail application calls the five-argument function by name (`p_sale_id`, `p_entry_type`, `p_backfill_reason`, `p_backfill_actor`, `p_posted_by_accountant_id`). That call is unique. No Retail application file was changed.

Correction: `supabase/migrations/590_disambiguate_post_sale_two_arg.sql`, staging version `20261012224338`. The public signature `post_sale_to_ledger(uuid, uuid)` is unchanged. After the live-journal check it calls `post_sale_to_ledger_pkgb_body4(p_sale_id, NULL::text, NULL::text, NULL::text)`. The four-argument and five-argument public functions were not replaced. Their defaults were not removed. A four-argument call is still ambiguous, which preserves the five-argument Retail call.

Regression, one rolled-back transaction: two-argument post and retry returned the same journal; the five-argument call returned that journal; debit and credit were 40.00; refund and a second refund returned the same reversal; update of the posted journal did not succeed. The four-argument positional call still reports `function public.post_sale_to_ledger(uuid, text, text, text) is not unique`.

### Database integrity

| Check | Before these gap tests | After the concurrency commits | After reversals |
|---|---|---|---|
| Journal headers | 1,716 | 1,726 | 1,736 |
| Journal lines | 3,926 | 3,946 | 3,966 |
| Live duplicate groups | 1 credit-note group, 2 journals | 1 | 1 credit-note group, 2 journals |
| Invoice journals with no invoice row | 4 | 4 | 4 |
| Immutability triggers | Enabled | Enabled | Enabled (`O`) |
| `trigger_enforce_one_live_source_journal` | Enabled | Enabled | Enabled (`O`) |
| `trigger_auto_post_credit_note` | Enabled | Enabled | Enabled (`O`) |

The 20 extra headers are 10 synthetic credit-note journals and 10 reversal journals. Immutability rejects deleting them. Each original was reversed through `post_journal_entry` with `reference_type = 'reversal'`, `reverses_entry_id` set to that journal, and an adjustment reason. Synthetic live journals: 0. Combined debit minus credit for those 20 journals: 0. The historical duplicate group and the four orphan invoice journals were not modified.

The fixture business `PKG-B concurrency test`, its customer, draft invoice, and applied credit notes remain because the journals still reference those credit notes.

### Verdict

`PACKAGE B VALIDATION COMPLETE`
