# Accountant Action Audit Standard

Logging requirements for posting corrections, reversals, period reopen, adjustment approvals, and monitoring response. **Does not change** existing audit tables or forensic logic; defines required metadata, format, and retention.

---

## 1. In-Scope Actions

| Action | Required log |
|--------|----------------|
| Posting corrections (adjustment JEs) | Who, when, business_id, period_id, JE id, reason |
| Reversals | Original JE id, reversal JE id, reason, reversed_by, date |
| Period close | period_id, closed_by, closed_at |
| Period reopen | period_id, requested_by, approved_by, reason, timestamp |
| Adjustment approvals (two-person / owner) | proposal_ref, approver, approved_at |
| Monitoring response (failure resolution) | run_id, failure_id, action, resolved_by, resolution_notes |

---

## 2. Required Metadata (minimum)

For each logged event:

- **Actor:** user id (and preferably name/email for readability).
- **Timestamp:** UTC; sub-minute where feasible.
- **Scope:** business_id (tenant); period_id where applicable.
- **Action type:** e.g. reversal, adjustment, period_close, period_reopen, approval, forensic_resolution.
- **References:** e.g. journal_entry_id, reversal_je_id, run_id, failure_id.
- **Reason / notes:** Free text or structured reason (mandatory for reversals and adjustments).
- **Outcome:** success/failure; if failure, error code or message.

---

## 3. Minimum Audit Log Format

Each record should support at least:

```text
timestamp_utc | actor_id | actor_name (optional) | action_type | business_id | period_id (optional) | reference_type | reference_id | reason_or_notes | outcome
```

- **reference_type:** e.g. journal_entry, reversal, period, forensic_failure.
- **reference_id:** UUID or id of the primary entity (JE, period, run, etc.).
- **reason_or_notes:** Required for reversals, adjustments, period reopen, and resolution sign-off.

---

## 4. Retention Rules

- **Accounting audit events:** Retain per regulatory and firm policy (e.g. 7 years for tax/audit).
- **Forensic resolution logs:** Retain at least as long as related run/failure data.
- **Deletion:** No ad-hoc deletion; retention policy should be documented and enforced (e.g. archive then purge by date).
- **Tamper-resistance:** Logs should be append-only; no edit/delete of historical audit rows by normal users. Access to audit log restricted (read-only for auditors; write only by system).

---

## 5. Tamper-Resistance Expectations

- **Append-only:** New events appended; no updates or deletes to past audit records by application users.
- **Access control:** Only designated roles can read full audit log; no role can "fix" or erase history.
- **Integrity:** Where feasible, hash or sign critical fields (e.g. JE id, amount, date) for later verification.
- **Forensic runs:** Run results and failure rows retained; no modification of historical runs by ops.

---

## 6. References

- Existing audit logging (e.g. `audit_log` or equivalent) — align new operational events with same retention and access.
- [ACCOUNTING_REVERSAL_WORKFLOW.md](./ACCOUNTING_REVERSAL_WORKFLOW.md) — reversal metadata.
- [ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md](./ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md) — resolution sign-off.
