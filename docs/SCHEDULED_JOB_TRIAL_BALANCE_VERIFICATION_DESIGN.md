# Scheduled Job: Trial Balance Snapshot Verification — Design

**Purpose:** Rebuild trial balance from ledger, compare to stored snapshot, and flag any difference > 0.01.

**Deliverables:** Architecture, job schedule, failure escalation path.

---

## 1. Architecture

### 1.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SCHEDULER (e.g. nightly 02:00 UTC)                                          │
│  Vercel Cron / pg_cron / GitHub Actions → invokes runner                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  RUNNER (single invocation per schedule)                                    │
│  1. Determine scope: periods with a stored trial_balance_snapshots row       │
│     (optionally: only recent / open periods to bound work)                   │
│  2. For each period_id in scope:                                            │
│     a. RECOMPUTE: Run read-only trial balance computation from ledger       │
│        (same source as generate_trial_balance: period_opening_balances +     │
│        journal_entry_lines for period) → (total_debits, total_credits,       │
│        balance_difference)                                                  │
│     b. COMPARE: Read stored snapshot (total_debits, total_credits,            │
│        balance_difference) for that period_id                                │
│     c. FLAG: If |recomputed - stored| > 0.01 for debits, credits, or       │
│        balance_difference → record failure and escalate                     │
│  3. Persist results (run + failures) and trigger escalation when needed     │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                                    │
                    ▼                                    ▼
┌──────────────────────────────┐    ┌────────────────────────────────────────┐
│  PERSISTENCE                  │    │  ESCALATION                            │
│  • Run record (optional)      │    │  See Section 3                         │
│  • Failure rows (e.g.          │    │  Log → Table → Alert → Runbook        │
│    accounting_invariant_       │    │                                        │
│    failures or dedicated      │    │                                        │
│    tb_verification_failures)  │    │                                        │
└──────────────────────────────┘    └────────────────────────────────────────┘
```

### 1.2 Recompute vs Stored (No Overwrite)

- **Recompute:** Use ledger-only data (same as `generate_trial_balance` in migration 247): for the period, sum debits/credits from `period_opening_balances` + `journal_entry_lines` joined to `journal_entries` within period date range. Produce `total_debits`, `total_credits`, and `balance_difference = |total_debits - total_credits|`.
- **Stored:** Read from `trial_balance_snapshots` for that `period_id`: `total_debits`, `total_credits`, `balance_difference`.
- **Do not** call `generate_trial_balance` for this check, because it overwrites the stored snapshot. The job is a **verification** step: “does the stored snapshot match what the ledger would produce?” So recompute must be **read-only** (new function or parameterised path that returns totals without writing).

### 1.3 Read-Only Recompute Option

- **Option A — New DB function:** e.g. `compute_trial_balance_totals(p_period_id UUID) RETURNS TABLE(total_debits NUMERIC, total_credits NUMERIC, balance_difference NUMERIC)`. Reuse the same account loop and aggregation logic as `generate_trial_balance` but return only the three totals; no INSERT/UPDATE.
- **Option B — In-runner SQL:** Runner (API or script) runs a single query that aggregates ledger data for the period (opening + journal_entry_lines in range) into totals, then compares in app code to stored snapshot. Simpler but duplicates aggregation logic outside the canonical function.

**Recommendation:** Option A keeps a single source of truth for “what the ledger says” and avoids logic drift.

### 1.4 Comparison Rule (Flag When Difference > 0.01)

- For each period, compare:
  - `|recomputed_total_debits  - stored_total_debits |  > 0.01` → **flag**
  - `|recomputed_total_credits - stored_total_credits| > 0.01` → **flag**
  - `|recomputed_balance_difference - stored_balance_difference| > 0.01` → **flag**
- Also **flag** if stored snapshot has `balance_difference > 0.01` or `is_balanced = FALSE` (stored snapshot is already known bad; job can record that as a verification failure).
- Persist one failure row per (run, period) with at least one violation; payload should include recomputed vs stored values and which metric(s) exceeded 0.01.

### 1.5 Scope of Periods

- **Default:** All periods that have a row in `trial_balance_snapshots`. That is the set of “periods we have committed a snapshot for”; comparing only those avoids noise from periods that never had a snapshot.
- **Optional bounds:** Limit to last N months or “period_end >= (today - 1 year)” to keep nightly job time bounded. Configurable (e.g. env or parameter).

---

## 2. Job Schedule

| Item | Recommendation |
|------|----------------|
| **Frequency** | Once per day (nightly). |
| **Time** | **02:00 UTC** (or 02:00 in primary region). Low traffic; after typical batch/postings; before business hours for follow-up. |
| **Trigger** | Same options as forensic job: Vercel Cron (`vercel.json`), Supabase pg_cron (invoking HTTP or Edge Function), or external cron (e.g. GitHub Actions `schedule`) calling `POST /api/cron/trial-balance-verification`. |
| **Timeout** | 10–15 minutes. If scope is large (many businesses/periods), consider batching or limiting periods per run. |
| **Overlap** | Do not run concurrently with the same job (idempotent per run, but one run at a time). Use same cron path or a distributed lock if multiple schedulers exist. |

**Example (Vercel):**

```json
// vercel.json crons (add to existing if any)
{
  "crons": [
    { "path": "/api/cron/trial-balance-verification", "schedule": "0 2 * * *" }
  ]
}
```

**Example (GitHub Actions):**

```yaml
schedule:
  - cron: '0 2 * * *'  # 02:00 UTC daily
