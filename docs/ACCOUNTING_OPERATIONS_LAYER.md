# Accounting Operations Layer — Overview

**Purpose:** Human-operational layer governing how accountants safely operate Finza. This layer does **not** modify ledger architecture, posting logic, or accounting contracts. The accounting engine remains immutable.

---

## Scope

| Governs | Does not change |
|--------|------------------|
| Error correction workflows | Ledger schema |
| Reversal procedures | Posting engine |
| Monitoring response procedures | Forensic SQL / monitoring logic |
| Accountant operational controls | Accounting contract |
| Audit-ready runbooks | Period locking architecture |
| Go-live operational readiness | Journal immutability / snapshot authority |

---

## Design Principles

- **Ledger immutable** — No edits or deletes to posted journal entries; corrections via new entries (reversals/adjustments).
- **Audit traceable** — Every operational action logged with actor, reason, and timestamp.
- **Period safe** — Posting and reversals only in open periods; period operations follow SOPs.
- **Accountant controlled** — Role-based authority; approvals where required.
- **Multi-tenant secure** — Tenant isolation; archived tenants excluded from forensic monitoring.
- **Financial audit defensible** — Reversals reference originals; audit trail supports regulatory scrutiny.

---

## Document Index

| Document | Content |
|----------|---------|
| [ACCOUNTING_REVERSAL_WORKFLOW.md](./ACCOUNTING_REVERSAL_WORKFLOW.md) | Reversal workflow spec, audit trail structure, approval rules |
| [ACCOUNTING_ADJUSTMENT_GOVERNANCE.md](./ACCOUNTING_ADJUSTMENT_GOVERNANCE.md) | When to reverse vs adjust vs new entry; approval thresholds; authority model |
| [ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md](./ACCOUNTING_FORENSIC_RESPONSE_RUNBOOK.md) | Response per failure type: investigation, correction, escalation, sign-off |
| [ACCOUNTING_PERIOD_OPERATIONS_SOP.md](./ACCOUNTING_PERIOD_OPERATIONS_SOP.md) | Closing, soft close, reopen, late adjustments; approval and audit |
| [ACCOUNTING_AUDIT_STANDARD.md](./ACCOUNTING_AUDIT_STANDARD.md) | Logging requirements, metadata, retention, tamper-resistance |
| [ACCOUNTING_GO_LIVE_RUNBOOK.md](./ACCOUNTING_GO_LIVE_RUNBOOK.md) | Daily/monthly/emergency procedures; launch readiness |
| [ACCOUNTING_UI_GUARDRAILS.md](./ACCOUNTING_UI_GUARDRAILS.md) | Warnings, justification fields, approval gating, lock indicators |
| [ACCOUNTING_TENANT_SAFETY_GOVERNANCE.md](./ACCOUNTING_TENANT_SAFETY_GOVERNANCE.md) | Archived tenants, retention, reactivation, monitoring exclusions |
| [ACCOUNTING_RISK_CONTROL_MATRIX.md](./ACCOUNTING_RISK_CONTROL_MATRIX.md) | Risk classification and controls per operation |
| [ACCOUNTING_GO_LIVE_CHECKLIST.md](./ACCOUNTING_GO_LIVE_CHECKLIST.md) | Go-live readiness checklist |
| [ACCOUNTING_CONTROL_SURFACE_IMPLEMENTATION.md](./ACCOUNTING_CONTROL_SURFACE_IMPLEMENTATION.md) | **UI + workflow implementation design** (reversal, adjustment, forensic, period, health, audit, guardrails, tenant admin) |

---

## Success Criteria

Finza is safe for:

- External accountants  
- Multi-client accounting firms  
- Financial audits  
- Regulatory scrutiny  
- Real-money accounting tenants  
