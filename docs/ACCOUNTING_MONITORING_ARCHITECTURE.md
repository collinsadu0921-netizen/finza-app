# Accounting Monitoring — Architecture

**Scope:** Design only. Defines metrics (posting success rate, invariant failure count, snapshot rebuild latency, VAT mismatch flags, ledger posting latency), data sources, collection points, and how they fit into a monitoring stack. No implementation or migrations.

---

## 1. Metric Definitions

| Metric | Definition | Unit / shape |
|--------|------------|--------------|
| **Posting success rate** | Fraction of posting attempts that succeed (no exception from `post_journal_entry`). Can be global or per reference_type / business_id / time window. | Ratio (0–1) or percentage; counter pair (success_count, failure_count) over window. |
| **Invariant failure count** | Number of accounting invariant checks that failed in a run (e.g. forensic or trial-balance verification). Can be total per run or per check_id. | Integer count per run; optionally time-series of counts per run. |
| **Snapshot rebuild latency** | Time to complete a single trial balance snapshot rebuild (e.g. `generate_trial_balance(period_id)` or read-only recompute). | Duration (ms or s) per period_id / per run. |
| **VAT mismatch flags** | Boolean or count indicating that VAT from ledger (account 2100 by period) does not match VAT derived from operational sources (invoices/expenses/bills) for the same business and period. | Flag per (business_id, period_month); or count of mismatches per run. |
| **Ledger posting latency** | Time from start of a posting request (e.g. RPC call or trigger entry) to completion (JE committed or exception). | Duration (ms) per attempt; can be aggregated (p50, p95, p99) by reference_type or business. |

---

## 2. Data Sources (Existing or Proposed)

| Metric | Primary source | Notes |
|--------|----------------|-------|
| **Posting success rate** | **Proposed:** `post_journal_entry_failure_log` (failure log from POST_JOURNAL_ENTRY_LOGGING_DESIGN). Success count: not in DB today — either infer from “attempts” (e.g. trigger + RPC call counts) or add success-side instrumentation. | Failures are logged per row; successes require either a separate success log, or a “posting attempts” event stream (app/DB) to compare against failure log. |
| **Invariant failure count** | **Proposed:** `accounting_invariant_failures` and optional `accounting_invariant_runs` (from BACKGROUND_JOB_FORENSIC_ACCOUNTING_DESIGN). Each run inserts failure rows per check_id; run summary can store total failure count. | Query: count failures per run_id, or per check_id per run. |
| **Snapshot rebuild latency** | **Source:** Instrumentation around `generate_trial_balance(period_id)` or the read-only recompute used by trial-balance verification job. No existing table stores duration. | Either: (1) app/script records start/end when calling RPC and writes to a metrics store or log, or (2) DB function writes duration to a small table (e.g. `snapshot_rebuild_metrics`) or (3) APM/trace captures RPC duration. |
| **VAT mismatch flags** | **Source:** Forensic checks 7.1 (VAT ledger monthly) vs 7.2 (VAT from operational tables). Mismatch = same (business_id, period_month) with different totals. Can be materialized in `accounting_invariant_failures` as a dedicated check (e.g. `7_vat_mismatch`) or derived from existing forensic run results. | One row per (business_id, period_month) where |ledger_vat − operational_vat| > tolerance; or count per run. |
| **Ledger posting latency** | **Source:** No existing table. Requires timing around `post_journal_entry` (or wrapper) start and end. Options: (1) App records duration when calling RPC (e.g. sales create, invoice send, reconciliation resolve). (2) DB: in `post_journal_entry` or in a wrapper, record start time at entry and end time at return/exception into a metrics table or out to a log. | Duration in ms; one sample per attempt. |

---

## 3. Collection Architecture

### 3.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  INSTRUMENTATION POINTS                                                          │
│  • post_journal_entry (success/failure + optional duration)                     │
│  • Forensic / TB verification jobs (failure counts, duration, VAT flags)        │
│  • generate_trial_balance or read-only recompute (duration)                     │
└─────────────────────────────────────────────────────────────────────────────────┘
                    │                              │
                    ▼                              ▼
