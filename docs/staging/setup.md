# Finza staging setup

Use a **separate Supabase project** for staging. Do not share credentials, data, or migrations workflow with production (Finza Pro / `app.finza.africa`).

## Checklist

1. Create Supabase **staging** project (new project ref).
2. Copy `.env.staging.example` → `.env.staging` (gitignored); fill staging values only.
3. Set the same variables on **Vercel Preview / Staging** environment (not Production).
4. Link repo branch or deploy preview URL — **never** point k6 or load tests at `app.finza.africa`.
5. Apply migrations through **496** (or full chain from empty DB) then **497–501**.
6. Onboard or seed one fake service business; capture `businessId`.
7. Create `load-tests/sessions.staging.json` with staging cookies.
8. Run k6 smoke with `SCENARIO=smoke` against staging URL only.

---

## 1. Required Vercel environment variables

Set on **Preview** and/or a dedicated **Staging** environment — not Production unless intentionally promoting.

| Variable | Required | Staging notes |
|----------|----------|---------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Staging project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Staging anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Staging service role — server only |
| `NEXT_PUBLIC_APP_URL` | Yes | Staging/preview origin (no trailing slash) |
| `NEXT_PUBLIC_SITE_URL` | Optional | Match `NEXT_PUBLIC_APP_URL` if used |
| `PAYSTACK_SECRET_KEY` | Optional | **Test** key only (`sk_test_…`) |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Optional | **Test** key only |
| `FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED` | Recommended | `false` unless testing Paystack test mode |
| `HUBTEL_ENABLED` | Recommended | `false` |
| `HUBTEL_MODE` | If Hubtel used | `test` |
| `HUBTEL_CLIENT_ID` / `HUBTEL_CLIENT_SECRET` | If testing | Sandbox credentials only |
| `RESEND_API_KEY` | Optional | Empty = no outbound email; or Resend test |
| `RESEND_FROM` | If email testing | Use Resend test sender |
| `TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY` | If tenant payments UI tested | Staging-only 32-byte key |
| `CRON_SECRET` | If cron routes enabled | Staging-only random secret |

Full template: [`.env.staging.example`](../../.env.staging.example) at repo root.

---

## 2. Required Supabase staging values

From **Supabase Dashboard → Project Settings → API**:

| Value | Env var |
|-------|---------|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| anon public | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| service_role | `SUPABASE_SERVICE_ROLE_KEY` |
| Project ref | Used in `supabase link --project-ref` |
| Database URI | `DATABASE_URL` (CLI / SQL tools only) |

**Production blocklist (local scripts):**

| Variable | Purpose |
|----------|---------|
| `FINZA_PRODUCTION_SUPABASE_PROJECT_REF` | Refuse seed/scripts if URL matches |
| `FINZA_PRODUCTION_APP_URLS` | Comma-separated hosts to refuse (e.g. `app.finza.africa`) |

---

## 3. Separate Supabase project (mandatory)

- Staging must use its **own** project ref, keys, and database.
- Do not run `supabase db push` while linked to production.
- Do not copy production rows into staging without sanitization.
- k6, seed scripts, and SQL smoke use **staging `business_id` only**.

---

## 4. Payments & email — test-only or disabled

| Integration | Staging default |
|-------------|-----------------|
| Paystack | Test keys only; disable tenant checkout unless explicitly testing |
| Hubtel | `HUBTEL_ENABLED=false`; sandbox credentials if needed |
| Resend | Empty `RESEND_API_KEY` or test domain; no customer inboxes |
| MTN MoMo | Sandbox env vars only if testing subscriptions |

Never use production Paystack/Hubtel/Resend credentials on staging.

---

## 5. Deploy staging / preview

### Option A — Vercel preview (branch deploy)

1. Push to staging branch (e.g. `staging` or feature branch).
2. Vercel builds preview with **Preview** env vars pointing at staging Supabase.
3. Use preview URL as `NEXT_PUBLIC_APP_URL` and k6 `BASE_URL`.

### Option B — Dedicated Vercel Staging environment

1. Create Vercel **Staging** environment.
2. Attach staging Supabase env vars to Staging only.
3. Deploy branch → staging URL (custom domain or `*.vercel.app`).

### Local against staging Supabase

