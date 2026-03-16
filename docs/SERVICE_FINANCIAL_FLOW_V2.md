# Service Financial Flow v2

Dashboard analytics feature that uses **direct ledger aggregation** for the Service workspace financial flow chart instead of trial balance snapshots.

## Feature flag

Set in environment (e.g. `.env.local`):

```bash
# Enable Service Financial Flow v2 (ledger-derived chart). Omit or set to false to use snapshot-based timeline.
NEXT_PUBLIC_SERVICE_ANALYTICS_V2=true
```

- **`true`** — Chart data from `GET /api/dashboard/service-analytics` (ledger aggregation by day/week/month). Cash toggle and line chart with full tooltip (Date, Revenue, Expenses, Profit, Cash Movement).
- **`false`** or unset — Chart data from `GET /api/dashboard/service-timeline` (existing snapshot-based P&L per accounting period). No cash series.

## Rollback

To revert to the previous behaviour:

1. Set `NEXT_PUBLIC_SERVICE_ANALYTICS_V2=false` or remove the variable.
2. Restart the app so the client picks up the new env.

No database or accounting changes are reverted; the dashboard simply switches back to the snapshot-based timeline API.

## What is not changed

- Ledger posting, journal entries, trial_balance_snapshots
- Accounting workspace reports (P&L, Balance Sheet, Trial Balance)
- Period locking, reconciliation, `get_profit_and_loss_from_trial_balance`, `generate_trial_balance`

## Data source (v2)

- **API:** `GET /api/dashboard/service-analytics?business_id=...&start_date=...&end_date=...&interval=day|week|month`
- **Backend:** RPC `get_service_analytics_timeline(p_business_id, p_start_date, p_end_date, p_interval)` in migration `271_service_analytics_timeline_rpc.sql`
- **Logic:** Joins `journal_entries` → `journal_entry_lines` → `accounts`; groups by `date_trunc(interval, date)`; revenue = sum(credit−debit) income accounts; expenses = sum(debit−credit) expense accounts; cash movement = sum(debit−credit) for asset codes 1000, 1010, 1020, 1100; net profit = revenue − expenses.

## Verification

- Revenue equals income ledger totals for the bucket.
- Expenses equals expense ledger totals for the bucket.
- Net profit = revenue − expenses.
- Over a full accounting period, aggregated v2 totals can be compared to P&L report totals for the same period.
- API supports 365-day range with `interval=day` (indexed on `journal_entries(business_id, date)`).
