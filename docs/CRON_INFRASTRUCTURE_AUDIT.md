# Cron / Scheduled Job Infrastructure — Audit

**Purpose:** Identify existing job/cron infrastructure and recommend where to add the forensic nightly run with minimum new infra. No code or migrations in this doc.

---

## 1) What Exists Today (File Paths)

### 1.1 Vercel Cron

| Item | Status |
|------|--------|
| **vercel.json** | **Does not exist** (0 files in repo). |
| **Vercel Cron jobs** | None configured. |

**Paths checked:** Repo root and `finza-web/`; no `vercel.json` found.

---

### 1.2 GitHub Actions

| File | Triggers | Schedule? |
|------|----------|------------|
| **`.github/workflows/accounting-invariants.yml`** | `pull_request` (main, develop), `push` (main, develop), `workflow_dispatch` (optional business_id input) | **No** — no `schedule:` / `cron:` block. |

**Details:**

- Single workflow: **Accounting Invariant Checks**.
- Runs on PR/push to main/develop and on manual `workflow_dispatch`.
- **No time-based schedule** (no nightly, no cron expression).
- Steps: checkout → npm ci → ts-node `scripts/accounting-ci-audit.ts`, then `detect-report-bypass.ts`, then `detect-non-ledger-reports.ts`.
- Uses **different** audit than forensic script: `run_business_accounting_audit` RPC (period-centric Phase 11), not `forensic-accounting-verification.sql`.

**No other workflow files** under `.github/workflows/`.

---

### 1.3 Supabase Edge Functions

