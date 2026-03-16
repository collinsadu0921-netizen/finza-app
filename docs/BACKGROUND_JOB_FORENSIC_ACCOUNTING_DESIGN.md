# Background Job: Forensic Accounting Verification — Architecture & Execution Plan

**Status:** Design only. No migrations or code implemented.  
**Scope:** Nightly run of forensic accounting checks, failure logging, and alerting.

---

## 1. Objectives

1. **Run** `scripts/forensic-accounting-verification.sql` (or equivalent) **nightly**.
2. **Log** all failures into a new table `accounting_invariant_failures`.
3. **Send an alert** when any of the following exist:
   - Any JE (journal entry) imbalance
   - `period_id` is NULL on journal entries
   - Invoice JE date mismatch
   - Trial balance ≠ snapshot (stored snapshot does not match ledger-derived trial balance)

---

## 2. Current State (Audit Summary)

### 2.1 Forensic Script

- **Location:** `finza-web/scripts/forensic-accounting-verification.sql`
- **Nature:** Read-only; multiple independent `SELECT` sections. Designed for manual run in Supabase SQL Editor “section by section” (running as one batch only returns the last result set).
- **Relevant check IDs for alerting:**

| Alert condition              | Forensic check ID(s) / source                                      |
|-----------------------------|--------------------------------------------------------------------|
| JE imbalance                | `2.3_je_imbalanced` (Section 2.3)                                  |
| period_id NULL              | **Not in script** — must be added as new check                     |
| Invoice JE date mismatch   | `6.1_invoice_je_date_mismatch` (Section 6.1)                      |
| Trial balance ≠ snapshot    | Section 4.1 vs 4.2 (ledger monthly vs snapshot monthly); or 8.1 (snapshot not balanced); or explicit “recompute TB vs snapshot” |

- **Other checks** (e.g. 1.1, 1.2, 2.1, 2.2, 3.x, 5.x, 6.2, 7.x, 8.2): should still run and be logged in `accounting_invariant_failures`, but are not in the “send alert” set unless product decides otherwise.

### 2.2 Existing Infrastructure

- **CI (GitHub Actions):** `.github/workflows/accounting-invariants.yml` runs on PR/push and `workflow_dispatch`. It runs `scripts/accounting-ci-audit.ts`, which calls **`run_business_accounting_audit`** (RPC) — a **different** audit (period-centric, Phase 11 invariants), not the forensic script.
- **Scheduled jobs:** No existing nightly job for the forensic script. `app/api/reminders/process-automated/route.ts` is intended to be triggered by “Vercel Cron or external cron” (no `vercel.json` cron found; no Supabase Edge Functions in repo).
- **Database:** Supabase (Postgres). `journal_entries.period_id` exists (nullable), added in migration 148.
- **Alerts:** No central alert service. Email used for invoice/receipt sending; in-app `AlertsPanel` exists. “Send alert” is therefore a **contract** to be implemented (email, webhook, Slack, or in-app).

### 2.3 Schema Notes (for design only; no migration written)

- **journal_entries:** has `period_id UUID REFERENCES accounting_periods(id)` (nullable). JEs created outside the manual-draft path may have `period_id` NULL.
- **trial_balance_snapshots:** per-period snapshot with `total_debits`, `total_credits`, `is_balanced`, `balance_difference`, `snapshot_data`. “Trial balance ≠ snapshot” means: ledger-derived trial balance (e.g. from `generate_trial_balance` or equivalent) does not match the stored snapshot for that period (totals and/or per-account).

---

## 3. Architecture

