# P0 scalability migration readiness

This document covers migrations **497–501** (P0 remediation + P1 dashboard). Apply them to **staging before load testing** and to **production before** deploying API routes that call the new RPCs.

## Migration list

| # | File | Type | Data impact |
|---|------|------|-------------|
| 497 | `497_dashboard_cash_collected_rpc.sql` | `CREATE OR REPLACE FUNCTION` | None — read-only RPC |
| 498 | `498_operational_overdue_invoices_rpc.sql` | `CREATE OR REPLACE FUNCTION` | None — read-only RPC |
| 499 | `499_scalability_p0_indexes.sql` | `CREATE INDEX IF NOT EXISTS` × 7 | None — indexes only |
| 500 | `500_dashboard_timeline_rpc.sql` | `CREATE OR REPLACE FUNCTION` | None — read-only RPC |
| 501 | `501_dashboard_service_metrics_rpc.sql` | `CREATE OR REPLACE FUNCTION` | None — read-only RPC |

## What each migration does

### 497 — `get_cash_collected_total`

- **Function:** `public.get_cash_collected_total(p_business_id uuid, p_start_date date, p_end_date date) → numeric`
- **Security:** `SECURITY INVOKER`, `STABLE`
- **Logic:** Sums **debit** amounts on cash/bank accounts with codes `1000`, `1010`, `1020`, `1030` for the business and inclusive date range.
- **Idempotent:** Yes — `CREATE OR REPLACE FUNCTION` is safe to re-run.
- **Grants:** `EXECUTE` to `authenticated`.

**API dependency:**

- `GET /api/dashboard/service-metrics` — calls `supabase.rpc("get_cash_collected_total", …)`.

**Failure mode if missing:** Dashboard metrics load; `cashCollected` falls back to `0` and logs RPC error (route does not 500).

---

### 498 — `get_operational_overdue_invoices_page`

- **Function:** `public.get_operational_overdue_invoices_page(p_business_id, p_limit, p_offset, p_customer_id?, p_start_date?, p_end_date?, p_search?) → jsonb`
- **Returns:** `{ "total_count": number, "invoice_ids": string[] }`
- **Security:** `SECURITY INVOKER`, `STABLE`
- **Logic:** Operational overdue filter — outstanding = `invoice.total − payments − applied credit_notes`, overdue when outstanding > 0 and `due_date < today`. Paginates in SQL.
- **Idempotent:** Yes — `CREATE OR REPLACE FUNCTION`.
- **Grants:** `EXECUTE` to `authenticated`.

**API dependency:**

- `GET /api/invoices/list?status=overdue` — calls `supabase.rpc("get_operational_overdue_invoices_page", …)`.

**Failure mode if missing:** Overdue invoice list returns **500** (RPC error).

**Note:** `get_ar_balances_by_invoice` is **not** used here — it is period-scoped ledger AR, not operational all-time outstanding.

---

### 499 — P0 indexes

All statements use `CREATE INDEX IF NOT EXISTS` (no drops, no table rewrites).

| Index | Table | Columns |
|-------|-------|---------|
| `idx_business_users_user_id` | `business_users` | `(user_id)` |
| `idx_businesses_owner_id_active` | `businesses` | `(owner_id) WHERE archived_at IS NULL` |
| `idx_expenses_business_date_desc` | `expenses` | `(business_id, date DESC) WHERE deleted_at IS NULL` |
| `idx_payments_business_date_desc` | `payments` | `(business_id, date DESC) WHERE deleted_at IS NULL` |
| `idx_journal_entries_business_period` | `journal_entries` | `(business_id, period_id)` |
| `idx_payroll_runs_business_month_status` | `payroll_runs` | `(business_id, payroll_month, status) WHERE deleted_at IS NULL` |
| `idx_audit_logs_business_entity_created` | `audit_logs` | `(business_id, entity_type, entity_id, created_at DESC)` |

**API dependency:** None direct — improves auth lookups, list filters, period/report queries.

**Failure mode if missing:** No functional breakage; slower queries under load.

---

### 500 — `get_service_dashboard_timeline`

- **Function:** `public.get_service_dashboard_timeline(p_business_id, p_start_date, p_end_date, p_granularity, p_periods_limit) → TABLE`
- **Security:** `SECURITY INVOKER`, `STABLE`
- **Logic:** One ledger aggregation for the last N accounting periods (default granularity `accounting_period`). Same movement sign rules as `get_profit_and_loss_movement`.
- **Idempotent:** Yes — `CREATE OR REPLACE FUNCTION`.

