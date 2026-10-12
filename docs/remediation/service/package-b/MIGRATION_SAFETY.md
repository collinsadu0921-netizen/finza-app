# Package B migration safety

Staging migration `supabase/migrations/589_one_live_source_journal.sql` is applied as `one_live_source_journal` version `20261012002953` on project `adonhhtooawkeemdqqeo`. Staging migration `supabase/migrations/590_disambiguate_post_sale_two_arg.sql` is applied as `disambiguate_post_sale_two_arg` version `20261012224338` on that same project. Production is not applied. Results are in `STAGING_RESULT.md`.

## Proposed migration

One migration file, applied only after the preflight below is reviewed:

1. Create `assert_one_live_source_journal`.
2. Replace `post_credit_note_to_ledger`, `post_bill_to_ledger`, `post_bill_payment_to_ledger`, and `post_invoice_payment_to_ledger` so they return an existing live journal.
3. Point the invoice, expense, and locked sale posters at the same helper without changing their journal lines.
4. Add the `BEFORE INSERT` trigger described in `IMPLEMENTATION_PLAN.md`.
5. Drop obsolete `post_journal_entry` overloads only when the caller search shows they are unused.

No unique index. No backfill. No reversal of existing rows. Immutability triggers stay enabled.

## Why a unique index is unsafe

A partial unique index cannot express "ignore this row once some other row reverses it." The original row cannot be updated to leave the index, because `trigger_prevent_journal_entry_modification` rejects that update.

`repost_expense_to_ledger` depends on inserting a second `expense` journal after the reversal row exists. Retail refunds use a different `reference_type`, but expense repost does not. One global unique index would stop expense edits.

Payroll, reconciliation, and `service_job_usage_return` already have partial unique indexes. The new trigger must ignore those reference types so it does not fight those indexes.

## Preflight

Run on the target database before the migration. Read-only. Do not reverse anything it returns.

```sql
-- Live duplicate groups the new trigger would refuse to extend.
select je.reference_type,
       je.business_id,
       je.reference_id,
       count(*)::int as live_journals,
       round(sum(lines.debit_total), 2) as combined_debit
from public.journal_entries je
join (
  select journal_entry_id, sum(debit) as debit_total
  from public.journal_entry_lines
  group by journal_entry_id
) lines on lines.journal_entry_id = je.id
where je.reference_type in (
        'invoice', 'credit_note', 'bill', 'expense',
        'payment', 'bill_payment', 'sale'
      )
  and je.reference_id is not null
  and je.reverses_entry_id is null
  and not exists (
    select 1
    from public.journal_entries r
    where r.reverses_entry_id = je.id
  )
group by je.reference_type, je.business_id, je.reference_id
having count(*) > 1
order by je.reference_type, live_journals desc;
```

```sql
-- Invoice journals with no invoice row. Polymorphic reference_id cannot be a foreign key.
select je.id, je.business_id, je.date, round(sum(jel.debit), 2) as debit
from public.journal_entries je
join public.journal_entry_lines jel on jel.journal_entry_id = je.id
where je.reference_type = 'invoice'
  and je.reference_id is not null
  and not exists (
    select 1 from public.invoices i where i.id = je.reference_id
  )
group by je.id, je.business_id, je.date
order by je.date;
```

Staging result of the same predicates on 12 October 2026, without listing business ids in this note:

- Credit notes: 1 live duplicate group, 2 journals, combined debit 110.
- No live duplicate group for invoice, bill, expense, payment, bill payment, sale, or payroll.
- 4 invoice journals dated 2026-07-04, debit 1,020 each, with no invoice row.

Production LED-001 (two credit-note groups, extra debit GHS 35,550, and one invoice group, extra debit GHS 1,200) and LED-004 (one GHS 10 orphan) were not re-queried. Run the preflight on production only under a separate read approval before any production migration.

If the preflight returns rows, the migration may still be applied. It refuses a third live journal for those sources. It does not delete the existing pair. New posting for a source that already has two live journals raises until the correction approval reverses one of them.

## Compatibility

| Concern | Effect |
|---|---|
| Legitimate first post | Unchanged |
| Retry of the same source | Returns the first journal instead of inserting |
| Expense edit | Still legal, because the reversal row exists before the replacement insert |
| Retail sale retry and refund | Sale retry returns the first journal. Refund remains a `reversal` insert. No Retail file changes |
| Historical duplicates | Left in place. Reports keep showing them until a signed reversal |
| Other tenants | The lock and the check include `business_id` |
| Closed books | No historical row is updated. New posts still go through `assert_accounting_period_is_open` |
| Package A | Payment authorization code is not in this migration. `post_payment_to_ledger` keeps its current lock |

## Rollback

The migration is function and trigger DDL.

1. Drop the new trigger.
2. Restore the previous function bodies from the migrations named in `JOURNAL_ARCHITECTURE.md`.
3. Do not disable `trigger_prevent_journal_entry_modification` or `trigger_prevent_journal_entry_line_modification`.
4. Do not delete journals created during the test. Roll the test transaction back. If a test committed, reverse that fixture journal with a normal reversal, not a delete.

Rollback does not recombine a historical duplicate and does not change balances by itself.

## Deployment sequence

1. Approve this design.
2. Run the preflight on staging and attach the result to the change.
3. Apply the migration on staging only.
4. Run `TEST_PLAN.md`.
5. Stop. Production apply waits for a later release approval and a production preflight.
6. Historical reversals wait for their own signed list of journal ids.

Do not ship this migration inside `release/service-package-a-staging-rc`.
