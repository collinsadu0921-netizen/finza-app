# Accounting Startup & Posting Fix Report

## 1. Root cause (with evidence)

**Observed:** Trial Balance UI shows *"Failed to load ledger / Unable to start accounting. Please try again."* and posting an invoice payment fails with *"Unable to start accounting"*.

**Call path identified:**

| Step | Location | What happens |
|------|-----------|----------------|
| UI | `app/accounting/trial-balance/page.tsx` | Calls `GET /api/accounting/trial-balance?business_id=…&period=YYYY-MM` |
| UI | `app/accounting/ledger/page.tsx` | Calls `GET /api/ledger/list?business_id=…` |
| API | `app/api/accounting/trial-balance/route.ts` | Calls `ensureAccountingInitialized(supabase, businessId)` then `get_trial_balance_from_snapshot(p_period_id)` |
| API | `app/api/ledger/list/route.ts` | Calls `ensureAccountingInitialized(supabase, businessId)` then ledger query |
| API | `app/api/invoices/[id]/mark-paid/route.ts` | Calls `ensureAccountingInitialized(supabase, business.id)` then inserts payment (trigger posts to ledger) |
| Bootstrap | `lib/accountingBootstrap.ts` | Calls RPC `ensure_accounting_initialized(p_business_id)` |
| DB | Migration 245 | `ensure_accounting_initialized` → `create_system_accounts` → `initialize_business_chart_of_accounts` → (if no period) `initialize_business_accounting_period` |

**Exact thrown error:** The message *"Unable to start accounting. Please try again."* is the **generic** string returned when the RPC `ensure_accounting_initialized` returns an error. The **underlying** error was not previously returned to the client or logged in a structured way, so the root cause is one of:

- **Auth:** RPC raises *"Not allowed to initialize accounting for this business"* (caller not owner/admin/accountant).
- **Constraint/index:** After CoA dedup (248/249/250), the table `accounts` has a **partial** unique index `accounts_unique_business_code_active_idx` on `(business_id, code) WHERE deleted_at IS NULL`. The original constraint `accounts_business_id_code_key` is dropped. If the index was not created (e.g. migration failed at STEP 11 due to remaining duplicates), then `create_system_accounts` uses `ON CONFLICT (business_id, code) DO NOTHING`, which **requires** a unique constraint/index; without it, Postgres raises: *"there is no unique or exclusion constraint matching the ON CONFLICT specification"*.
- **Orphan / integrity:** If `initialize_business_chart_of_accounts` or `initialize_business_accounting_period` touches data that references deleted or duplicate accounts, an FK or unique violation could occur.

**Evidence to gather:** Run the SQL checks below and reproduce the request; the API now returns and logs **structured error** with `step`, `business_id`, and `supabase_error` (message, code, details). Server logs and the 500 JSON body will show the real Postgres/RPC error.

---

## 2. Minimal patch steps (files + functions)

**Done in this pass:**

1. **`lib/accountingBootstrap.ts`**
   - Added `AccountingBootstrapError` type and `structuredError` in the return when the RPC fails.
   - Log and return `step`, `business_id`, `supabase_error` (message, code, details).

2. **`app/api/accounting/trial-balance/route.ts`**
   - On bootstrap failure: return 500 with JSON `{ error, error_code, step, business_id, supabase_error }`.
   - On period fetch failure: return 500 with `step: "fetch_period"` and `supabase_error`.
   - On `get_trial_balance_from_snapshot` failure: return 500 with `step: "get_trial_balance_from_snapshot"`, `period_id`, `period_start`, `period_end`, `supabase_error`.
   - Removed duplicate period fetch and fixed variable reuse (single `accountingPeriod` fetch, derive `periodEnd` from it).

3. **`app/api/ledger/list/route.ts`**
   - On bootstrap failure: return 500 with same structured JSON.
   - On ledger query failure: return 500 with `step: "ledger_list_query"`, `business_id`, `supabase_error`.