┌──────────────────────────────┐    ┌──────────────────────────────────────────────┐
│  DATABASE (source of truth)  │    │  APPLICATION / JOB RUNNER                     │
│  • post_journal_entry_       │    │  • Timers around RPC calls (posting latency)  │
│    failure_log               │    │  • Timers around job steps (rebuild latency)  │
│  • accounting_invariant_     │    │  • Emit metrics to metrics backend           │
│    failures / runs           │    │    (counters, gauges, histograms)            │
│  • Optional: snapshot_       │    │  • Or write to DB metrics table              │
│    rebuild_metrics            │    │    for later scrape/export                   │
└──────────────────────────────┘    └──────────────────────────────────────────────┘
                    │                              │
                    └──────────────┬───────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  METRICS BACKEND (conceptual)                                                     │
│  • Time-series store (e.g. Prometheus, Datadog, Vercel Analytics, custom)        │
│  • Or: periodic export from DB (e.g. aggregate tables, nightly rollups)           │
│  • Labels: business_id, reference_type, check_id, period_id, etc.                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  DASHBOARDS & ALERTS                                                              │
│  • Posting success rate (e.g. last 1h / 24h); alert if below threshold            │
│  • Invariant failure count (per run); alert if > 0 for alertable checks           │
│  • Snapshot rebuild latency (p95); alert if above SLA                             │
│  • VAT mismatch count / flags; alert if any                                        │
│  • Ledger posting latency (p95 by reference_type); alert if degraded              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Per-Metric Collection Strategy

| Metric | Where to capture | What to emit / store |
|--------|------------------|----------------------|
| **Posting success rate** | (1) **Failure:** `post_journal_entry` EXCEPTION handler → INSERT `post_journal_entry_failure_log`. (2) **Success:** Either (a) same function writes a row to a lightweight “posting_success_log” (e.g. business_id, reference_type, occurred_at) or (b) app/job emits a “posting_success” counter per reference_type when RPC returns. (3) **Aggregation:** Periodic query or job: success_count = total attempts − failure_count (if attempts are known), or success_count from success log; rate = success_count / (success_count + failure_count) over window. | Counters: `accounting_posting_attempts_total`, `accounting_posting_failures_total` (by reference_type, optional business_id). Or query DB for failure count and infer rate if attempts are tracked elsewhere. |
| **Invariant failure count** | Forensic / TB verification runner: after each run, persist failures to `accounting_invariant_failures` and run summary to `accounting_invariant_runs` (e.g. total_failures, failures_by_check_id). Scraper or job reads runs table and pushes to metrics backend. | Gauge or counter: `accounting_invariant_failures_total` per run; or `accounting_invariant_failures_by_check` (check_id). |
| **Snapshot rebuild latency** | (1) **Inside DB:** If `generate_trial_balance` or a read-only recompute function records start/end (e.g. in a small table or via pg_stat_statements), a periodic job can compute duration. (2) **Outside DB:** Job or app that calls the RPC measures wall-clock time and emits a histogram or gauge (e.g. `accounting_snapshot_rebuild_duration_seconds` per period_id or globally). | Histogram or summary: `accounting_snapshot_rebuild_duration_seconds` (bucket or quantile). Labels: optional period_id, business_id. |
| **VAT mismatch flags** | Forensic runner: add or reuse a check that compares 7.1 vs 7.2 per (business_id, period_month); if |ledger − operational| > tolerance, insert into `accounting_invariant_failures` with check_id e.g. `7_vat_mismatch` and payload containing business_id, period_month, amounts. Dashboard/alert queries count rows with that check_id per run or over time. | Gauge or counter: `accounting_vat_mismatch_count` per run; or boolean `accounting_vat_mismatch` = 1 if any mismatch in last run. Labels: business_id, period_month if stored in metrics. |
| **Ledger posting latency** | (1) **App layer:** In routes that call posting RPCs (e.g. sales create, invoice send, reconciliation resolve), record start time before RPC and end time after; emit duration to metrics backend or write to a “posting_latency” log/table. (2) **DB layer:** Optional wrapper or instrumentation inside `post_journal_entry`: store start timestamp at entry and end at return/exception in a table (e.g. `posting_latency_samples`) or out via extension. (3) **APM:** If APM traces Supabase RPCs, use RPC duration for `post_journal_entry` as ledger posting latency. | Histogram: `accounting_posting_duration_seconds` (or ms). Labels: reference_type, posting_source, optional business_id. |

