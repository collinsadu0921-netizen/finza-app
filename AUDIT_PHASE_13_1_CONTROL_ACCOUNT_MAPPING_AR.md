# Audit — Phase 13.1: Control Account Mapping Gap (AR)

**Role:** Principal Accounting Systems Auditor  
**Mode:** Evidence-only. No fixes. No assumptions.  
**Scope:** Service workspace + accounting bootstrap + invoice posting (non-tax invoice).  
**Triggering error:** `Missing control account mapping: AR`

---

## 1. Control-account contract

### Authoritative list of required control accounts

- **Not a single enum.** Required control keys are implied by posting functions and by bootstrap migrations that create mappings.
- **Evidence:**  
  - `supabase/migrations/176_business_coa_bootstrap.sql` (lines 86–111): creates mappings for **AR** (1100), **AP** (2000), **CASH** (1000), **BANK** (1010).  
  - `supabase/migrations/187_retail_accounting_bootstrap.sql` (lines 114–159): same set (CASH, BANK, AR, AP).  
  - `supabase/migrations/100_control_account_resolution.sql` (lines 102, 116): `post_invoice_to_ledger` uses `get_control_account_code(..., 'AR')` and `get_account_by_control_key(..., 'AR')`.  
  - `supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql` (lines 83–86): same — AR resolved via control key.  
  - Revenue is fixed code `4000`, not a control key.

### Layer that enforces “mapping must exist”

- **Validation / resolution layer:** `get_control_account_code(p_business_id, p_control_key)` in **`supabase/migrations/098_chart_of_accounts_validation.sql`** (lines 45–78).  
- It reads `chart_of_accounts_control_map`; if no row exists for `(business_id, control_key)` it raises.  
- Posting functions (e.g. `post_invoice_to_ledger`) call `get_control_account_code` / `get_account_by_control_key` before building journal lines. So the **posting path** depends on this resolution; the **enforcement** is inside the resolution function, not a separate “guard” RPC.

**Deliverable — File paths + functions that expect an AR mapping:**

| Location | Function / usage |
|----------|-------------------|
| `supabase/migrations/098_chart_of_accounts_validation.sql` | `get_control_account_code` — raises if no mapping. |
| `supabase/migrations/100_control_account_resolution.sql` | `post_invoice_to_ledger`: `get_control_account_code(business_id_val, 'AR')`, `get_account_by_control_key(business_id_val, 'AR')`. |
| `supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql` | `post_invoice_to_ledger`: same (lines 84, 86). |
| `supabase/migrations/217_payment_posting_period_guard.sql` | Payment posting: AR, CASH, BANK via same helpers. |
| `supabase/migrations/227_payment_draft_invoice_guard.sql` | Same. |
| `supabase/migrations/224_get_ar_balances_by_invoice_rpc.sql` | `get_ar_balances_by_invoice`: reads `chart_of_accounts_control_map` with `control_key = 'AR'`. |
| `lib/accounting/reconciliation/engine-impl.ts` | `resolveARAccountId`: `.eq("control_key", "AR")` on `chart_of_accounts_control_map`. |

---

## 2. Data model reality

### Table that stores control-account mappings

- **Table:** `chart_of_accounts_control_map`  
- **Defined in:** `supabase/migrations/097_chart_of_accounts_tables.sql` (lines 41–58).

### Schema

| Column | Type | Constraints / notes |
|--------|------|---------------------|
| `id` | UUID | PRIMARY KEY, default gen_random_uuid() |
| `business_id` | UUID | NOT NULL, REFERENCES businesses(id) ON DELETE CASCADE |
| `control_key` | TEXT | NOT NULL |
| `account_code` | TEXT | NOT NULL |
| `created_at` | TIMESTAMPTZ | default NOW() |
| — | — | **UNIQUE (business_id, control_key)** |

- **Indexes:** `idx_chart_of_accounts_control_map_business_id`, `_control_key`, `_account_code`.

### How AR is represented

- **String key:** `control_key = 'AR'`.  
- No separate “control” table; no FK to a control table.  
- `account_code` is the target code (e.g. `1100` for AR) and must exist in `chart_of_accounts` (and in practice in `accounts`) for posting to resolve.

**Deliverable:**  
- Table: `chart_of_accounts_control_map`.  
- Columns: `id`, `business_id`, `control_key`, `account_code`, `created_at`.  
- Constraint: UNIQUE(business_id, control_key).  
- AR = control_key `'AR'`, typically mapped to account_code `'1100'`.

---

## 3. Bootstrap responsibility trace