4. **`app/api/invoices/[id]/mark-paid/route.ts`**
   - On bootstrap failure: return 500 with same structured JSON.

5. **`app/accounting/trial-balance/page.tsx`** and **`app/accounting/ledger/page.tsx`**
   - When API returns 500, if `supabase_error.message` is present, show it in the error message so the real DB error is visible (e.g. in dev).

6. **`scripts/accounting-integrity-checks.sql`**
   - Read-only SQL: duplicate active accounts, orphan `journal_entry_lines`, partial unique index on `accounts`, resolver RPCs existence, duplicate `chart_of_accounts` by code.

**No new migrations.** All changes are code + one SQL check script.

---

## 3. DB integrity checks (run and interpret)

Run in Supabase SQL Editor (optionally restrict by `business_id`):

```sql
-- 1) Duplicate active accounts (must be 0)
SELECT business_id, code, count(*) FROM accounts WHERE deleted_at IS NULL
GROUP BY business_id, code HAVING count(*) > 1 ORDER BY count(*) DESC;

-- 2) Orphan journal_entry_lines (must be 0)
SELECT count(*) AS orphan_jel FROM journal_entry_lines jel
LEFT JOIN accounts a ON a.id = jel.account_id WHERE a.id IS NULL;

-- 3) Partial unique index (must exist for ON CONFLICT in create_system_accounts)
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'accounts' AND indexname LIKE '%unique%';

-- 4) Resolver/bootstrap RPCs exist
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname IN (
  'ensure_accounting_initialized','resolve_default_accounting_period',
  'ensure_accounting_period','get_trial_balance_from_snapshot','generate_trial_balance',
  'create_system_accounts','initialize_business_chart_of_accounts','initialize_business_accounting_period'
) ORDER BY proname;
```

**How this maps to the runtime error:**

- **Duplicates > 0:** Migration 248/249/250 may not have completed; index creation could have been skipped or failed. Then `create_system_accounts` can fail with "no unique or exclusion constraint matching the ON CONFLICT specification".
- **orphan_jel > 0:** CoA dedup left journal lines pointing to removed accounts; snapshot or ledger queries can fail or return wrong data.
- **No unique index on accounts:** Same as duplicates — ON CONFLICT in `create_system_accounts` will fail.
- **Missing RPC:** The failing step name in the API response will match the missing function.

Full script: `scripts/accounting-integrity-checks.sql`.

---

## 4. Final state (after you fix the underlying DB/issue)

- **Trial Balance:** Loads when `ensure_accounting_initialized` and `get_trial_balance_from_snapshot` succeed; 500 responses include `step` and `supabase_error` so you can see the exact failing call.
- **Ledger:** Loads when bootstrap and ledger list query succeed; same structured errors on failure.
- **Invoice payment posting:** Succeeds when bootstrap succeeds and the payment insert + trigger (`post_invoice_payment_to_ledger`) run without error; bootstrap failure returns structured JSON.

**Next step for you:** Reproduce the failure, capture the 500 response body (or server log). The `step` and `supabase_error.message` will be the root cause. If it is constraint/index related, fix DB state (e.g. re-run or fix migrations 248/249/250, ensure no duplicate `(business_id, code)` and that `accounts_unique_business_code_active_idx` exists). Then P&L and Balance Sheet can be rebuilt on top of the canonical trial balance (as in your section D) once Trial Balance and posting are stable.

---

## 5. P&L and Balance Sheet (not implemented in this pass)

Per your instructions, P&L and Balance Sheet rebuild are **not** done until Trial Balance and posting work. After they do:

- Use the same period resolution and canonical source: `get_trial_balance_from_snapshot(period_id)` (or the canonical snapshot RPC).
- **P&L:** Filter trial balance by account types income + expense; group by account; total_income, total_expenses, net_profit.
- **Balance Sheet:** Filter by asset, liability, equity; validate Assets = Liabilities + Equity (within rounding).
- Both routes should accept the same query params as the resolver and include the same resolved-period telemetry in the JSON response.
