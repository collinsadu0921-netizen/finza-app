# Forensic Failure Response Runbook

Operational response when monitoring detects invariant failures. **Do not modify** forensic SQL or monitoring logic; only define how accountants and ops respond.

---

## General Principles

- **Triage first:** Identify business_id, check_id, and payload; assign owner.
- **Investigate before correct:** Root cause must be understood; correction must be appropriate.
- **Document everything:** Investigation notes, root cause, correction applied, sign-off.
- **Escalate when:** Unknown cause, data corruption suspected, or correction requires period reopen / bulk change.

---

## 1. je_imbalanced

**Meaning:** A journal entry’s lines have sum(debit) ≠ sum(credit) beyond tolerance (e.g. 0.005).

### 1.1 Investigation steps

1. From failure payload note `journal_entry_id`, `business_id`, `sum_debit`, `sum_credit`, `difference`.
2. In DB or Ledger UI: open the JE and list all lines (account, debit, credit).
3. Check for rounding errors, missing line, or duplicate line; check if JE was created by system vs manual.
4. Check period status (open/closed) and whether any prior corrections were attempted.

### 1.2 Root cause checklist

- [ ] Rounding on multi-currency or multi-line entry.
- [ ] Manual edit or partial post that left JE unbalanced.
- [ ] Bug in posting engine (report; do not "fix" by hand without engineering).
- [ ] Corrupt or partial migration/import.

### 1.3 Correction workflow

- **If rounding:** Post a small balancing line (adjustment) in same period with clear reason ("Rounding correction for JE &lt;id&gt;"); document in audit log.
- **If manual error:** Reverse the JE (per [ACCOUNTING_REVERSAL_WORKFLOW.md](./ACCOUNTING_REVERSAL_WORKFLOW.md)) and post correct entry if needed.
- **If bug:** Do not alter data to "hide" failure; escalate to engineering; document incident.

### 1.4 Escalation rules

- Escalate to **engineering** if: no obvious data entry error, or same pattern across multiple JEs.
- Escalate to **partner/owner** if: correction requires period reopen or large adjustment.

### 1.5 Documentation requirements

- Log: business_id, journal_entry_id, root cause, correction (reversal id or adjustment id), corrected_by, date.
- Retain payload and investigation notes for audit.

### 1.6 Resolution sign-off

- Mark failure as resolved in monitoring UI (if supported) or in runbook log.
- Sign-off: name, role, date; "Resolved by &lt;action&gt; (reversal/adjustment id)."

---

## 2. period_id_null

**Meaning:** A journal entry has no `period_id` (should be set by posting contract).

### 2.1 Investigation steps

1. From payload note `journal_entry_id`, `business_id`.
2. Query JE: confirm `period_id` is null; note `date`, `reference_type`, `reference_id`, `created_at`.
3. Check whether period existed for that date at time of post; check for period changes (e.g. delete/recreate).

### 2.2 Root cause checklist

- [ ] JE created before period assignment was enforced.
- [ ] Period was deleted or merged after post.
- [ ] Posting path bypassed period lookup (bug).

### 2.3 Correction workflow

- **If period exists for JE date:** Backfill `period_id` via controlled fix (single update with audit log); only if platform supports and policy allows.
- **If period missing:** Create or restore period for that date range, then backfill; otherwise escalate (no ad-hoc schema change).

### 2.4 Escalation rules

- Escalate to **engineering** if: backfill not supported or bulk period_id nulls.
- **Do not** change posting engine or forensic logic.

### 2.5 Documentation requirements

- Log: journal_entry_id, business_id, root cause, fix applied (e.g. "period_id set to &lt;id&gt;"), applied_by, date.

### 2.6 Resolution sign-off

- Sign-off: "Resolved by backfilling period_id / by engineering fix."

---

## 3. invoice_je_date_mismatch

**Meaning:** Invoice and its journal entry have inconsistent dates (e.g. JE date outside invoice date logic).

### 3.1 Investigation steps

1. From payload note `invoice_id`, `journal_entry_id`, `business_id`, and any date fields.
2. Load invoice (issue date, dates used for posting) and JE (date, period_id).
3. Compare with business rules (e.g. JE date = issue date or last day of period).

### 3.2 Root cause checklist

- [ ] Clock or timezone at time of post.
- [ ] Manual JE created with wrong date.
- [ ] Invoice date amended after post; JE not updated (and should not be, per immutability).

### 3.3 Correction workflow

- **If JE date wrong and period open:** Reverse and re-post with correct date (if supported).
- **If invoice date wrong:** Correct invoice if allowed; then consider reversal/re-post of JE in open period only.
- **Immutability:** Do not update existing JE date; use reversal + new post.

### 3.4 Escalation rules

- Escalate if: many invoices affected or closed period involved.

### 3.5 Documentation requirements

- Log: invoice_id, je_id, root cause, correction (reversal + new JE ids), corrected_by, date.

### 3.6 Resolution sign-off

- Sign-off: "Resolved by reversal (id) and repost / by invoice date correction and reversal."

---

## 4. trial_balance_snapshot_mismatch

**Meaning:** Trial balance snapshot for a period does not match recomputed ledger totals (debits/credits) for that period.

### 4.1 Investigation steps

1. From payload note `business_id`, period, and any snapshot vs ledger figures.
2. Re-run trial balance for that period (or query ledger lines for period); compare to snapshot.
3. Check for: new JEs posted after snapshot, snapshot recompute bug, or corrupted snapshot.

### 4.2 Root cause checklist

- [ ] JEs posted after snapshot was taken (snapshot stale).
- [ ] Snapshot computation bug (report to engineering).
- [ ] Period or account scope mismatch (e.g. wrong period_id on JEs).

### 4.3 Correction workflow

- **If stale:** Trigger snapshot refresh for that period (if supported); document.
- **If bug:** Escalate; do not manually edit snapshot table.
- **If wrong period_id on JEs:** Fix period_id per "period_id_null" flow where policy allows.

### 4.4 Escalation rules

- Escalate to **engineering** if: snapshot logic suspect or bulk mismatch.
- **Do not** alter snapshot or ledger without documented, approved procedure.

### 4.5 Documentation requirements

- Log: business_id, period_id, root cause, action (refresh/escalation/fix), by, date.

### 4.6 Resolution sign-off

- Sign-off: "Resolved by snapshot refresh / by engineering fix / by period_id correction."

---

## Cross-Check Summary

| check_id | Primary action | Escalate when |
|----------|----------------|----------------|
| je_imbalanced | Balancing adjustment or reversal | Bug suspected; multiple JEs |
| period_id_null | Backfill period_id (if supported) | No backfill path; bulk |
| invoice_je_date_mismatch | Reversal + repost (open period) | Closed period; many rows |
| trial_balance_snapshot_mismatch | Refresh snapshot or fix root cause | Snapshot/report bug |

---

## References

- [FORENSIC_NIGHTLY_RUNBOOK.md](./FORENSIC_NIGHTLY_RUNBOOK.md) — Cron, alerts, viewing runs.
- [ACCOUNTING_REVERSAL_WORKFLOW.md](./ACCOUNTING_REVERSAL_WORKFLOW.md) — How to reverse a JE.
- [ACCOUNTING_AUDIT_STANDARD.md](./ACCOUNTING_AUDIT_STANDARD.md) — Logging and retention.
