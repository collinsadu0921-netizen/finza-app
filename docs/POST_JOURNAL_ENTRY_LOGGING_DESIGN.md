# post_journal_entry Call-Site Audit & Failure Logging Design

**Scope:** Audit all `post_journal_entry` call sites; design logging that records business_id, reference_type, reference_id, error_message, stack trace, timestamp, posting_source. **No migration or code implemented** — schema proposal and integration plan only.

---

## 1. Call-Site Audit

### 1.1 Canonical Entry Point

- **Function:** `post_journal_entry(p_business_id, p_date, p_description, p_reference_type, p_reference_id, p_lines, p_is_adjustment, … p_posting_source, p_is_revenue_correction)`  
- **Definition:** Latest in `supabase/migrations/253_accounting_adoption_boundary.sql` (Contract v2.0 adoption boundary). Previous versions in 252, 228, 190, 189, 188, etc.  
- **Signature:** 16 parameters; returns UUID (journal entry id). All call paths eventually invoke this single function (or a wrapper that forwards to it).

### 1.2 Database Call Sites (PL/pgSQL → post_journal_entry)

These **functions** call `post_journal_entry` (via `SELECT post_journal_entry(...)`). Triggers or other code call these wrappers, not `post_journal_entry` directly in most operational paths.

| Caller function | Migration(s) | reference_type (typical) | posting_source | Invoked by |
|-----------------|-------------|---------------------------|----------------|------------|
| **post_invoice_to_ledger** | 190, 220, 226, 228 | invoice | system | Invoice send / finalisation; API or trigger |
| **post_bill_to_ledger** | 190 | bill | system | Bill finalisation |
| **post_expense_to_ledger** | 190, 229 | expense | system | Expense INSERT trigger |
| **post_credit_note_to_ledger** | 190 | credit_note | system | Credit note trigger (219) |
| **post_invoice_payment_to_ledger** | 190, 217, 227 | payment | system | Payment INSERT trigger; explicit RPC |
| **post_bill_payment_to_ledger** | 190 | bill_payment | system | Bill payment flow |
| **post_payment_to_ledger** | 217, 227 | payment | system | Payment INSERT trigger (218) |
| **post_sale_to_ledger** | 179, 182, 183, 184, 190 | sale | system | POS/sales create; trigger or API |
| **Refund/void posting** | 174, 191, 192 | payment / credit_note | system | Refund/void handlers |
| **Layaway installment posting** | 197 | sale | system | Layaway flow |
| **Purchase order / receive** | 198 | (PO-related) | system | PO receive |
| **Stock transfer** | 196 | (transfer) | system | Stock transfer |
| **Manual journal draft post** | 189, 148 | manual_draft | accountant | Draft posting API (148) |
| **Adjustment apply** | 228 | adjustment | accountant | Adjustment apply flow |

Trigger chain examples:

- **Invoice:** Send/finalise → `post_invoice_to_ledger` → `post_journal_entry`.
- **Payment:** INSERT payment → trigger → `post_payment_to_ledger` or `post_invoice_payment_to_ledger` → `post_journal_entry`.
- **Expense:** INSERT expense → trigger → `post_expense_to_ledger` → `post_journal_entry`.
- **Credit note:** INSERT/update → trigger (219) → `post_credit_note_to_ledger` → `post_journal_entry`.

### 1.3 Application Call Sites (TypeScript → RPC post_journal_entry)

| Location | reference_type | posting_source | Notes |
|----------|----------------|----------------|-------|
| **app/api/accounting/reconciliation/resolve/route.ts** (L294) | reconciliation | accountant | Posts reconciliation fix JE; passes p_posting_source: "accountant". |
| **app/api/accounts/year-end-close/route.ts** (L138) | manual | (may use wrapper default) | Year-end close; passes p_lines (JSON.stringify); may omit some params and rely on DB wrapper. |
| **app/api/accounting/__tests__/revenue-recognition-invariants.test.ts** | invoice, payment, adjustment | (test) | Direct RPC to test rejection rules. |
| **app/api/accounting/__tests__/revenue-recognition.test.ts** | payment, invoice, adjustment | (test) | Same. |
| **app/api/accounting/periods/__tests__/posting-block.test.ts** | invoice, direct | (test) | post_invoice_to_ledger and direct post_journal_entry. |
| **app/api/accounting/__tests__/ledger-immutability.test.ts** | (test) | (test) | Direct RPC. |

