# Accounting Period Operations SOP

Standard operating procedures for closing periods, soft closing, reopening, and handling late adjustments. **No change** to period locking architecture or ledger schema; only human procedures and safeguards.

---

## 1. Closing Periods

### 1.1 Prerequisites

- All reconciliations for the period resolved (or accepted with documentation).
- No open forensic failures for the business (or documented exception).
- Trial balance and key reports reviewed for the period.

### 1.2 Procedure

1. Run period-close readiness checks (per app: e.g. AR vs operational, mismatch count).
2. Resolve or document any blocking items.
3. Execute **close** in UI (or via supported API); period status becomes closed.
4. Record in audit log: period_id, closed_by, closed_at, and any notes.

### 1.3 Approval workflow

- **Close:** Typically **owner** or **partner** only (per product configuration).
- **Audit trail:** Who closed, when, and from which IP/session if available.

### 1.4 Risk controls

- No posting allowed to closed period (enforced by posting engine).
- Reversal/adjustment in closed period only after **reopen** (see below).

---

## 2. Soft Closing

- **Definition:** Period is marked "soft closed" so that only designated roles can post (e.g. adjustments before final close).
- **Use:** Allow late adjustments under control before hard close.
- **Rules:** Per product: which roles can post in soft-closed period; audit trail for all posts in soft-closed period.
- **Transition:** Soft close → (review) → hard close when no further adjustments expected.

---

## 3. Reopening Periods

### 3.1 When to reopen

- Genuine error in closed period (wrong amount, duplicate, wrong account).
- Regulatory or audit requirement to add/correct prior-period entry.
- **Not** for routine convenience; must be justified and approved.

### 3.2 Procedure

1. **Request:** Document reason, affected period, intended correction (reversal/adjustment).
2. **Approval:** **Owner or partner** (or configured role) must approve reopen.
3. **Reopen:** Execute reopen in UI/API for that period; period becomes open (or soft open) for corrections.
4. **Correct:** Perform reversal or adjustment per [ACCOUNTING_REVERSAL_WORKFLOW.md](./ACCOUNTING_REVERSAL_WORKFLOW.md) and [ACCOUNTING_ADJUSTMENT_GOVERNANCE.md](./ACCOUNTING_ADJUSTMENT_GOVERNANCE.md).
5. **Re-close:** After correction, close period again; document "Reclosed after reopen for &lt;reason&gt;."

### 3.3 Partner / owner authority

- Only designated roles can approve reopen (no self-service by junior staff).
- Reopen must be logged: who requested, who approved, reason, period, timestamp.

### 3.4 Audit trail requirements

- Log: action = period_reopen, period_id, business_id, requested_by, approved_by, reason, timestamp.
- Retain for same retention as other accounting audit events.

---

## 4. Handling Late Adjustments

- **Before close:** Post in open period as normal; no special procedure.
- **After close:** Treated as **reopen** workflow: approve reopen → post correction → re-close.
- **Materiality:** Large or material late adjustments should have explicit approval and documentation (per [ACCOUNTING_ADJUSTMENT_GOVERNANCE.md](./ACCOUNTING_ADJUSTMENT_GOVERNANCE.md)).

---

## 5. Communication Procedures

- **Before month-end close:** Notify relevant users of close deadline and soft-close policy.
- **After close:** Confirm close in internal comms; list period and closed_by.
- **After reopen:** Notify if reopen affects reports or downstream processes; document in runbook.

---

## 6. References

- [ACCOUNTING_REVERSAL_WORKFLOW.md](./ACCOUNTING_REVERSAL_WORKFLOW.md)
- [ACCOUNTING_ADJUSTMENT_GOVERNANCE.md](./ACCOUNTING_ADJUSTMENT_GOVERNANCE.md)
- [ACCOUNTING_AUDIT_STANDARD.md](./ACCOUNTING_AUDIT_STANDARD.md)
- Existing period close checks (e.g. `assert_accounting_period_is_open`, period close API).