| Item | Status |
|------|--------|
| **supabase/functions/** | **Does not exist** — 0 files under that path. |
| **Scheduled Edge Functions** | None. |

**Paths checked:** `finza-web/supabase`; only `migrations/` and `.temp/` present; no `functions/` directory.

---

### 1.4 pg_cron (Supabase / Postgres)

| Item | Status |
|------|--------|
| **pg_cron in migrations** | **Not used** — no `pg_cron`, `cron.schedule`, or `extensions.cron` in `supabase/migrations/**/*.sql`. |
| **Scheduled DB jobs** | None. |

**Note:** pg_cron is mentioned only in design docs (`BACKGROUND_JOB_FORENSIC_ACCOUNTING_DESIGN.md`, `SCHEDULED_JOB_TRIAL_BALANCE_VERIFICATION_DESIGN.md`), not in implemented migrations.

---

### 1.5 Internal Cron Routes (Next.js API)

| File | Purpose | Auth pattern |
|------|---------|--------------|
| **`app/api/reminders/process-automated/route.ts`** | Automated invoice reminders (overdue reminders). Intended to be called by “a cron job or scheduled task”. | **Optional** `REMINDER_API_KEY`: if set, requires `Authorization: Bearer <REMINDER_API_KEY>`. No other cron route found. |

**Details:**

- Comments reference: “Vercel Cron: Add to vercel.json”, “External service: Call POST … with API key”, “Supabase Edge Functions: Set up scheduled function”.
- No `vercel.json` exists, so nothing currently calls this route on a schedule in-repo.
- This is the **only** API route in the repo that is explicitly designed as a cron-invoked endpoint.

**No other routes** under `app/api/` are named or documented as cron/scheduled (e.g. no `/api/cron/*` routes exist).

---

### 1.6 Summary Table

| Infrastructure | Exists? | File path(s) |
|----------------|---------|--------------|
| **Vercel Cron** | No | — (no vercel.json) |
| **GitHub Actions schedule** | No | `.github/workflows/accounting-invariants.yml` (no schedule block) |
| **Supabase Edge Functions** | No | — (no supabase/functions) |
| **pg_cron** | No | — (not in migrations) |
| **Cron-style API route** | Yes (one) | `app/api/reminders/process-automated/route.ts` |

---

## 2) Best Place to Add the Forensic Nightly Run (Minimum New Infra)

**Constraint:** Add the forensic nightly run with **minimum new infrastructure**.

**Options compared:**

| Option | New infra | Notes |
|--------|-----------|--------|
| **A. Vercel Cron + new API route** | New `vercel.json` + new route (e.g. `/api/cron/forensic-accounting`) | Adds scheduler + one route; Vercel Cron is built-in once app is on Vercel. |
| **B. GitHub Actions scheduled workflow** | One new workflow (or new job in existing) with `schedule: - cron: '0 2 * * *'` | No new app code for scheduling; uses existing CI runner and secrets. **No new platform.** |
| **C. Supabase Edge Function + schedule** | New `supabase/functions/` + Supabase scheduler config | New platform surface (Edge Functions); not present today. |
| **D. pg_cron in Supabase** | New migration enabling pg_cron + job that calls HTTP or does work in DB | New migration + DB scheduler; forensic script is multi-SELECT, better run from app or script. |

**Recommendation: Option B — GitHub Actions scheduled workflow.**

Reasons:

1. **Nothing new to install:** You already use GitHub Actions for accounting-invariants; only add a **schedule** (and optionally a new workflow or job).
2. **Same secrets:** Reuse `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (and optionally `CI_TEST_BUSINESS_ID` or leave unset for “all businesses” if the forensic runner supports it). No new cron-specific secret required if the job runs the forensic script via Supabase (e.g. ts-node script or RPC that runs the checks).
3. **No app deployment change:** No vercel.json, no new API route, no Edge Functions. The forensic runner can be a **script** (e.g. `scripts/forensic-accounting-nightly.ts`) that the workflow runs with `npx ts-node`, talking to Supabase via env (same as `accounting-ci-audit.ts`).
4. **Clear separation:** Nightly forensic run is “scheduled CI-style job”; reminders remain “cron-invoked API” for when you later add Vercel Cron or an external cron.

**Concrete “minimum” shape:**

- **New workflow file** (e.g. `.github/workflows/forensic-accounting-nightly.yml`) **or** a new job in an existing workflow, with:
  - `on: schedule: - cron: '0 2 * * *'` (02:00 UTC daily)
  - Same pattern as accounting-invariants: checkout, npm ci, ts-node (or sql runner) for forensic script; env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Forensic execution:** Either:
  - A **new script** (e.g. `scripts/forensic-accounting-nightly.ts`) that runs the forensic SQL (section-by-section via Supabase client or a single RPC if you add one) and writes to `accounting_invariant_failures` / sends alerts per your design, or
  - Invoke an **API route** from the workflow via `curl`/`fetch` if you later add `POST /api/cron/forensic-accounting` and protect it with a secret (see below).

So: **best place = GitHub Actions with a scheduled workflow (or scheduled job), invoking a script or (later) an API route.** No Vercel Cron, no Edge Functions, no pg_cron required for the forensic nightly run.

---

## 3) What Secrets / Env Already Exist for Cron Auth

### 3.1 In Use Today

| Secret / env | Where used | Purpose |
|--------------|------------|--------|
| **SUPABASE_URL** | GitHub Actions (accounting-invariants.yml), tests, app | Supabase project URL. |
| **SUPABASE_SERVICE_ROLE_KEY** | GitHub Actions (accounting-invariants.yml), tests, app (e.g. sales create, overrides, reminders backend) | Service role for RLS bypass / server-side and CI. |
| **CI_TEST_BUSINESS_ID** | GitHub Actions (accounting-invariants.yml) | Optional business for invariant audit. |
| **REMINDER_API_KEY** | `app/api/reminders/process-automated/route.ts` | Optional: if set, cron caller must send `Authorization: Bearer <REMINDER_API_KEY>`. Documented in `docs/AUTOMATED_REMINDERS.md`. |

**GitHub secrets (from workflow):**  
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CI_TEST_BUSINESS_ID` are referenced; they must be configured in the repo’s GitHub Actions secrets.

### 3.2 No Dedicated “Cron Secret” Yet

- **CRON_SECRET / FORENSIC_CRON_SECRET:** Not present in codebase; only mentioned in design docs.
- **Vercel cron auth:** No vercel.json, so no Vercel cron token in use.

### 3.3 Implications for the Forensic Nightly Run

- **If the nightly run is a GitHub Actions job** that runs a script (e.g. ts-node) and talks to Supabase directly: **no new secret.** Use existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the workflow env.
- **If you later add an API route** (e.g. `POST /api/cron/forensic-accounting`) and call it from an external scheduler (or from Actions via `curl`): then add a **cron-only secret** (e.g. `CRON_SECRET` or `FORENSIC_CRON_SECRET`) and require `Authorization: Bearer <secret>` on that route, same pattern as `REMINDER_API_KEY` for reminders.

---

## 4) Summary

| Question | Answer |
|----------|--------|
| **1) What exists today?** | No vercel.json. One GitHub workflow (accounting-invariants) on PR/push/manual only. No Supabase Edge Functions, no pg_cron. One cron-style API route: `app/api/reminders/process-automated/route.ts` (optional REMINDER_API_KEY). |
| **2) Best place for forensic nightly?** | **GitHub Actions** with a **scheduled workflow** (e.g. `schedule: - cron: '0 2 * * *'`) running a script (or calling an API route later). Minimum new infra; reuses existing secrets and CI pattern. |
| **3) Secrets for cron auth?** | **Existing:** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CI_TEST_BUSINESS_ID (Actions); REMINDER_API_KEY (reminders route). **No dedicated cron secret** today; add one only if you expose a cron API route and want to protect it. |