**API dependency:**

- `GET /api/dashboard/service-timeline` — single RPC call (replaces N× P&L).

**Failure mode if missing:** HTTP 500 `"Could not load dashboard timeline"`.

See `docs/scalability/dashboard-timeline-consolidation.md`.

---

### 501 — `get_service_dashboard_metrics`

- **Function:** `public.get_service_dashboard_metrics(p_business_id, p_start_date, p_end_date, p_position_as_of_date, p_compare_start_date, p_compare_end_date) → jsonb`
- **Security:** `SECURITY INVOKER`, `STABLE`
- **Logic:** Consolidates P&L movement, cash collected (497), and balance-sheet positions (486) for dashboard KPIs. Optional previous-period comparison in one call.
- **Idempotent:** Yes — `CREATE OR REPLACE FUNCTION`.

**API dependency:**

- `GET /api/dashboard/service-metrics` — single metrics RPC (replaces P&L + balance sheet + cash fan-out).

**Failure mode if missing:** HTTP 500 `"Could not load dashboard metrics"`.

See `docs/scalability/dashboard-service-metrics-consolidation.md`.

---

## RPC name verification (app ↔ database)

| App `supabase.rpc(...)` | Migration function | Match |
|-------------------------|-------------------|-------|
| `"get_cash_collected_total"` | `get_cash_collected_total` | Yes |
| `"get_operational_overdue_invoices_page"` | `get_operational_overdue_invoices_page` | Yes |
| `"get_service_dashboard_timeline"` | `get_service_dashboard_timeline` | Yes |
| `"get_service_dashboard_metrics"` | `get_service_dashboard_metrics` | Yes |

Parameter names in app code use `p_business_id`, `p_start_date`, `p_end_date`, `p_limit`, `p_offset`, etc. — aligned with migration signatures.

---

## Apply order (staging / production)

1. **496** (if not already applied) — prior CIT work on branch.
2. **497** — cash collected RPC.
3. **498** — overdue invoices RPC (**required** before overdue list fix works).
4. **499** — indexes (can run in parallel with 497/498; safe anytime after schema exists).
5. **500** — dashboard timeline RPC (**required** before P1 timeline route deploy).
6. **501** — dashboard service metrics RPC (**required** before P1 metrics route deploy).

### Staging

```bash
# From repo root, linked to staging project
supabase db push

# Or apply individually via SQL editor / migration runner
```

### Production

1. Apply migrations during a low-traffic window.
2. **499** may take several minutes on large tables (`journal_entry_lines` indirect benefit via `journal_entries`; index builds are non-destructive but IO-heavy).
3. Deploy app **after** 497 and 498 are live (or deploy app + migrations together in one release).

### Post-apply verification (SQL)

```sql
-- RPCs exist
SELECT proname FROM pg_proc
WHERE proname IN (
  'get_cash_collected_total',
  'get_operational_overdue_invoices_page',
  'get_service_dashboard_timeline',
  'get_service_dashboard_metrics'
);

-- Smoke RPC (replace UUIDs and dates)
SELECT get_cash_collected_total(
  '<business_id>'::uuid, '2026-01-01'::date, '2026-06-30'::date
);

SELECT get_operational_overdue_invoices_page(
  '<business_id>'::uuid, 25, 0, NULL, NULL, NULL, NULL
);

SELECT * FROM get_service_dashboard_timeline(
  '<business_id>'::uuid, NULL, NULL, 'accounting_period', 6
);

SELECT get_service_dashboard_metrics(
  '<business_id>'::uuid,
  '2026-06-01'::date,
  '2026-06-30'::date,
  CURRENT_DATE,
  NULL,
  NULL
);

-- Indexes exist
SELECT indexname FROM pg_indexes
WHERE indexname LIKE 'idx_business_users_user_id'
   OR indexname LIKE 'idx_journal_entries_business_period';
```

---

## Rollback considerations