Application paths that go through **wrappers** (no direct RPC to `post_journal_entry`):

- Invoice send → `post_invoice_to_ledger` (API or trigger).
- Expense create → trigger → `post_expense_to_ledger`.
- Payment create → trigger → `post_payment_to_ledger` / `post_invoice_payment_to_ledger`.
- Sales create → `post_sale_to_ledger` (e.g. app/api/sales/create/route.ts references it).

### 1.4 Summary

- **Single canonical function:** All ledger posts flow through one `post_journal_entry` (or a thin wrapper that forwards to it).  
- **DB call sites:** 14+ wrapper functions across migrations 174, 190, 191, 192, 196, 197, 198, 217, 220, 226, 227, 228, 229, 189, etc.  
- **App call sites:** 2 production routes (reconciliation resolve, year-end close) + tests.  
- **Logging in one place:** Implementing failure logging inside `post_journal_entry` covers every call site (DB and app) without touching wrappers or app code.

---

## 2. Schema Proposal (Log Table)

### 2.1 Table: `post_journal_entry_failure_log`

**Purpose:** Record every **failure** of `post_journal_entry` (exception path only). Success path is not logged to this table to limit size and focus on debugging.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| **id** | UUID | NOT NULL | Primary key, default gen_random_uuid(). |
| **business_id** | UUID | NOT NULL | p_business_id from the call. |
| **reference_type** | TEXT | NULL | p_reference_type (invoice, payment, adjustment, etc.). |
| **reference_id** | UUID | NULL | p_reference_id. |
| **error_message** | TEXT | NOT NULL | Exception message (e.g. SQLERRM). |
| **stack_trace** | TEXT | NULL | Call stack / context (e.g. PG_EXCEPTION_CONTEXT or equivalent). |
| **occurred_at** | TIMESTAMPTZ | NOT NULL | When the failure occurred (default NOW()). |
| **posting_source** | TEXT | NULL | p_posting_source ('system' or 'accountant'). |
| **sqlstate** | TEXT | NULL | Optional: SQLSTATE from GET STACKED DIAGNOSTICS for categorisation. |

**Constraints / indexes:**

- Primary key on `id`.
- Index on `(business_id, occurred_at DESC)` for per-tenant recent failures.
- Index on `(occurred_at DESC)` for global recent failures and retention pruning.
- Optional: index on `(reference_type, reference_id)` for lookup by entity.

**RLS / access:**

- Writes: only from `post_journal_entry` (SECURITY DEFINER) or service role; no direct INSERT from app.
- Reads: restrict to service role / backend only (log contains error details); optionally allow read for business_id = owner’s business for support dashboards.

### 2.2 Why These Columns

- **business_id, reference_type, reference_id:** Identify which entity and tenant the post was for; required for triage and correlation with invoices, payments, etc.  
- **error_message:** Exact exception message (e.g. “Journal entry must balance”, “No accounting period found”, “Draft invoices cannot post revenue”).  
- **stack_trace:** In Postgres, use GET STACKED DIAGNOSTICS … PG_EXCEPTION_CONTEXT to get the in-DB call stack (function names and line numbers). Improves debugging when the failure is deep inside a wrapper.  
- **occurred_at:** When the failure happened (timestamp).  
- **posting_source:** Distinguishes system vs accountant posts; useful for support and audit.  
- **sqlstate:** Optional; allows filtering by error class (e.g. P0001 for custom business rules).

---

## 3. Integration Plan

### 3.1 Where to Log