| Step | Code path | AR mapping created? | Evidence |
|------|-----------|----------------------|----------|
| `create_system_accounts(business_id)` | `supabase/migrations/043_accounting_core.sql` (lines 66–116) | **No** | Only `INSERT INTO accounts (...)` with fixed codes (1000, 1010, 1020, 1100, …). No INSERT into `chart_of_accounts` or `chart_of_accounts_control_map`. |
| `initialize_business_accounting_period(...)` | `supabase/migrations/177_retail_accounting_period_initialization.sql` (lines 45–94) | **No** | Only checks/inserts `accounting_periods`. No reference to `chart_of_accounts_control_map`. |
| `ensure_accounting_initialized(business_id)` | `supabase/migrations/243_phase13_fortnox_accounting_bootstrap.sql` (lines 40–89) | **No** | Calls `create_system_accounts(p_business_id)` then `initialize_business_accounting_period(p_business_id, v_start_date)`. Does not call `initialize_business_chart_of_accounts` or any logic that inserts into `chart_of_accounts_control_map`. |

- **Documentation:** Phase 13 migration comment (243) says bootstrap “Creates CoA + one open period”. In practice “CoA” here means `accounts` rows only; it does not create `chart_of_accounts` or control mappings. So the comment is ambiguous relative to the Accounting Mode COA tables.

**Deliverable — INSERTs for AR mapping:**

- **None** of the three steps above perform an INSERT into `chart_of_accounts_control_map` for AR.  
- The only INSERTs that create the AR mapping in migrations are:
  - **`initialize_business_chart_of_accounts`** (176, lines 86–90):  
    `INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code) VALUES (p_business_id, 'AR', '1100') ON CONFLICT ...`
  - **`initialize_retail_accounting`** (187, lines 138–147): same for AR → 1100.

---

## 4. Posting failure path

Trace for **posting a non-tax invoice** (send invoice → trigger posts):

1. **API route:** e.g. `app/api/invoices/[id]/send/route.ts` — calls `ensureAccountingInitialized(supabase, invoice.business_id)` then `performSendTransition(...)` which updates `invoices` (e.g. `status = 'sent'`).
2. **Bootstrap:** `ensure_accounting_initialized(business_id)` runs (via RPC from `ensureAccountingInitialized`). Creates accounts + one period; does **not** create control mappings.
3. **Posting entry point:** DB trigger `trigger_auto_post_invoice` on `invoices` (AFTER INSERT OR UPDATE OF status), in `supabase/migrations/043_accounting_core.sql` (lines 948–952). When `status` becomes `'sent'`, it runs `trigger_post_invoice()` which calls `PERFORM post_invoice_to_ledger(NEW.id)` (line 941).
4. **Control-account resolution:** Inside `post_invoice_to_ledger` (current version in 226, lines 83–86):  
   `ar_account_code := get_control_account_code(business_id_val, 'AR');`  
   `PERFORM assert_account_exists(business_id_val, ar_account_code);`  
   `ar_account_id := get_account_by_control_key(business_id_val, 'AR');`
5. **Failure throw:** In **`get_control_account_code`** (`supabase/migrations/098_chart_of_accounts_validation.sql`, lines 54–62):  
   `SELECT account_code INTO mapped_account_code FROM chart_of_accounts_control_map WHERE business_id = p_business_id AND control_key = p_control_key LIMIT 1;`  
   `IF NOT FOUND THEN RAISE EXCEPTION 'Missing control account mapping: %', p_control_key;`  
   So for `p_control_key = 'AR'` the message is **`Missing control account mapping: AR`**.

**Condition that triggers the error:** No row in `chart_of_accounts_control_map` for `(business_id, 'AR')` for the invoice’s business.

**Before or after writes:** The exception is raised **before** any write to `journal_entries` or `journal_entry_lines`. In 226, the only writes in `post_invoice_to_ledger` happen after idempotency check, period check, and building of journal lines; all of that comes after the AR resolution block that calls `get_control_account_code`.

**Deliverable:**  
- Function that raises: **`get_control_account_code`** (098, line 61).  
- Condition: no row in `chart_of_accounts_control_map` for `(p_business_id, 'AR')`.  
- Timing: **before** any journal entry INSERT.

---

## 5. Historical behavior comparison

### How AR mapping was created before Phase 13

- **Not** implicitly during business creation in the sense of a trigger on `businesses` that inserts into `chart_of_accounts_control_map`.  
- **Evidence:**  
  - Trigger on `businesses` (050, 200, 202): only `trigger_create_system_accounts` → `create_system_accounts`. That function only inserts into `accounts`.  
  - Trigger 242 (Phase 12): `after_business_insert_initialize_accounting_period` → `initialize_business_accounting_period`; only `accounting_periods`.  
  - No migration attaches a trigger on `businesses` that calls `initialize_business_chart_of_accounts` or `initialize_retail_accounting` for **service** businesses.  
  - `initialize_retail_accounting` is used only for **retail**: trigger `trigger_auto_initialize_retail_accounting` on `businesses` (187, lines 190–193) when `NEW.industry = 'retail'`. So for **service**, no trigger ever created AR mapping at business creation.