### 3.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SCHEDULER (nightly, e.g. 02:00 UTC)                                         │
│  Option A: Vercel Cron → POST /api/cron/forensic-accounting-verification     │
│  Option B: Supabase pg_cron → PL/pgSQL runner → inserts + optional HTTP    │
│  Option C: External cron (e.g. GitHub Actions schedule) → POST same API     │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  RUNNER (single “run”)                                                       │
│  1. Create run record (e.g. accounting_invariant_runs)                       │
│  2. Execute each forensic check (see 3.2)                                    │
│  3. For each check that returns rows → insert into accounting_invariant_    │
│     failures (run_id, check_id, business_id, payload, severity, …)          │
│  4. If any alertable failure (JE imbalance, period_id NULL, invoice JE date  │
│     mismatch, TB ≠ snapshot) → invoke alert channel                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
┌──────────────────────────────┐         ┌──────────────────────────────────┐
│  accounting_invariant_failures│         │  ALERT CHANNEL                    │
│  (persistent log)             │         │  Email / Webhook / Slack / In-app  │
└──────────────────────────────┘         └──────────────────────────────────┘
```

### 3.2 Execution Model for Forensic Checks

The forensic script is a set of independent SELECTs. Two execution strategies:

- **Strategy 1 — App layer:**  
  - Scheduler calls a Next.js API route (or a small Node script run by cron).  
  - Route/script uses Supabase client to execute **each section** of the forensic script as a separate query (or calls a single DB function that runs all sections).  
  - Application code interprets result sets: “any row = failure”, then inserts into `accounting_invariant_failures` and decides whether to alert.

- **Strategy 2 — DB-centric:**  
  - New Postgres function (e.g. `run_forensic_accounting_verification(p_run_id UUID)`) runs all checks in one transaction, inserts failure rows into `accounting_invariant_failures` for any check that returns rows, and returns a summary (e.g. counts per check_id, and whether any alertable condition was seen).  
  - Scheduler still invokes the runner (API or script), which: (1) creates the run row, (2) calls this RPC, (3) if summary indicates alertable failures, calls the alert channel.

**Recommendation:** Prefer **Strategy 2** for consistency, atomicity, and to keep the “run section by section” logic in one place (DB). The forensic script can be refactored into a single function that runs each section and inserts failures, or the function can `EXECUTE` dynamic SQL per section; either way, the API/script only triggers the run and handles alerts.

### 3.3 Data Model (design only; no migration written)

- **accounting_invariant_runs** (optional but recommended)  
  - `id` UUID PK  
  - `started_at`, `finished_at` timestamptz  
  - `status` (e.g. `running`, `success`, `partial`, `error`)  
  - `summary` JSONB (e.g. total checks, failure count per check_id, alert_sent boolean)

- **accounting_invariant_failures**  
  - `id` UUID PK  
  - `run_id` UUID (FK to run, if run table exists; else nullable)  
  - `check_id` TEXT NOT NULL (e.g. `2.3_je_imbalanced`, `6.1_invoice_je_date_mismatch`, `period_id_null`)  
  - `business_id` UUID (nullable; not all checks are per-business)  
  - `payload` JSONB NOT NULL (full row(s) or aggregated detail for the failure)  
  - `severity` TEXT (e.g. `alert`, `log_only`) — used to decide if this failure triggers an alert  
  - `created_at` timestamptz DEFAULT NOW()

**Alertable check_ids (severity = `alert`):**

- `2.3_je_imbalanced`
- `period_id_null` (new check: `SELECT … FROM journal_entries WHERE period_id IS NULL`)
- `6.1_invoice_je_date_mismatch`
- `trial_balance_ne_snapshot` (new check: compare ledger-derived TB to `trial_balance_snapshots` for each period; e.g. recompute via `generate_trial_balance` and compare `total_debits`/`total_credits`/`is_balanced`, or compare 4.1 vs 4.2 style totals)

All other forensic check IDs can be stored with `severity = 'log_only'` (or equivalent) so they appear in the table but do not trigger the alert path.

### 3.4 “Trial balance ≠ snapshot” Definition

- For each accounting period that has a row in `trial_balance_snapshots`:  
  - Recompute trial balance from the ledger for that period (e.g. same logic as `generate_trial_balance` but without persisting, or call a read-only variant).  
  - Compare:  
    - Total debits vs `trial_balance_snapshots.total_debits`  
    - Total credits vs `trial_balance_snapshots.total_credits`  
    - Optionally: `is_balanced` and per-account closing balances vs `snapshot_data`.  
  - If any of these differ (beyond a small numeric tolerance, e.g. 0.01), record one (or more) rows in `accounting_invariant_failures` with `check_id = 'trial_balance_ne_snapshot'`, `business_id` and `period_id` in payload, and `severity = 'alert'`.

### 3.5 Alert Channel (contract only)

- **Trigger:** After a run, if there is at least one row in `accounting_invariant_failures` for that run with `severity = 'alert'` (or with `check_id` in the alertable set).
- **Payload to send:** Run id, list of alertable check_ids with counts and/or sample payloads (e.g. first N failures per check_id), and link to run or dashboard if applicable.
- **Implementation options (no code in this design):**  
  - Email (e.g. Resend) to a configured address or per-tenant.  
  - Webhook (POST to configured URL with JSON body).  
  - Slack (incoming webhook or API).  
  - In-app: write to a “system alerts” or “accounting alerts” table and surface in existing AlertsPanel or admin page.

Environment or config (e.g. `FORENSIC_ALERT_WEBHOOK_URL`, `FORENSIC_ALERT_EMAIL`, `SLACK_WEBHOOK_URL`) should drive which channel is used.

---

## 4. Execution Plan (implementation order)

1. **Schema (migrations — not implemented here)**  
   - Add table `accounting_invariant_failures` (and optionally `accounting_invariant_runs`).  
   - Add RLS policies if needed (e.g. service role only for writes; read for dashboard by role).

2. **New check: period_id NULL**  
   - Add a SELECT (or equivalent inside the DB runner) that returns rows for `journal_entries` where `period_id IS NULL`.  
   - Map to `check_id = 'period_id_null'`, severity `alert`.

3. **New check: trial_balance_ne_snapshot**  
   - Implement in DB: for each period with a snapshot, recompute TB from ledger and compare totals (and optionally balance flag). Insert failure row(s) when mismatch.  
   - Use same tolerance as elsewhere (e.g. 0.01 for money).

4. **DB runner function**  
   - Create `run_forensic_accounting_verification(p_run_id UUID)` (or similar) that:  
     - Runs all forensic sections (2.3, 6.1, 8.1, 4.1/4.2, new period_id_null, new trial_balance_ne_snapshot, and remaining sections from the script).  
     - For each section that returns rows: insert one or more rows into `accounting_invariant_failures` with the appropriate `check_id`, `business_id`, `payload`, `severity`.  
     - Return a summary JSONB (e.g. `{ "alertable_count": N, "check_results": { "2.3_je_imbalanced": count, … } }`).

5. **API route**  
   - Add `POST /api/cron/forensic-accounting-verification` (or under `/api/internal/...`).  
   - Auth: cron secret or service key (e.g. `Authorization: Bearer CRON_SECRET` or Supabase service role).  
   - Logic: create run row (if table exists), call `run_forensic_accounting_verification(run_id)`, then if summary indicates alertable failures, call the alert channel.  
   - Return 200 with run id and summary (and 401/403 if auth fails).

6. **Scheduler**  
   - **Option A:** Add `vercel.json` with `crons: [{ "path": "/api/cron/forensic-accounting-verification", "schedule": "0 2 * * *" }]` (2 AM daily).  
   - **Option B:** Supabase `pg_cron`: schedule a job that calls an Edge Function or triggers an outbound HTTP POST to the API route (if Supabase is configured for that).  
   - **Option C:** GitHub Actions scheduled workflow (e.g. `schedule: ['0 2 * * *']`) that calls the API with a secret.

7. **Alert implementation**  
   - Implement one or more of: email, webhook, Slack, or in-app alert table, driven by config/env.  
   - Keep payload and list of alertable check_ids as above so future channels can be added without changing the runner.

8. **Observability**  
   - Optional: dashboard or admin page that lists recent runs and `accounting_invariant_failures` (filter by run_id, check_id, business_id).  
   - Optional: log run start/end and alert_sent to existing logging/monitoring.

---

## 5. Mapping: Forensic script → check_id and alert

| Forensic section | check_id                     | Alert? |
|-----------------|-----------------------------|--------|
| 2.3             | `2.3_je_imbalanced`          | Yes    |
| (new)           | `period_id_null`             | Yes    |
| 6.1             | `6.1_invoice_je_date_mismatch`| Yes   |
| (new)           | `trial_balance_ne_snapshot`  | Yes    |
| 1.1, 1.2, 1.3   | as in script                 | No (log only) |
| 2.1, 2.2        | as in script                 | No     |
| 3.1, 3.2        | as in script                 | No     |
| 4.1, 4.2        | informational or log_only   | No     |
| 5.x, 6.2, 7.x, 8.1, 8.2 | as in script          | No (8.1 can be used as input to `trial_balance_ne_snapshot` or logged separately) |

(Product may later promote other check_ids to “alert” by setting `severity` or extending the alertable set in code.)

---

## 6. Security & Operational Notes

- **Auth for cron:** Use a dedicated secret (e.g. `CRON_SECRET` or Vercel cron token) so only the scheduler can call the route. Do not rely on user session.
- **DB role:** Runner should use a role with permission to insert into `accounting_invariant_failures` and to execute the forensic/RPC logic (e.g. service role or a dedicated “cron” role).
- **Idempotency:** Each run is a new set of rows (run_id + failures). No update of past runs required.
- **Rate:** One run per night is sufficient; avoid overlapping runs (e.g. use a lock or “last run” check if implementing ad-hoc).

---

## 7. Out of Scope (by request)

- **No migrations** are implemented in this design; only the schema and flow are specified.  
- Implementation of the actual migration files, DB function body, API route code, and alert delivery is left to a follow-up task.
