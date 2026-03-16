# Go-Live Accounting Readiness Checklist

Pre-launch checklist to confirm accounting operations are safe for external accountants, multi-client firms, and real-money tenants. **No change** to ledger or engine; verification and readiness only.

---

## 1. Monitoring and Forensic

- [ ] Forensic cron scheduled and running (e.g. nightly); `CRON_SECRET` and endpoint configured.
- [ ] Latest forensic run viewable (dashboard or API); `total_failures` and `check_counts` visible.
- [ ] Alerting (Slack/email) configured if desired (`FORENSIC_ALERT_*`); test alert once.
- [ ] Runbook and escalation owners documented ([ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md](./ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md)).
- [ ] No open forensic failures for go-live tenants (or documented and accepted exceptions).

---

## 2. Period and Posting

- [ ] Accounting periods exist for go-live range; at least one period open for posting.
- [ ] Period close and (if used) reopen permissions assigned (owner/partner).
- [ ] Posting guards in place (open period only; balance checks); no posting to closed period in normal flow.
- [ ] Reconciliation resolve flow tested (small and large delta paths); proposal_hash and idempotency verified.

---

## 3. Reversals and Adjustments

- [ ] Reversal workflow documented and (if implemented) UI/API available ([ACCOUNTING_REVERSAL_WORKFLOW.md](./ACCOUNTING_REVERSAL_WORKFLOW.md)).
- [ ] Adjustment governance and approval thresholds clear ([ACCOUNTING_ADJUSTMENT_GOVERNANCE.md](./ACCOUNTING_ADJUSTMENT_GOVERNANCE.md)).
- [ ] Mandatory reason/reference for adjustments and reversals enforced in UI or API.

---

## 4. Audit and Compliance

- [ ] Audit log (or equivalent) captures posting, reversals, period close/reopen, approvals ([ACCOUNTING_AUDIT_STANDARD.md](./ACCOUNTING_AUDIT_STANDARD.md)).
- [ ] Retention policy for audit and forensic data documented and implemented.
- [ ] No user-deletable or editable history for accounting audit events (append-only where applicable).

---

## 5. Tenant and Access

- [ ] RLS and roles restrict ledger and period operations by tenant and role.
- [ ] Archived tenant handling and monitoring exclusion understood ([ACCOUNTING_TENANT_SAFETY_GOVERNANCE.md](./ACCOUNTING_TENANT_SAFETY_GOVERNANCE.md)).
- [ ] Reactivation procedure (if offered) requires approval and is logged.

---

## 6. UI and Guardrails

- [ ] Warnings and required fields for reversals and adjustments per [ACCOUNTING_UI_GUARDRAILS.md](./ACCOUNTING_UI_GUARDRAILS.md) (to the extent implemented).
- [ ] Period and JE lock indicators visible where relevant (closed period, reversed JE).
- [ ] Audit visibility: link or view for accounting actions and forensic runs.

---

## 7. Runbooks and Ops

- [ ] Daily/monthly/emergency procedures documented and assigned ([ACCOUNTING_GO_LIVE_RUNBOOK.md](./ACCOUNTING_GO_LIVE_RUNBOOK.md)).
- [ ] Escalation path for forensic and ledger anomalies defined and communicated.
- [ ] Go-live owner(s) and support contact(s) named.

---

## 8. Sign-Off

- [ ] **Accounting operations lead / partner:** Readiness confirmed for go-live.
- [ ] **Technical:** Forensic and posting paths verified; no known blocking issues.
- [ ] **Date:** _____________________  
- **Signature / name:** _____________________

---

## References

- [ACCOUNTING_OPERATIONS_LAYER.md](./ACCOUNTING_OPERATIONS_LAYER.md) — Overview and index.
- All linked SOPs, runbooks, and governance docs in the index.
