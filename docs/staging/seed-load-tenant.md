# Staging load tenant seed (Phase 2)

**Staging Supabase only.** Fake data for load-test smoke — not production.

Phase 1 (customers + periods) is handled by [`scripts/seed-staging-load-tenant.mjs`](../../scripts/seed-staging-load-tenant.mjs).

Phase 2 (invoices, payments, journal lines, bills) requires ledger-aware inserts. Prefer **onboarding + Finza UI/API** for the first ~50 rows, then batched SQL for bulk.

---

## Initial smoke target (before 5,000-invoice campaign)

| Entity | Count | Notes |
|--------|------:|-------|
| Businesses | 1 | Service industry, accounting initialized |
| Users | 1+ | Owner via staging signup |
| Customers | 50 | Script or SQL |
| Invoices | 500 | Batched SQL or API |
| Payments | 200 | Linked to invoices |
| Expenses | 200 | With ledger posting |
| Bills | 100 | Open/paid mix |
| Accounting periods | 12 | Monthly |
| Journal lines | Enough for dashboard RPCs | Via posting triggers |

Do **not** seed 5,000 invoices until k6 smoke passes on this smaller dataset.

---

## Prerequisites

- Staging migrations **497–501** applied
- [`docs/staging/setup.md`](./setup.md) complete
- `STAGING_LOAD_BUSINESS_ID` set (from onboarding or script output)
- `ALLOW_STAGING_LOAD_SEED=true` only when running seed script

---

## Recommended order

1. **Onboard** one service business on staging UI (Professional tier if testing bills/payroll).
2. Complete **accounting bootstrap** (chart of accounts + periods).
3. Run **Phase 1 script** for customers + extra periods:
   ```powershell
   $env:ALLOW_STAGING_LOAD_SEED = "true"
   node scripts/seed-staging-load-tenant.mjs --apply --business-id=<uuid>
   ```
4. Create **50–100 invoices** via Finza UI or API (validates posting paths).
5. Use **SQL batches** below for bulk fake data (500 invoices, etc.).

---

## SQL batch outline (Supabase SQL editor — staging only)

Replace `:business_id` with your staging load-test business UUID. Run in batches of 200–500 rows.

### Customers (if not using script)

```sql
INSERT INTO customers (business_id, name, email, created_at)
SELECT
  :business_id::uuid,
  'Staging Load Customer ' || g,
  'staging-load-' || g || '@example.invalid',
  NOW() - (g || ' days')::interval
FROM generate_series(1, 50) g
ON CONFLICT DO NOTHING;
```

### Accounting periods (12 months)

```sql
INSERT INTO accounting_periods (business_id, period_start, period_end, status)
SELECT
  :business_id::uuid,
  (date_trunc('month', CURRENT_DATE) - (n || ' months')::interval)::date,
  ((date_trunc('month', CURRENT_DATE) - (n || ' months')::interval) + interval '1 month - 1 day')::date,
  CASE WHEN n = 0 THEN 'open' ELSE 'closed' END
FROM generate_series(0, 11) n
ON CONFLICT DO NOTHING;
```

### Invoices (draft first — finalize via app for ledger)

Bulk finalized invoices require `post_invoice_to_ledger` triggers and valid COA. For smoke:

- Create **sent** invoices with `issue_date`, `due_date`, `total`, `customer_id`, `status = 'sent'`.
- Prefer Finza **Finalize/Send** flow for first 20 rows to confirm posting.

### Overdue subset

Ensure some invoices have `due_date < CURRENT_DATE` and partial/no payments so `get_operational_overdue_invoices_page` returns rows.

### Bills

```sql
INSERT INTO bills (business_id, vendor_name, bill_number, total, status, due_date, issue_date)
SELECT
  :business_id::uuid,
  'Staging Vendor ' || g,
  'STG-BILL-' || lpad(g::text, 5, '0'),
  (random() * 500 + 50)::numeric(12,2),
  CASE WHEN g % 3 = 0 THEN 'paid' WHEN g % 3 = 1 THEN 'open' ELSE 'overdue' END,
  CURRENT_DATE + ((g % 30) - 15),
  CURRENT_DATE - (g % 60)
FROM generate_series(1, 100) g;
```

Adjust columns to match current `bills` schema before running.

---

## Cleanup

Delete the fake tenant by `business_id` on staging only, or drop/recreate staging project between campaigns.

---

## After seed

1. Run SQL smoke from [`setup.md`](./setup.md).
2. Update `load-tests/sessions.staging.json` with staging `businessId`.
3. k6 smoke against staging URL only.