```

---

## 3. Failure Escalation Path

### 3.1 Stages

| Stage | Action | Owner / System |
|-------|--------|----------------|
| **1. Detect** | Recompute vs stored comparison; difference > 0.01 → create failure record. | Job runner (DB function or API). |
| **2. Log** | Write structured log: run_id, period_id, business_id, recomputed vs stored, which metric(s) failed. | Runner + application logs. |
| **3. Persist** | Insert into failure table (e.g. `accounting_invariant_failures` with `check_id = 'trial_balance_ne_snapshot'` or dedicated `tb_verification_failures`). | Runner. |
| **4. Alert** | If any failure in this run → send alert (email / webhook / Slack / in-app). Payload: run id, count of failed periods, sample period_ids and business_ids, max difference seen. | Alert channel (config-driven). |
| **5. Triage** | On-call or ops reviews alert; open incident or ticket; assign to accounting/platform. | Human. |
| **6. Remediate** | Options: (a) Trigger snapshot rebuild for affected period(s) via `generate_trial_balance(period_id)` and re-run verification; (b) Investigate ledger/opening balance integrity if rebuild still differs; (c) Fix data or code and re-verify. | Engineering / accounting. |
| **7. Close** | Re-run job or one-off verification for affected periods; confirm no failures; close incident. | Same team. |

### 3.2 Escalation Flow Diagram

```
  Detect (diff > 0.01)
         │
         ▼
  Log + Persist (failure table)
         │
         ▼
  Any failures this run? ──No──► Exit 0 (success)
         │
        Yes
         │
         ▼
  Send alert (email / webhook / Slack / in-app)
         │
         ▼
  Human triage → Incident/ticket
         │
         ▼
  Remediate (rebuild snapshot / fix ledger / fix code)
         │
         ▼
  Re-verify → Close
```

### 3.3 Alert Content (Minimum)

- **Subject/Title:** e.g. `[Finza] Trial balance verification failed — N period(s)`
- **Body:** Run id, run timestamp, number of periods with difference > 0.01; list of (business_id, period_id, period dates) and for each: recomputed vs stored (total_debits, total_credits, balance_difference), and which metric(s) exceeded 0.01.
- **Link:** Optional link to admin/dashboard showing the run and failure rows.

### 3.4 Severity / Throttling

- **Severity:** Treat any difference > 0.01 as **high** for accounting integrity; one alert per run is enough (do not alert per period to avoid noise).
- **Throttling:** One run per night implies at most one alert per day. If the same period fails repeatedly, consider a separate “recurring failure” digest or runbook to avoid alert fatigue.

---

## 4. Summary

| Aspect | Design choice |
|--------|----------------|
| **Rebuild** | Read-only recompute from ledger (same logic as `generate_trial_balance`), no write. |
| **Compare** | Recomputed vs stored `total_debits`, `total_credits`, `balance_difference`. |
| **Flag** | Any |recomputed − stored| > 0.01 or stored `balance_difference` > 0.01 / `is_balanced = FALSE`. |
| **Schedule** | Nightly at 02:00 UTC; single run; no overlap. |
| **Escalation** | Log → persist in failure table → alert → triage → remediate (rebuild/fix) → re-verify. |

No migrations or implementation are included in this design; it is architecture and execution plan only.
