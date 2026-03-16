# Accounting Workspace Write Targets: Track B2 Classification

**Date:** 2025-01-17  
**Purpose:** Classify all tables written to by Accounting workspace routes  
**Scope:** READ-ONLY (no code changes)

---

## TASK B2.1 — Write Target Classification

### Classification Rules

- **ALLOWED:** Ledger tables (`journal_entries`, `journal_entry_lines`, `trial_balance_snapshots`), control tables (`accounting_periods`, `accounting_firms`), audit tables (`accounting_period_actions`, `accounting_firm_activity_logs`), draft tables (`manual_journal_drafts`, `opening_balance_batches`)
- **EXCEPTION:** Operational tables that Accounting workspace is allowed to write to for business reasons (must be explicitly guarded)
- **VIOLATION:** Operational tables that Accounting workspace should NOT write to

---

## Write Target Classification

| Table | Route(s) | Write Operation | Classification | Reason |
|-------|----------|-----------------|----------------|--------|
| `journal_entries` | `/api/accounting/opening-balances/apply`<br>`/api/accounting/adjustments/apply`<br>`/api/accounting/carry-forward/apply`<br>`/api/accounting/opening-balances/[id]/post`<br>`/api/accounting/journals/drafts/[id]/post` | INSERT (via RPC: `apply_opening_balances`, `apply_adjusting_journal`, `apply_carry_forward`, `post_journal_entry`) | ✅ **ALLOWED** | Core ledger table |
| `journal_entry_lines` | Same as above | INSERT (via RPC) | ✅ **ALLOWED** | Core ledger table |
| `opening_balance_batches` | `/api/accounting/opening-balances/apply` | INSERT (via RPC: `apply_opening_balances`) | ✅ **ALLOWED** | Ledger control table |
| `accounting_periods` | `/api/accounting/periods/close` | UPDATE (status, timestamps) | ✅ **ALLOWED** | Control table - period management |
| `accounting_period_actions` | `/api/accounting/periods/close`<br>`/api/accounting/periods/reopen` | INSERT (audit records) | ✅ **ALLOWED** | Audit/control table |
| `accounting_firms` | `/api/accounting/firm/onboarding/complete` | UPDATE (onboarding_status, metadata) | ✅ **ALLOWED** | Control table - firm management |
| `manual_journal_drafts` | `/api/accounting/journals/drafts`<br>`/api/accounting/journals/drafts/[id]` | INSERT, UPDATE | ✅ **ALLOWED** | Draft/control table |
| `accounting_firm_activity_logs` | `/api/accounting/firm/engagements`<br>`/api/accounting/firm/engagements/[id]`<br>`/api/accounting/firm/onboarding/complete` | INSERT (via `logFirmActivity` lib function) | ✅ **ALLOWED** | Audit table |
| `firm_client_engagements` | `/api/accounting/firm/engagements`<br>`/api/accounting/firm/engagements/[id]` | INSERT (POST), UPDATE (PATCH) | ⚠️ **EXCEPTION** | Operational table - engagement management (Accounting workspace needs to manage client engagements) |
| `opening_balance_imports` | `/api/accounting/opening-balances`<br>`/api/accounting/opening-balances/[id]`<br>`/api/accounting/opening-balances/[id]/approve`<br>`/api/accounting/opening-balances/[id]/post` | INSERT (POST), UPDATE (PATCH, POST approve) | ⚠️ **EXCEPTION** | Operational table - draft import workflow (Accounting workspace needs to manage draft imports before posting to ledger) |

---

## Summary

### ALLOWED Tables (8 total)
- `journal_entries` - Ledger (via RPC)
- `journal_entry_lines` - Ledger (via RPC)
- `opening_balance_batches` - Ledger control (via RPC)
- `accounting_periods` - Control (direct write)
- `accounting_period_actions` - Audit (direct write)
- `accounting_firms` - Control (direct write)
- `manual_journal_drafts` - Draft/control (direct write)
- `accounting_firm_activity_logs` - Audit (via lib function)

### EXCEPTION Tables (2 total)
- `firm_client_engagements` - Operational (engagement management)
- `opening_balance_imports` - Operational (draft import workflow)

### VIOLATION Tables (0 total)
- None found

---

## EXCEPTION Justification

### `firm_client_engagements`
**Reason:** Accounting workspace requires the ability to create and manage firm-client engagements as part of its core functionality. This is an intentional boundary crossing that enables the Accountant-First model where accounting firms manage their client relationships.

**Routes:**
- `/api/accounting/firm/engagements` (POST) - Creates engagement
- `/api/accounting/firm/engagements/[id]` (PATCH) - Updates engagement status/access

**Status:** ✅ Documented, needs explicit guard

---

### `opening_balance_imports`
**Reason:** Accounting workspace requires a draft/import workflow for opening balances before they are posted to the ledger. This table serves as a staging area for opening balance data before canonical ledger posting.

**Routes:**
- `/api/accounting/opening-balances` (POST) - Creates draft import
- `/api/accounting/opening-balances/[id]` (PATCH) - Updates draft import
- `/api/accounting/opening-balances/[id]/approve` (POST) - Approves draft import
- `/api/accounting/opening-balances/[id]/post` (POST) - Posts draft import to ledger

**Status:** ✅ Documented, needs explicit guard

---

## Notes

1. **RPC Functions:** Most ledger writes occur via RPC functions (`apply_opening_balances`, `apply_adjusting_journal`, `apply_carry_forward`, `post_journal_entry`). These functions write to ledger tables and are ALLOWED.

2. **Direct Writes:** Some routes write directly to control/audit tables (`accounting_periods`, `accounting_period_actions`, `accounting_firms`, `manual_journal_drafts`). These are ALLOWED as they are control/audit tables, not operational data.

3. **EXCEPTION Tables:** Only 2 tables are EXCEPTIONS (`firm_client_engagements`, `opening_balance_imports`). Both are necessary for Accounting workspace functionality and must be explicitly guarded.

---

**END OF CLASSIFICATION**
