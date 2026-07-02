# Staging load tenant seed

**Staging Supabase only** (`adonhhtooawkeemdqqeo`). Fake data for load-test smoke — not production.

| Phase | Script | Purpose |
|-------|--------|---------|
| **1** | [`scripts/seed-staging-load-tenant.mjs`](../../scripts/seed-staging-load-tenant.mjs) | Customers + accounting periods |
| **1.5** | [`scripts/seed-staging-accounting-setup.mjs`](../../scripts/seed-staging-accounting-setup.mjs) | COA sync + control mappings (AR/AP/CASH/BANK) |
| **2** | [`scripts/seed-staging-load-tenant-phase2.mjs`](../../scripts/seed-staging-load-tenant-phase2.mjs) | Invoices, payments, bills, expenses (ledger triggers) |

Phase 2 requires Phase 1.5. Phase 1 alone creates periods but **does not** populate `chart_of_accounts` / `chart_of_accounts_control_map`; posting invoices without Phase 1.5 fails with `Missing control account mapping: AR`.

---

## Required order

```text
Phase 1 customers + periods
Phase 1.5 accounting foundation
Phase 2 invoices/payments/bills/expenses/journal-trigger data
SQL smoke
sessions.staging.json
k6 smoke
workday_50 only if smoke passes
```

### Commands (staging terminal)

```powershell
$env:ALLOW_STAGING_LOAD_SEED = "true"

# Phase 1
node scripts/seed-staging-load-tenant.mjs --apply --business-id=<uuid>

# Phase 1.5 (required before Phase 2)
node scripts/seed-staging-accounting-setup.mjs --apply --business-id=<uuid>

# Phase 2
node scripts/seed-staging-load-tenant-phase2.mjs --apply --business-id=<uuid>
```

Phase 1.5 calls `ensure_accounting_initialized_system` (service_role RPC). It is idempotent and preserves existing accounting periods from Phase 1.

---

## Initial smoke target (before 5,000-invoice campaign)

| Entity | Count | Notes |
|--------|------:|-------|
| Businesses | 1 | Service industry, accounting initialized |
| Users | 1+ | Owner via staging signup |
| Customers | 50 | Phase 1 script |
| Invoices | 500 | Phase 2 script |
| Payments | 200 | Linked to invoices |
| Expenses | 200 | With ledger posting |
| Bills | 100 | Open/paid mix |
| Accounting periods | 12 | Phase 1 script |
| Journal lines | Enough for dashboard RPCs | Via posting triggers |

Do **not** seed 5,000 invoices until k6 smoke passes on this smaller dataset.

---

## Prerequisites

- Staging migrations **497–501** applied
- [`docs/staging/setup.md`](./setup.md) complete
- `STAGING_LOAD_BUSINESS_ID` set (from onboarding or script output)
- `ALLOW_STAGING_LOAD_SEED=true` only when running seed scripts
- `NEXT_PUBLIC_SUPABASE_URL` must resolve to staging ref `adonhhtooawkeemdqqeo`

---

## Phase 1.5 verification

After Phase 1.5, for the load-test `business_id`:

- `accounts` count ≥ 1
- `chart_of_accounts` count ≥ 1
- `chart_of_accounts_control_map` contains `AR`, `AP`, `CASH`, `BANK`
- `accounting_periods` count ≥ 1 (Phase 1 periods unchanged)

Dry-run: `node scripts/seed-staging-accounting-setup.mjs --dry-run --business-id=<uuid>`

---

## SQL batch outline (optional manual bulk — staging only)

Replace `:business_id` with your staging load-test business UUID. Prefer Phase 2 script for ledger-aware inserts.

### Customers (if not using Phase 1 script)

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

### Overdue subset (Phase 2 script)

Ensure some invoices have `due_date < CURRENT_DATE` and partial/no payments so `get_operational_overdue_invoices_page` returns rows.

---

## Cleanup

Delete the fake tenant by `business_id` on staging only, or drop/recreate staging project between campaigns. Posted journal entries are immutable; prefer idempotent rerun over delete.

---

## After seed

1. Run SQL smoke from [`setup.md`](./setup.md).
2. Update `load-tests/sessions.staging.json` with staging `businessId`.
3. k6 smoke against staging URL only.
4. `workday_50` operational gate: `WORKDAY_SKIP_REPORTS=1` (proven). Keep `FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST` **unset or `0`** (cluster reads summary/cache only). Prime dashboard summaries before k6 if needed (`scripts/audit-staging-dashboard-timeline.mjs`). Realistic mixed gate: `SCENARIO=workday_50_plus_reports_5` (see `load-tests/README.md`).