| Migration | Rollback | Risk |
|-----------|----------|------|
| 497 | `DROP FUNCTION get_cash_collected_total(uuid, date, date);` | Dashboard `cashCollected` reverts to 0 until app rolled back or function restored. No data loss. |
| 498 | `DROP FUNCTION get_operational_overdue_invoices_page(uuid, int, int, uuid, date, date, text);` | **Overdue invoice list breaks** until app rolled back to pre-P0 path or function restored. |
| 499 | `DROP INDEX IF EXISTS …` per index | Performance regression only. Dropping indexes is instant; rebuilding may be slow if re-applied. |
| 500 | `DROP FUNCTION get_service_dashboard_timeline(uuid, date, date, text, int);` | Timeline chart breaks until app rolled back or function restored. |
| 501 | `DROP FUNCTION get_service_dashboard_metrics(uuid, date, date, date, date, date);` | Dashboard KPIs break until app rolled back or function restored. |

**Recommended rollback:** Revert app deployment first, then drop RPCs only if necessary. Keep indexes unless they cause a proven planner regression (unlikely).

---

## Load-test gate

Do **not** run the k6 workday suite against staging until:

- [ ] Migrations 497, 498, 499, **500**, **501** applied
- [ ] RPC smoke queries succeed for the load-test `businessId`
- [ ] `GET /api/invoices/list?status=overdue&page=1&limit=25` returns 200
- [ ] `GET /api/dashboard/service-metrics?business_id=…` returns 200 with `cashCollected` field
- [ ] `GET /api/dashboard/service-timeline?business_id=…&periods=6` returns 200 with `timeline` array

See `load-tests/README.md` and `docs/scalability/load-test-seed-plan.md`.

---

## Staging Supabase project created

Use this checklist when standing up a **new** staging Supabase project (separate from production Finza Pro).

| Step | Done? | Notes |
|------|-------|-------|
| New Supabase project (unique ref) | ☐ | Never reuse production keys |
| `.env.staging` from `.env.staging.example` | ☐ | Gitignored; placeholders only in example |
| Vercel Preview/Staging env vars | ☐ | Same keys as `.env.staging` |
| `FINZA_PRODUCTION_SUPABASE_PROJECT_REF` set | ☐ | Blocks seed scripts against prod ref |
| `FINZA_PRODUCTION_APP_URLS` includes `app.finza.africa` | ☐ | Blocks k6/seed against production URL |
| Full migration chain on staging DB | ☐ | `supabase db push` or MCP/SQL editor |
| Migrations **497–501** applied | ☐ | Idempotent `CREATE OR REPLACE` / `IF NOT EXISTS` |
| SQL smoke for staging `business_id` | ☐ | See Post-apply verification below |
| Staging app deployed (preview URL) | ☐ | Not `app.finza.africa` |
| `load-tests/sessions.staging.json` | ☐ | Real cookies; gitignored |
| k6 smoke (`SCENARIO=smoke`) | ☐ | Against staging URL only |

**Setup guide:** [`docs/staging/setup.md`](../staging/setup.md)

**Env template:** [`.env.staging.example`](../../.env.staging.example) at repo root

**Seed (Phase 1):** [`scripts/seed-staging-load-tenant.mjs`](../../scripts/seed-staging-load-tenant.mjs) + [`docs/staging/seed-load-tenant.md`](../staging/seed-load-tenant.md)

### Staging-only env vars (minimum)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Staging project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Server/admin (never expose to browser) |
| `NEXT_PUBLIC_APP_URL` | Staging/preview origin (k6 `BASE_URL`) |
| `FINZA_PRODUCTION_SUPABASE_PROJECT_REF` | Production ref for script guardrails |
| `ALLOW_STAGING_LOAD_SEED` | Must be `true` to run seed script |

### Payments / email on staging

| Variable | Recommended staging value |
|----------|---------------------------|
| `FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED` | `false` |
| `HUBTEL_ENABLED` | `false` |
| `PAYSTACK_SECRET_KEY` | Test key only or empty |
| `RESEND_API_KEY` | Empty (no email) or Resend test |

### Migration chain verification (497–501)

| Check | Status |
|-------|--------|
| RPC names match app routes | Pass — see RPC table above |
| SQL idempotent | Pass — `CREATE OR REPLACE FUNCTION`, `CREATE INDEX IF NOT EXISTS` |
| No destructive ops | Pass — no `DROP TABLE`, `DELETE`, `TRUNCATE` in 497–501 |
| No production-only data deps | Pass — functions query tenant tables by `p_business_id` |
| 501 deps: `get_balance_sheet_as_of` (486), `get_cash_collected_total` (497) | Required on staging before 501 |

Apply **497 → 498 → 499 → 500 → 501** on staging. If staging is a fresh clone, apply full migration history first (`supabase db push`).