- **One-time backfill:** `supabase/migrations/232_service_chart_of_accounts_backfill.sql`: for every `business_id` that has rows in `accounts`, it runs `PERFORM initialize_business_chart_of_accounts(biz.business_id)`. That creates `chart_of_accounts` rows and control mappings (AR, AP, CASH, BANK). So **existing** businesses that already had `accounts` got AR mapping at migration time. **New** service businesses created **after** 232 get `accounts` from `create_system_accounts` (trigger) but **never** get `initialize_business_chart_of_accounts` run for them, so they never get control mappings unless some other path is added.

- So before Phase 13, AR mapping for **new** service businesses was **not** created by any automated path; the gap existed for new service businesses post-232. Phase 13 did not remove a path that created AR mapping for service; it removed the trigger that created **accounts** and **periods** at business insert and replaced it with lazy bootstrap that still only creates accounts + period, not control mappings.

**Deliverable:**  
- Migrations that previously created AR mapping: **176** (`initialize_business_chart_of_accounts`) and **187** (`initialize_retail_accounting`).  
- Neither is triggered by service business creation.  
- **232** is a one-time backfill calling `initialize_business_chart_of_accounts` for businesses that already had `accounts`.  
- Phase 13 did **not** remove or bypass a path that created AR mapping for new service businesses; such a path did not exist. Phase 13 bootstrap (`ensure_accounting_initialized`) also does not create the mapping, so the gap remains and is what causes the error.

---

## 6. Contract alignment check

Phase 13 contract: *“Accounting initializes only when the business performs its first accounting action.”*

- **Control-account mapping** is required for the first **posting** action (e.g. post invoice) to succeed. Posting uses `get_control_account_code` / `get_account_by_control_key`, which assume a row in `chart_of_accounts_control_map`. So for “first accounting action” to be posting, the system implicitly assumes that by the time we post, the business has both accounts (and period) and control mappings.  
- In the codebase, **creating** control mappings is treated as part of “COA bootstrap” (176: “initialize chart_of_accounts and control mappings”; 232: “syncs accounts → chart_of_accounts and ensures control mappings”). So control mapping is part of **accounting setup / initialization** (configuration of which account is AR, CASH, etc.), not “configuration” in the sense of optional user preferences.  
- **Current behavior:** Bootstrap (Phase 13) creates `accounts` and one `accounting_period` but does **not** create `chart_of_accounts` or `chart_of_accounts_control_map`. So when the first accounting action (e.g. send invoice) runs, posting fails with `Missing control account mapping: AR`. The system therefore does not complete “accounting initialization” in the sense required for that first action to succeed.

**Deliverable — One-paragraph conclusion:**

The Phase 13 contract says accounting initializes on first accounting action. In practice, “initialization” is implemented as creating accounts and one period only; control-account mapping (including AR) is not created by bootstrap. Control mapping is defined in migrations 176/187 as part of COA/accounting setup and is required by the posting layer. So the current failure is a **contract completion signal**: the system’s notion of “initialization” is incomplete relative to what posting requires. The **exact missing responsibility** is: no step in `ensure_accounting_initialized` (or in the two functions it calls) inserts into `chart_of_accounts_control_map` (or syncs to `chart_of_accounts` and then creates that mapping). Ownership for creating the AR mapping has historically lain with `initialize_business_chart_of_accounts` (and, for retail, `initialize_retail_accounting`); that responsibility was never wired into service business creation or into Phase 13 bootstrap, so the missing write is the creation of the AR (and typically CASH, BANK, AP) control mappings during bootstrap—either by calling an existing initializer that does it or by adding an equivalent step.

---

## Exit criteria — Summary

| Item | Result |
|------|--------|
| **Exact missing write / responsibility** | No INSERT into `chart_of_accounts_control_map` for `control_key = 'AR'` (and typically CASH, BANK, AP) during Phase 13 bootstrap. `ensure_accounting_initialized` does not call `initialize_business_chart_of_accounts` and does not perform that write itself. |
| **Ownership** | Single layer: **bootstrap**. The posting layer (e.g. `post_invoice_to_ledger`) correctly assumes mappings exist; the gap is that bootstrap never creates them for service. |
| **System behavior** | Behaving **incompletely**: initialization (accounts + period) runs, but the contract implied by posting (mappings exist) is not fulfilled, so the first posting action fails. Not “correct but strict”; the system’s own initialization is incomplete. |

---

*Audit complete. No fixes, no recommendations. Evidence only.*