- **Inside `post_journal_entry`** in an **EXCEPTION block** at the end of the function.  
- On any exception (validation, period check, INSERT failure, trigger failure, etc.):
  1. GET STACKED DIAGNOSTICS to capture SQLERRM, SQLSTATE, PG_EXCEPTION_CONTEXT.
  2. INSERT one row into `post_journal_entry_failure_log` with: business_id = p_business_id, reference_type = p_reference_type, reference_id = p_reference_id, error_message = SQLERRM, stack_trace = PG_EXCEPTION_CONTEXT, occurred_at = NOW(), posting_source = p_posting_source, sqlstate = SQLSTATE.
  3. Re-raise the exception so callers still receive the error (no swallowing).

**Result:** Every call site (all DB wrappers and both app routes) is covered without changing any caller.

### 3.2 Implementation Sketch (conceptual; no migration written)

- In the migration that adds the table and the one that alters `post_journal_entry`:
  1. Create table `post_journal_entry_failure_log` as above.  
  2. Wrap the **entire body** of `post_journal_entry` in a block with `EXCEPTION WHEN OTHERS THEN`:  
     - Declare variables for `v_sqlstate TEXT`, `v_sqlerrm TEXT`, `v_context TEXT`.  
     - In the handler: `GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT, v_context = PG_EXCEPTION_CONTEXT;`  
     - `INSERT INTO post_journal_entry_failure_log (business_id, reference_type, reference_id, error_message, stack_trace, occurred_at, posting_source, sqlstate) VALUES (p_business_id, p_reference_type, p_reference_id, v_sqlerrm, v_context, NOW(), p_posting_source, v_sqlstate);`  
     - `RAISE;` (re-raise to preserve original error to caller).  
- Ensure the INSERT is inside the same transaction so that if the INSERT fails, the original exception still propagates (or use a separate savepoint if you want to guarantee log write even when log table has issues).

### 3.3 Edge Cases

- **INSERT into log fails (e.g. table full, permission):** Prefer re-raise of the **original** exception so the posting failure is not masked. Optionally use a subtransaction (SAVEPOINT) around the INSERT and on failure ignore and still re-raise original.  
- **p_posting_source NULL:** Log stores NULL; the function already raises before reaching the INSERT (posting_source required). So failure log rows will only appear for calls that passed validation and then failed later (e.g. period check, INSERT journal_entries). For “posting_source required” failures, no row is written unless you add a separate log point at the top on that exception (optional).  
- **Very long error_message or stack_trace:** Consider truncating to a max length (e.g. 2000 chars) to avoid storage issues; document limit in schema comment.

### 3.4 App-Layer Consideration (optional)

- **Reconciliation resolve** and **year-end close** already get the RPC error in `postError` / catch and return it to the client. No change required for that.  
- If you later add a **support dashboard**, it can query `post_journal_entry_failure_log` filtered by business_id (and optionally reference_id) to show recent posting failures.  
- **Retention:** Plan a policy (e.g. delete or archive rows older than 90 days) to avoid unbounded growth; can be a scheduled job or retention policy in the migration.

### 3.5 Order of Work (no implementation in this doc)

1. **Migration 1:** Create table `post_journal_entry_failure_log` with columns and indexes above; add RLS if needed.  
2. **Migration 2:** Alter `post_journal_entry` to add the EXCEPTION block, GET STACKED DIAGNOSTICS, INSERT, and RAISE.  
3. **Optional:** Retention job or policy for old rows.  
4. **Optional:** Admin or support view/dashboard over the log table.

---

## 4. Summary

| Item | Result |
|------|--------|
| **Call sites** | One canonical `post_journal_entry`; 14+ DB wrapper functions (invoice, bill, expense, credit_note, payment, bill_payment, sale, refund/void, layaway, PO, stock transfer, manual draft, adjustment); 2 production app routes (reconciliation resolve, year-end close) + tests. |
| **Schema** | Table `post_journal_entry_failure_log`: id, business_id, reference_type, reference_id, error_message, stack_trace, occurred_at, posting_source, sqlstate (optional). |
| **Integration** | Single point: EXCEPTION handler inside `post_journal_entry`; GET STACKED DIAGNOSTICS; INSERT one row; RAISE to preserve error. No changes to call sites. |
| **Migrations** | Not implemented in this document; schema and integration plan only. |