```powershell
# From repo root — use .env.staging (gitignored), not production .env.local
Copy-Item .env.staging.example .env.staging
# Edit .env.staging with staging keys

# Next.js reads .env.local by default; for staging-only local run either:
#   - temporarily copy .env.staging → .env.local (do NOT commit), or
#   - use a tool that loads .env.staging before npm run dev
npm run dev
```

---

## 6. Apply migrations 497–501

Apply to **staging Supabase only**, after base schema exists (migrations through ~491+ on a fresh project, or full `supabase db push` from repo).

### Option A — Supabase CLI

Install CLI, then from repo root:

```powershell
supabase login
supabase link --project-ref YOUR_STAGING_PROJECT_REF
supabase db push
```

Verify versions 497–501 applied (or re-run idempotent SQL if already partially applied).

### Option B — Manual SQL / Supabase MCP

Apply in order from `supabase/migrations/`:

1. `497_dashboard_cash_collected_rpc.sql`
2. `498_operational_overdue_invoices_rpc.sql`
3. `499_scalability_p0_indexes.sql`
4. `500_dashboard_timeline_rpc.sql`
5. `501_dashboard_service_metrics_rpc.sql`

Migration **501** requires `get_balance_sheet_as_of` (486) and `get_cash_collected_total` (497).

### Post-apply SQL smoke

Replace `<business_id>` with a staging service business UUID:

```sql
SELECT get_cash_collected_total(
  '<business_id>'::uuid,
  '2026-06-01'::date,
  '2026-06-30'::date
);

SELECT get_operational_overdue_invoices_page(
  '<business_id>'::uuid,
  25,
  0
);

SELECT * FROM get_service_dashboard_timeline(
  '<business_id>'::uuid,
  NULL,
  NULL,
  'accounting_period',
  6
);

SELECT get_service_dashboard_metrics(
  '<business_id>'::uuid,
  '2026-06-01'::date,
  '2026-06-30'::date,
  CURRENT_DATE,
  NULL,
  NULL
);
```

See also [`docs/scalability/p0-migration-readiness.md`](../scalability/p0-migration-readiness.md).

---

## 7. Staging load tenant seed

**Phase 1 (safe script):** customers + accounting periods for an existing business.

```powershell
# Requires .env.staging with staging Supabase + blocklist vars
$env:ALLOW_STAGING_LOAD_SEED = "true"
node scripts/seed-staging-load-tenant.mjs --dry-run
node scripts/seed-staging-load-tenant.mjs --apply
```

**Phase 2 (manual / SQL):** invoices, payments, journal lines — see [`seed-load-tenant.md`](./seed-load-tenant.md).

Preferred path for first smoke: **onboard one service business** via staging UI, then run SQL smoke + k6.

---

## 8. Create `load-tests/sessions.staging.json`

File is **gitignored**. Never commit real cookies.

1. Deploy staging app; log in as a user with access to the load-test business.
2. Open DevTools → **Application** → **Cookies** → your **staging** domain (not `app.finza.africa`).
3. Copy Supabase auth cookies (e.g. `sb-<staging-ref>-auth-token=…`).
4. Create `load-tests/sessions.staging.json`:

```json
[
  {
    "label": "staging-load-user-1",
    "businessId": "YOUR-STAGING-BUSINESS-UUID",
    "cookie": "sb-STAGING-REF-auth-token=...; ..."
  }
]
```

5. `businessId` must match the seeded or onboarded staging business.

Template: [`load-tests/sessions.example.json`](../../load-tests/sessions.example.json).

---

## 9. k6 smoke (staging URL only)

**Do not** use `https://app.finza.africa` for k6.

Paths in `SESSIONS_JSON` are relative to `load-tests/finza-service-workday.js`.

```powershell
$env:SCENARIO = "smoke"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://YOUR-STAGING-URL" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  load-tests/finza-service-workday.js
```

Harness refuses `sessions.example.json` and placeholder cookies. Run `workday_50` only after smoke passes.

Details: [`load-tests/README.md`](../../load-tests/README.md).

---

## 10. Related docs

- [`docs/scalability/p0-migration-readiness.md`](../scalability/p0-migration-readiness.md)
- [`docs/scalability/load-test-seed-plan.md`](../scalability/load-test-seed-plan.md)
- [`docs/staging/seed-load-tenant.md`](./seed-load-tenant.md)
