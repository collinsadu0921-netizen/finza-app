# AUDIT — AR Control Mapping Still Missing (Post–Phase 13)

**Role:** Principal Accounting Systems Auditor  
**Mode:** Evidence-only. No fixes. No recommendations.  
**Question audited:** *Why does `Missing control account mapping: AR` still occur after Phase 13?*

---

## EXECUTIVE CONCLUSION (UP FRONT)

**AR is still missing because the deployed bootstrap path does not create control mappings.**  
Phase 13 successfully changed *when* accounting initializes, but **did not complete *what* “initialized” means in system terms**.

The system is behaving **correctly and deterministically** given the current database state.

**Deployment note:** This conclusion holds when only migrations through **243** are applied. Migration **244** (`244_phase13_control_mapping_bootstrap.sql`) extends `ensure_accounting_initialized` to call `initialize_business_chart_of_accounts`, which creates AR, AP, CASH, BANK in `chart_of_accounts_control_map`. Once 244 is applied and bootstrap runs, control mappings are created and the error is addressed for new first-accounting-action flows.

---

## 1. Exact failure source (non-negotiable fact)

The error:

```text
Missing control account mapping: AR
```

**Source (file, function, line):**

- **File:** `supabase/migrations/098_chart_of_accounts_validation.sql`
- **Function:** `get_control_account_code(p_business_id UUID, p_control_key TEXT)`
- **Line:** 61 (first raise); 73 (second raise, if mapped code not in `chart_of_accounts`)

**Exact statement that raises:**

```sql
SELECT account_code INTO mapped_account_code
FROM chart_of_accounts_control_map
WHERE business_id = p_business_id
  AND control_key = p_control_key
LIMIT 1;

IF NOT FOUND THEN
  RAISE EXCEPTION 'Missing control account mapping: %', p_control_key;
END IF;
```

**Condition that triggers the error:** No row exists in `chart_of_accounts_control_map` for `(p_business_id, p_control_key)` — i.e. for the invoice’s business and control key `'AR'`.

**Call chain:** API (e.g. invoice send) → `ensure_accounting_initialized(business_id)` [243: creates accounts + period only; no control mappings] → update `invoices.status` → trigger `trigger_auto_post_invoice` → `post_invoice_to_ledger(invoice_id)` → `get_control_account_code(business_id_val, 'AR')` → SELECT from `chart_of_accounts_control_map` → NOT FOUND → **RAISE**.

**When the exception is raised:** Before any INSERT into `journal_entries` or `journal_entry_lines`. Posting correctly validates control mapping before writing.

---

## 2. Why the deployed bootstrap path does not create control mappings

**Bootstrap path (migration 243 only):**

1. `ensure_accounting_initialized(p_business_id)`  
   - Authority check (owner or admin/accountant).  
   - If `accounting_periods` has a row for business → RETURN (idempotent).  
   - `PERFORM create_system_accounts(p_business_id);` → INSERT into `accounts` only.  
   - `PERFORM initialize_business_accounting_period(p_business_id, v_start_date);` → INSERT into `accounting_periods` only.  
   - No call to any function that writes to `chart_of_accounts` or `chart_of_accounts_control_map`.

**Evidence:** `supabase/migrations/243_phase13_fortnox_accounting_bootstrap.sql` (lines 74–84): only `create_system_accounts` and `initialize_business_accounting_period` are invoked. No `initialize_business_chart_of_accounts`.

**Result:** After bootstrap (243 only), the business has rows in `accounts` and `accounting_periods` but **no** rows in `chart_of_accounts_control_map` for AR (or CASH, BANK, AP). Posting’s call to `get_control_account_code(..., 'AR')` therefore raises.

---

## 3. Deterministic behavior

- Bootstrap (243) does what it defines: accounts + one period.  
- Posting requires a row in `chart_of_accounts_control_map` for `'AR'` and raises when it is missing.  
- So the error is the **correct** outcome of the current contract: “initialized” in 243 does not include control mappings; posting assumes they exist.

No nondeterminism; no hidden path that sometimes creates mappings. The gap is in the **definition** of “initialized” in the deployed bootstrap, not in execution order or environment.

---

*Audit complete. Evidence only. No fixes. No recommendations.*
