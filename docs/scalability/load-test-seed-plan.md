# Load-test seed plan — heavy Finza tenant (staging only)

**Do not run against production.** Use a dedicated staging Supabase project or an isolated staging business created for performance testing.

## Target dataset

| Entity | Count | Notes |
|--------|------:|-------|
| Businesses | 1 | Ghana service industry, accounting initialized |
| Users | 5 | 1 owner + 4 `business_users` (mixed roles) |
| Customers | 500 | Spread `created_at` over 24 months |
| Invoices | 5,000 | ~70% sent/paid, ~20% partial, ~10% overdue |
| Payments | 2,000 | Linked to invoices |
| Expenses | 2,000 | With ledger posting where applicable |
| Journal entry lines | 20,000 | Via invoices, payments, expenses, payroll |
| Accounting periods | 24 | Monthly, 2 years |
| Staff | 50 | Active |
| Payroll runs | 12 | Monthly, approved + ledger posted |
| Bills | 500 | Mix of open/paid/overdue |
| Audit logs | 1,000 | Representative entity types |

This approximates a **mature Ghana SME** after 2 years on Finza — the shape that exposed P0 bottlenecks.

---

## Prerequisites

- Staging app URL (preview/staging only — not `app.finza.africa`) — see `docs/staging/setup.md`
- Migrations **through 501** applied
- Service workspace **Professional** tier (bills, payroll)
- Accounting bootstrap complete for the test business
- Chart of accounts + 24 closed/open periods

---

## Approach (no destructive repo seed yet)

This repo does **not** have a committed bulk seed convention. Use one of:

### Option A — Staging setup + Phase 1 script (recommended)

See [`docs/staging/setup.md`](../staging/setup.md) and [`docs/staging/seed-load-tenant.md`](../staging/seed-load-tenant.md).

```powershell
$env:ALLOW_STAGING_LOAD_SEED = "true"
node scripts/seed-staging-load-tenant.mjs --apply --business-id=<staging-uuid>
```

### Option B — Manual staging business (fastest for first smoke)

1. Create one service business via normal onboarding.
2. Use Supabase SQL editor **on staging only** with batched inserts (see outline below).
3. Run `post_invoice_to_ledger` / payment triggers only if inserting finalized invoices (prefer Finza APIs for first 100 rows, SQL for bulk).

### Option C — SQL batches (Phase 2 bulk)

See [`docs/staging/seed-load-tenant.md`](../staging/seed-load-tenant.md) for invoice/payment/journal SQL outline.

### Option D — Restore from anonymized dump

Export a sanitized staging snapshot after Option A completes once; restore before each load-test campaign.

---

## SQL seed outline (staging SQL editor)

Replace `:business_id` and run in batches (500–1000 rows per statement) to avoid timeouts.

### 1. Customers (500)

```sql
INSERT INTO customers (business_id, name, email, created_at)
SELECT
  :business_id,
  'Load Test Customer ' || g,
  'loadtest+c' || g || '@example.invalid',
  NOW() - (g || ' days')::interval
FROM generate_series(1, 500) g;
```

### 2. Invoices (5,000)

Distribute statuses and due dates so ~500 are operationally overdue (past `due_date`, partial payment):

- 3,500 `status = 'sent'`, fully paid via payments
- 1,000 partial payments → operational outstanding > 0
- 500 overdue subset: `due_date < CURRENT_DATE`, outstanding > 0

Use `issue_date` spread across 24 months. Prefer issuing through API for first slice to validate ledger; bulk SQL only if triggers/RPCs are understood.

### 3. Payments (2,000)

```sql
-- Example pattern: attach payments to subset of invoices
INSERT INTO payments (business_id, invoice_id, amount, date, method, created_at)
SELECT ...
```

### 4. Expenses (2,000)

Insert with `business_id`, `date`, amounts; allow `post_expense_to_ledger` trigger to run or batch post via existing RPCs.

### 5. Accounting periods (24)

```sql
INSERT INTO accounting_periods (business_id, period_start, period_end, status)
SELECT
  :business_id,
  (date_trunc('month', NOW()) - (n || ' months')::interval)::date,
  (date_trunc('month', NOW()) - (n || ' months')::interval + interval '1 month - 1 day')::date,
  CASE WHEN n > 1 THEN 'closed' ELSE 'open' END
FROM generate_series(0, 23) n;
```

### 6. Journal volume (20,000 lines)

Target via normal posting flows. If backfilling: ensure `journal_entries.business_id` and `period_id` align with migration 499 index.

### 7. Staff (50) + payroll runs (12)

Insert `staff` rows, then create 12 `payroll_runs` via `POST /api/payroll/runs` (validates Ghana payroll path under load).

### 8. Bills (500)

Insert with `issue_date`, `total`, `status`; verify `GET /api/bills/list?page=1&limit=50` pagination.

### 9. Audit logs (1,000)

```sql
INSERT INTO audit_logs (business_id, user_id, action_type, entity_type, entity_id, created_at)
SELECT :business_id, :owner_user_id, 'update', 'invoice', i.id, i.created_at
FROM invoices i
WHERE i.business_id = :business_id
LIMIT 1000;
```

---

## Load-test users and sessions

Create **5** auth users in Supabase Auth (staging):

| User | Role | Purpose |
|------|------|---------|
| `load-owner@example.invalid` | Owner | Full dashboard + reports |
| `load-admin@example.invalid` | Admin | Invoices, bills |
| `load-accountant@example.invalid` | Accountant read | P&L route |
| `load-staff-1@example.invalid` | Limited | Permission boundary |
| `load-staff-2@example.invalid` | Limited | Concurrency mix |

For k6, export **5 session cookies** (one per user) into `load-tests/sessions.staging.json` — see `load-tests/README.md`.

Map each session to the same `businessId` (single-tenant heavy load) or split businesses for multi-tenant tests.

---

## Validation checklist (before k6)

| Check | Command / action |
|-------|------------------|
| Invoice count | `SELECT COUNT(*) FROM invoices WHERE business_id = :id AND deleted_at IS NULL` → ~5000 |
| Overdue RPC | `SELECT get_operational_overdue_invoices_page(:id, 25, 0, NULL, NULL, NULL, NULL)` |
| Cash RPC | `SELECT get_cash_collected_total(:id, period_start, period_end)` |
| Bills bounded | `GET /api/bills/list` → ≤50 rows default |
| Indexes | `499` indexes present in `pg_indexes` |

---

## Cleanup (staging)

- Prefer **delete staging project business** or drop test business by `id` if isolated.
- Do not run bulk deletes in production.
- Rotate auth passwords / invalidate sessions after test campaign.

---

## Related docs

- `docs/scalability/p0-migration-readiness.md`
- `load-tests/README.md`
- `docs/scalability/p0-load-test-report-template.md`
