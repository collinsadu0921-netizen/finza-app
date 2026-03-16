# Tenant Safety Governance

Rules for archived tenants, historical record retention, reactivation, and forensic monitoring exclusions. **Does not change** RLS or forensic SQL; defines operational policy only.

---

## 1. Archived Tenant Handling

- **Definition:** Tenant (business) marked as archived (e.g. `businesses.archived_at` set).
- **Behaviour (existing):**
  - Forensic monitoring **excludes** archived tenants (runner filters by `archived_at IS NULL`).
  - Archived data remains in DB for retention; access controlled by RLS and product (e.g. read-only, or hidden from default views).
- **Operations:**
  - **No posting** to archived tenants (enforced by product: disable post/reverse/adjust for archived business).
  - **No period close/reopen** for archived tenants in normal operations.
  - **Reporting:** Optional "Include archived" for historical reports; default exclude.

---

## 2. Historical Record Retention

- **Ledger and JEs:** Retain per regulatory/firm policy (e.g. 7 years); do not delete for audit defensibility.
- **Audit log:** Same retention as accounting records; append-only; no user deletion.
- **Forensic runs and failures:** Retain run history and failure rows for at least the same period as audit (e.g. 1–2 years minimum for ops review).
- **Archived tenants:** Data retained; access and visibility per "Archived tenant handling" above.

---

## 3. Reactivation Procedures

- **Reactivation** = clearing archive flag (e.g. `archived_at` set to null) so tenant appears active again.
- **Approval:** Reactivation should require **owner or partner** (or platform admin) approval; document reason and date.
- **After reactivation:**
  - Tenant is included in forensic monitoring again (next run).
  - Posting and period operations follow same rules as for any active tenant (open periods only, etc.).
- **Audit:** Log reactivation event: business_id, reactivated_by, reason, timestamp.

---

## 4. Forensic Monitoring Exclusions

- **Archived tenants:** Excluded from forensic run (existing behaviour: `businesses.archived_at IS NULL` in runner).
- **No other exclusions** by default (e.g. no per-tenant "opt out" of monitoring).
- **Operational note:** If a tenant is excluded by archival, failures in that tenant’s data are not reported until reactivation; ensure archival is intentional and documented.

---

## 5. References

- Forensic monitoring: [FORENSIC_NIGHTLY_RUNBOOK.md](./FORENSIC_NIGHTLY_RUNBOOK.md); migration 255 (archived exclusion).
- RLS and access: existing policies; this doc does not change them.
