# Audit: `permission denied for table trial_balance_snapshots`

**Mode:** Evidence-only. No fixes. No refactors. No workarounds.  
**Objective:** Identify the exact enforcement layer causing `permission denied` after migrations were applied.

---

## PART 1 — ROLE & CONTEXT VERIFICATION

### 1.1 Execution role

| Check | Evidence |
|-------|----------|
| **Supabase client** | `lib/supabaseServer.ts`: `createSupabaseServerClient()` uses `createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies })`. No service role key. |
| **RPC invocation** | `app/api/accounting/reports/profit-and-loss/route.ts` (and balance-sheet, trial-balance, legacy reports): after `supabase.auth.getUser()` and `checkAccountingAuthority(..., "read")`, calls `supabase.rpc("get_profit_and_loss_from_trial_balance", { p_period_id })` (or `get_balance_sheet_from_trial_balance`, `get_trial_balance_from_snapshot`) with the same client. |
| **SECURITY DEFINER** | `supabase/migrations/169_trial_balance_canonicalization.sql` lines 216–261: `get_trial_balance_from_snapshot` is created with `LANGUAGE plpgsql` only. No `SECURITY DEFINER`. Function runs as **invoker**. |

**Conclusion:** RPC runs as **authenticated** (user JWT / session). No service role and no SECURITY DEFINER.

---

## PART 2 — TABLE-LEVEL PERMISSION CHECK

### 2.1 Direct privilege audit

| Check | Evidence |
|-------|----------|
| **Table definition** | `169_trial_balance_canonicalization.sql` lines 19–41: `CREATE TABLE IF NOT EXISTS trial_balance_snapshots (...)` — no schema prefix → **public** schema. |
| **GRANT in 169** | Migration 169 does **not** issue any `GRANT` on `trial_balance_snapshots`. Only table owner (e.g. postgres/supabase_admin) has privileges after 169. |
| **GRANT in 237** | `237_trial_balance_snapshots_rls_read.sql` line 11: `GRANT SELECT ON TABLE trial_balance_snapshots TO authenticated;` — **only** migration that grants SELECT to `authenticated`. |
| **Other migrations** | `222_ledger_immutability_enforcement.sql`: `REVOKE UPDATE, DELETE ON TABLE trial_balance_snapshots FROM authenticated` only. Does not revoke SELECT; does not grant SELECT. `238_trial_balance_snapshots_policy_inline_firm.sql`: DROP/CREATE policy only; **no GRANT**. |
| **Function table reference** | `169_trial_balance_canonicalization.sql` lines 234–235, 242–243: `SELECT * INTO snapshot_record FROM trial_balance_snapshots WHERE period_id = p_period_id` — unqualified name; resolves to **public.trial_balance_snapshots** with default search_path. |

**Conclusion:** Table is in **public**. Role `authenticated` receives SELECT **only** from migration **237**. If 237 has not been applied in the environment where the error occurs, `authenticated` has **no** SELECT on `trial_balance_snapshots`.

---

## PART 3 — RLS STATE & POLICY EVALUATION

### 3.1 RLS status

| Check | Evidence |
|-------|----------|
| **RLS enabled** | `237_trial_balance_snapshots_rls_read.sql` line 14: `ALTER TABLE trial_balance_snapshots ENABLE ROW LEVEL SECURITY`. |
| **Policy** | 237 (and 238) create policy `"read_trial_balance_snapshots"` FOR SELECT with USING (owner OR business_users admin/accountant OR firm via accounting_firm_users + accounting_firm_clients). |

### 3.2 Policy semantics

| Check | Evidence |
|-------|----------|
| **USING expression** | No helper functions. Uses only: `businesses b`, `business_users bu`, `accounting_firm_users afu`, `accounting_firm_clients afc`, `auth.uid()`. All are built-in or tables in public. |
| **238** | `238_trial_balance_snapshots_policy_inline_firm.sql`: Recreates the same policy with inline firm check (no `can_accountant_access_business`). No function dependency that could be missing. |

**Conclusion:** RLS is enabled; policy references only standard tables and `auth.uid()`. No invalid or inaccessible function in the policy. **Important:** In PostgreSQL, if the role lacked SELECT (GRANT), the error is **"permission denied for table …"** before RLS is evaluated. If the role had SELECT and RLS filtered all rows, the result would be **0 rows**, not "permission denied".

---

## PART 4 — DATA INVARIANT AUDIT

Not required to classify this fault. "Permission denied for table X" is a **privilege** error, not a row-visibility or data-invariant error. If the failure were policy-evaluates-FALSE or bad data, the observable would be empty result or a different error, not table-level permission denied.

---

## PART 5 — MINIMAL REPRODUCTION (INTERPRETATION)

If, **as authenticated** (e.g. via Supabase client with user session), one runs:

```sql
SELECT id, business_id, period_id FROM trial_balance_snapshots LIMIT 1;
```

- **Permission denied** → Role does not have SELECT on the table → **GRANT** (table-level privilege) is the failing layer.  
- **0 rows** → RLS or no data; privilege is present.  
- **Row returned** → Fault is elsewhere (e.g. function, search_path, or calling context).

The reported symptom is **permission denied**; therefore the failing layer is **table-level GRANT**.

---

## PART 6 — FAULT CLASSIFICATION

**Class: GRANT (table-level privilege) — equivalent to absence of SELECT for `authenticated`.**

Not A (RLS always FALSE → 0 rows).  
Not B (policy does not reference invalid function).  
Not C (if GRANT existed and only RLS blocked, result would be 0 rows).  
Not D (schema/search_path would typically yield "relation does not exist" or wrong table, not "permission denied for table trial_balance_snapshots").  
Not E (data invariants do not cause this error).  
Not F (execution context is confirmed authenticated; mixed context would not produce this error for an authenticated-only path).

**Exact enforcement layer:** Postgres **table-level privilege check**. The role used when the RPC runs (`authenticated`) does **not** have **SELECT** on `public.trial_balance_snapshots` in the environment where the error occurs.

**Root cause (evidence-based):** Migration **169** creates `trial_balance_snapshots` and never grants SELECT to `authenticated`. The **only** migration that grants SELECT to `authenticated` is **237**. Migration **238** only replaces the RLS policy; it does not re-issue the GRANT. Therefore, if **237** has not been applied (e.g. migration order, different branch, or deployment gap), the role `authenticated` never receives SELECT, and any SELECT from `trial_balance_snapshots` (including inside `get_trial_balance_from_snapshot`) produces **permission denied for table trial_balance_snapshots**.

---

## FINAL DELIVERABLE

| Item | Result |
|------|--------|
| **Fault class** | **GRANT** — table-level privilege. (Not A–E or F as defined; the denial is from missing SELECT for `authenticated`.) |
| **Evidence** | (1) Client uses anon key + user session → authenticated. (2) RPC runs as invoker (no SECURITY DEFINER). (3) 169 creates table with no GRANT to authenticated. (4) Only 237 grants SELECT to authenticated; 238 does not. (5) Postgres returns "permission denied for table X" when the role lacks the required table privilege, not when RLS simply returns no rows. |
| **Layer failing** | **GRANT** — the role `authenticated` does not have SELECT on `public.trial_balance_snapshots` in the environment where the error is observed. |

**No fix applied.** This audit does not propose or apply any migration, SECURITY DEFINER, RLS change, or permission broadening.
