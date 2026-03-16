# Accounting Operations — Risk Control Matrix

Risk classification and controls for key operations. **No change** to ledger or posting; reference only for SOPs and approvals.

---

## 1. Operation vs Risk vs Control

| Operation | Risk level | Control |
|-----------|------------|---------|
| **View ledger / reports** | Low | RLS; role-based read access. |
| **Post manual journal (open period)** | Medium | Accountant write; mandatory reason; balance check. |
| **Post adjustment (open period)** | Medium | Adjustment reason required; optional approval above threshold. |
| **Reverse JE (open period)** | Medium | Mandatory reversal reason; reference original; optional approval above threshold. |
| **Reconciliation resolve (small delta)** | Medium | Single approver (per policy); proposal_hash lock. |
| **Reconciliation resolve (large delta)** | High | Owner or two-person approval; proposal_hash lock. |
| **Period close** | High | Owner/partner only; readiness checks; audit log. |
| **Period reopen** | Critical | Owner/partner approval; mandatory reason; audit log; then correct and re-close. |
| **Forensic failure resolution** | Medium–High | Per runbook; document root cause and correction; sign-off. |
| **Reactivation of archived tenant** | High | Owner/partner approval; documented reason; audit log. |

---

## 2. By Risk Level

| Level | Examples | Typical control |
|-------|----------|------------------|
| **Low** | Read-only; view reports | RLS; no write. |
| **Medium** | Post in open period; reverse; resolve small reconciliation | Single accountant; mandatory reason; audit log. |
| **High** | Period close; large adjustment; reactivation | Owner/partner approval; full documentation. |
| **Critical** | Period reopen; bulk correction; override-like actions | Formal approval; runbook; audit trail; sign-off. |

---

## 3. Approval Thresholds (summary)

- **Single accountant:** Manual journal, adjustment, reversal, small reconciliation delta (per ledger adjustment policy).
- **Second approver or owner:** Large adjustment/reversal, large reconciliation delta, two-person rule.
- **Owner/partner only:** Period close, period reopen, tenant reactivation.

---

## 4. References

- [ACCOUNTING_ADJUSTMENT_GOVERNANCE.md](./ACCOUNTING_ADJUSTMENT_GOVERNANCE.md) — When to reverse vs adjust; thresholds.
- [ACCOUNTING_PERIOD_OPERATIONS_SOP.md](./ACCOUNTING_PERIOD_OPERATIONS_SOP.md) — Close/reopen.
- [ACCOUNTING_TENANT_SAFETY_GOVERNANCE.md](./ACCOUNTING_TENANT_SAFETY_GOVERNANCE.md) — Reactivation.
