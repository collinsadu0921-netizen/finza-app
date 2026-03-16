# Evidence Report: trial_balance_snapshots permission denied (P&L / Balance Sheet)

## 1. Which statement failed

| Statement | Location | Role at execution |
|-----------|----------|-------------------|
| **INSERT** (or **ON CONFLICT DO UPDATE**) | `generate_trial_balance` (migrations 169, 236) | **authenticated** (invoker) |

**Supporting evidence:**

- **Path:** `/api/accounting/reports/profit-and-loss` and `/api/accounting/reports/balance-sheet` call `get_profit_and_loss_from_trial_balance(p_period_id)` / `get_balance_sheet_from_trial_balance(p_period_id)` → both call `get_trial_balance_from_snapshot(p_period_id)`.
- **get_trial_balance_from_snapshot:**  
  - `SELECT * INTO snapshot_record FROM trial_balance_snapshots WHERE period_id = p_period_id`  
  - If no row: `PERFORM generate_trial_balance(p_period_id, NULL)`  
  - Then second `SELECT * INTO snapshot_record FROM trial_balance_snapshots ...`
- **generate_trial_balance:**  
  - `INSERT INTO trial_balance_snapshots (...) VALUES (...) ON CONFLICT (period_id) DO UPDATE SET ...`

So when no snapshot exists, the **first** operation that can fail for the invoker is the **INSERT** (or the **UPDATE** in ON CONFLICT) inside `generate_trial_balance`, not the SELECT in `get_trial_balance_from_snapshot`. If SELECT were denied, the error would occur on the first SELECT; if SELECT is allowed but INSERT/UPDATE are not, the error occurs when the missing snapshot is generated.

**Privilege evidence:**

- **169:** Creates `trial_balance_snapshots`; no GRANT to `authenticated`.
- **222:** `REVOKE UPDATE, DELETE ON TABLE trial_balance_snapshots FROM authenticated` (and anon). So **UPDATE** was explicitly revoked for `authenticated`; **INSERT** was never granted.
- **237:** `GRANT SELECT ON TABLE trial_balance_snapshots TO authenticated` only; no INSERT or UPDATE.

So at runtime the invoker (`authenticated`) has **SELECT** (after 237) but **no INSERT** and **no UPDATE** (never granted; UPDATE revoked in 222). The failing statement is therefore the **INSERT** (or the ON CONFLICT **UPDATE**) in `generate_trial_balance`.

---

## 2. Runtime role and auth.uid()

| Check | Evidence |
|-------|----------|
| **current_user / session_user** | RPC runs as **invoker**: API uses `createSupabaseServerClient()` (anon key + cookies), so the DB session is **authenticated**; `get_trial_balance_from_snapshot` and `generate_trial_balance` have no `SECURITY DEFINER`, so they run as that role. Thus **current_user** and **session_user** are **authenticated** (or the underlying role used by Supabase for the JWT). |
| **auth.uid()** | Set by Supabase from the JWT when the client uses the user session. RLS policies on `trial_balance_snapshots` use `auth.uid()`; they apply only after the role has table-level **privilege**. The denial happens at **privilege** check (no INSERT/UPDATE for the role), before RLS is evaluated for the new/updated row. |

Diagnostics (migration 240) add a `p_debug` gate so that, when needed, you can call `get_trial_balance_from_snapshot(period_id, true)` and see NOTICEs for `current_user`, `session_user`, `auth.uid()`, and whether a snapshot existed. After confirmation, migration 241 removes these diagnostics.

---

## 3. Why RLS/policy did or did not apply

- **SELECT:** After 237, `authenticated` has **SELECT** and RLS policy `read_trial_balance_snapshots` allows read when the user has accounting authority for the row’s business. So SELECT can succeed for allowed rows.
- **INSERT / UPDATE:** Before the fix, `authenticated` had **no INSERT** and **no UPDATE** on `trial_balance_snapshots`. In PostgreSQL, the **privilege** check (GRANT) runs **before** RLS. So the server never reached RLS for the INSERT/UPDATE; it returned **permission denied for table trial_balance_snapshots** at the privilege layer. RLS did not “not apply” because of policy logic; it was never evaluated for the write because the role lacked the table privilege.

---

## 4. Failure classification

**Class: B — INSERT/UPDATE denied when generating snapshot.**

- **(A)** SELECT denied despite GRANT: No — SELECT was granted in 237; the failure is on write.
- **(B)** Snapshot generation write blocked: **Yes** — INSERT and UPDATE were not granted (and UPDATE was revoked in 222); `generate_trial_balance` runs as invoker and performs INSERT … ON CONFLICT DO UPDATE.
- **(C)** Wrong identity / auth.uid() null: No — API uses user session; failure is privilege, not missing JWT.
- **(D)** search_path / resolution: No — table is `public.trial_balance_snapshots`; no evidence of wrong schema or relation.

---

## 5. Minimal fix applied

**Migration: `239_trial_balance_snapshots_insert_update_rls.sql`**

- `GRANT INSERT ON TABLE public.trial_balance_snapshots TO authenticated;`
- `GRANT UPDATE ON TABLE public.trial_balance_snapshots TO authenticated;`
- RLS policy `insert_trial_balance_snapshots`: **INSERT** with **WITH CHECK** using the same authority model as read (owner, or business_users admin/accountant, or firm via accounting_firm_users + accounting_firm_clients).
- RLS policy `update_trial_balance_snapshots`: **UPDATE** with **USING** and **WITH CHECK** using the same authority model.

This makes snapshot generation possible for the same users who can read the snapshot (owner / employee admin|accountant / firm), and keeps the error from recurring for the report path.

**Diagnostics (optional then removed):**

- **240_trial_balance_snapshot_diagnostics.sql:** Adds `p_debug` to `get_trial_balance_from_snapshot` and `generate_trial_balance`; when `p_debug` is true, NOTICEs report current_user, session_user, auth.uid(), snapshot_exists, and before/after generate. Normal API calls do not pass `p_debug`, so no log spam.
- **241_trial_balance_snapshot_diagnostics_remove.sql:** Removes `p_debug` and NOTICEs; restores original signatures and behavior; keeps `public.trial_balance_snapshots` references for consistency with 239.

Apply 239 for the fix; apply 240 only if you need to confirm identity in production; then apply 241 to keep the code clean.
