# Go-Live Accounting Safety Runbook

Daily, monthly, and emergency procedures for accounting operations and launch readiness. **Does not modify** ledger, posting, or forensic logic.

---

## 1. Daily Procedures

### 1.1 Forensic monitoring review

- **Action:** Review latest forensic run (e.g. from dashboard or `accounting_invariant_runs`).
- **Check:** `status`, `summary.total_failures`, `summary.alertable_failures`, `check_counts`.
- **If total_failures = 0:** No action; log "Daily review: no failures" if required.
- **If total_failures > 0:** Proceed to **Failure triage** (below).

### 1.2 Failure triage checklist

1. Open the run; list failures by `check_id` and `business_id`.
2. For each failure: assign owner (tenant/accountant); note payload (e.g. journal_entry_id, period_id).
3. Prioritise: **je_imbalanced** and **trial_balance_snapshot_mismatch** first (affect balance integrity); then period_id_null; then invoice_je_date_mismatch.
4. For each: follow [ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md](./ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md) (investigate → root cause → correct → document → sign-off).
5. Mark resolved in UI or runbook log when done.

---

## 2. Monthly Procedures

### 2.1 Period closing checklist

- [ ] All reconciliations for the month resolved or documented.
- [ ] Forensic run for the month reviewed; no open failures (or documented exception).
- [ ] Trial balance and key reports reviewed for the period.
- [ ] Late adjustments logged and approved if any.
- [ ] Execute close (owner/partner); record closed_by and closed_at.
- [ ] Communicate "Period &lt;name&gt; closed" to stakeholders.

Ref: [ACCOUNTING_PERIOD_OPERATIONS_SOP.md](./ACCOUNTING_PERIOD_OPERATIONS_SOP.md).

### 2.2 Snapshot verification

- [ ] After close, confirm trial balance snapshot exists for the period (if applicable).
- [ ] Spot-check: snapshot totals vs ledger totals for a sample of accounts.
- [ ] If mismatch: follow **trial_balance_snapshot_mismatch** in [ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md](./ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md).

### 2.3 Reconciliation validation

- [ ] AR reconciliation (invoice vs ledger) reviewed for material tenants.
- [ ] Bank/cash reconciliations completed where applicable.
- [ ] Any unresolved mismatches documented and escalated per policy.

---

## 3. Emergency Procedures

### 3.1 Duplicate posting recovery

- **Symptom:** Same transaction posted twice (e.g. duplicate payment JE, duplicate sale JE).
- **Action:** Identify both JEs; reverse one using [ACCOUNTING_REVERSAL_WORKFLOW.md](./ACCOUNTING_REVERSAL_WORKFLOW.md) (reason: "Duplicate posting; reversing duplicate entry &lt;id&gt;").
- **Verification:** Run duplicate-proof queries (e.g. one JE per reference_id for payment/sale/refund/void); confirm 0 duplicate rows.
- **Document:** Log reversal id, original id, business_id, corrected_by, date.

### 3.2 Monitoring incident escalation

- **When:** Unknown root cause; suspected bug; bulk failures; or correction requires period reopen.
- **Steps:**
  1. Document: run_id, failure ids, business_id(s), payload, investigation notes.
  2. Notify engineering or partner/owner per escalation rules in [ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md](./ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md).
  3. Do not alter data to "hide" failures; preserve state for diagnosis.
  4. Track until resolved; sign-off when fixed.

### 3.3 Ledger anomaly containment

- **When:** Unexpected balances; unexplained JEs; or suspected data corruption.
- **Steps:**
  1. **Contain:** Do not post further to affected period/tenant until understood (optional soft lock or communication).
  2. **Investigate:** Use ledger and JE detail; compare to source documents; check for reversals and adjustments.
  3. **Correct:** Per runbook (reversal/adjustment) or escalate to engineering if logic/schema issue.
  4. **Document:** Timeline, root cause, correction, sign-off.

---

## 4. References

- [ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md](./ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md)
- [ACCOUNTING_PERIOD_OPERATIONS_SOP.md](./ACCOUNTING_PERIOD_OPERATIONS_SOP.md)
- [ACCOUNTING_REVERSAL_WORKFLOW.md](./ACCOUNTING_REVERSAL_WORKFLOW.md)
- [FORENSIC_NIGHTLY_RUNBOOK.md](./FORENSIC_NIGHTLY_RUNBOOK.md)
- [ACCOUNTING_GO_LIVE_CHECKLIST.md](./ACCOUNTING_GO_LIVE_CHECKLIST.md)