---

## 4. Storage and Aggregation

- **Database tables (proposed / existing):**
  - `post_journal_entry_failure_log` — failures only (existing design).
  - Optional: `posting_success_log` or equivalent for success count (or derive attempts from other signals).
  - `accounting_invariant_failures`, `accounting_invariant_runs` — invariant and run metadata.
  - Optional: `snapshot_rebuild_metrics` (period_id, started_at, completed_at, duration_ms, success boolean).
  - Optional: `posting_latency_samples` (business_id, reference_type, duration_ms, occurred_at) with retention (e.g. 7 days).

- **Metrics backend:** Use an existing time-series system (Prometheus, Datadog, Vercel, etc.). Export from DB via a small exporter job (e.g. query failure counts, run summaries, latency rollups) or push from app/job when events occur. Prefer counters/histograms with labels (reference_type, check_id, business_id) for filtering and alerting.

- **Retention:** Define retention for log-style tables (e.g. failure log 90 days, latency samples 7 days) and for metrics (per backend). Keep run and failure summary data long enough for trend and audit (e.g. invariant runs 1 year).

---

## 5. Dashboards (Conceptual)

| Dashboard | Panels |
|-----------|--------|
| **Posting health** | Posting success rate (last 1h, 24h); failure count by reference_type; recent rows from post_journal_entry_failure_log (sample). |
| **Invariant & forensic** | Invariant failure count per run (last N runs); failures by check_id; list of recent runs with status and timestamp. |
| **Snapshot & TB** | Snapshot rebuild latency (p50, p95) over time; count of TB verification failures; last run time and outcome. |
| **VAT** | VAT mismatch count per run or over time; list of (business_id, period_month) with mismatch (from invariant failures or dedicated table). |
| **Ledger latency** | Ledger posting latency p50/p95/p99 by reference_type; optional by business_id. |

---

## 6. Alerting (Conceptual)

| Alert | Condition | Severity |
|-------|-----------|----------|
| Posting success rate low | success_rate < threshold (e.g. 99%) over last 1h or 24h | High |
| Invariant failures in run | Any alertable check failed in latest forensic/TB run | High |
| Snapshot rebuild slow | p95 latency > SLA (e.g. 30s per period) | Medium |
| VAT mismatch | Any VAT mismatch in latest run or new row in 7_vat_mismatch | High |
| Ledger posting slow | p95 posting latency > threshold (e.g. 5s) | Medium |

---

## 7. Dependencies on Other Designs

| Dependency | Design doc | Use |
|------------|------------|-----|
| Failure log | POST_JOURNAL_ENTRY_LOGGING_DESIGN | Failures for posting success rate and debugging. |
| Invariant failures table | BACKGROUND_JOB_FORENSIC_ACCOUNTING_DESIGN | Invariant failure count and VAT mismatch (if 7_vat_mismatch is stored there). |
| TB verification job | SCHEDULED_JOB_TRIAL_BALANCE_VERIFICATION_DESIGN | Snapshot rebuild latency (if job runs recompute) and TB mismatch failures. |
| Forensic job | BACKGROUND_JOB_FORENSIC_ACCOUNTING_DESIGN | Invariant failure count; VAT mismatch from 7.1 vs 7.2 or derived check. |

---

## 8. Summary

| Metric | Source of truth | Collection | Output |
|--------|-----------------|------------|--------|
| **Posting success rate** | Failure log + success signal (log or app counter) | DB table + optional app counters | Counter pair or rate; dashboard + alert on low rate. |
| **Invariant failure count** | accounting_invariant_failures / runs | Job inserts; scrape or push | Count per run / check_id; dashboard + alert if > 0. |
| **Snapshot rebuild latency** | Timing around generate_trial_balance or recompute | DB table or app/job timer → metrics backend | Histogram; dashboard + alert on p95. |
| **VAT mismatch flags** | Forensic 7.1 vs 7.2 or dedicated check → invariant failures | Job inserts rows for mismatches | Count or boolean; dashboard + alert if any. |
| **Ledger posting latency** | App timer or DB instrumentation | App emit or DB table → metrics backend | Histogram by reference_type; dashboard + alert on p95. |

All of the above is architecture only; no code or migrations are specified.
