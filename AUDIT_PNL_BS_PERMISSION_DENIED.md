# Audit: Profit & Loss and Balance Sheet — Why “Permission Denied” Happens

**Scope:** P&L and Balance Sheet pages (Service, Portal Accounting, export endpoints).  
**Symptom:** Runtime error when loading reports: `permission denied for table trial_balance_snapshots`.  
**Conclusion:** Database permission gap: the authenticated user runs report RPCs that read `trial_balance_snapshots`, but that table had no SELECT grant or RLS policy allowing that read. The failure is at the DB layer, not in the UI or API auth.

---

## 1. Page and API Flow (No Code Changes — Observation Only)

### 1.1 Entry points

| Context | P&L page | Balance Sheet page |
|--------|----------|--------------------|
| **Service workspace** | `/reports/profit-loss` | `/reports/balance-sheet` |
| **Portal Accounting** | `/portal/accounting` (P&L tab) | `/portal/accounting` (Balance Sheet tab) |
| **Accounting-first** | `/accounting/reports/profit-and-loss` | `/accounting/reports/balance-sheet` |

All of these ultimately call the same report APIs:

- `GET /api/accounting/reports/profit-and-loss?business_id=…&period_start=…`
- `GET /api/accounting/reports/balance-sheet?business_id=…&period_start=…`

Export (CSV/PDF) uses the same APIs with the same parameters (plus export path). So the same permission issue affects view and export.

### 1.2 Page → API sequence

1. **Resolve business**
   - Service: `getCurrentBusiness(supabase, user.id)` → single linked business.
   - Portal: `resolveAccountingBusinessContext(supabase, user.id, searchParams)` → business from query or context.

2. **Resolve period**
   - Both call `GET /api/accounting/periods/resolve?business_id=…&from_date=…` (and optionally `to_date`).
   - Resolve route uses `checkAccountingAuthority(supabase, user.id, businessId, "read")` and reads `accounting_periods`.
   - Response gives `period_start` (and the API later refetches to get `period.id`).

3. **Fetch report**
   - Page calls `GET /api/accounting/reports/profit-and-loss` or `…/balance-sheet` with `business_id` and `period_start`.
   - No direct client access to `trial_balance_snapshots`; everything goes through these APIs.

So from the user’s perspective, “this” (reports failing) happens when they open P&L or Balance Sheet (or export) after choosing a period. The UI and query params are correct; the failure is inside the API when it talks to the database.

---

## 2. API Route Behaviour (Observation Only)

### 2.1 Profit & Loss route

- **File:** `app/api/accounting/reports/profit-and-loss/route.ts`
- **Flow:**
  1. `createSupabaseServerClient()` + `getUser()`.
  2. Validate `business_id` (required).
  3. `checkAccountingAuthority(supabase, user.id, businessId, "read")` → 403 if not allowed.
  4. `create_system_accounts` RPC (best-effort).
  5. Require `period_start`; load `accounting_periods` row for that business and `period_start`; if missing, call `ensure_accounting_period` then refetch to get `period.id`.
  6. Call **`supabase.rpc("get_profit_and_loss_from_trial_balance", { p_period_id: period.id })`**.
  7. On RPC error → 500 with `rpcError.message` (e.g. “permission denied for table trial_balance_snapshots”).
  8. On success → shape and return JSON.

So the API has already enforced “can this user read this business?” at the app layer. The 500 happens when the RPC runs in the database and hits a **table-level** permission problem.

### 2.2 Balance Sheet route

- **File:** `app/api/accounting/reports/balance-sheet/route.ts`
- **Flow:** Same pattern:
  1. Auth and `checkAccountingAuthority(…, "read")`.
  2. Resolve period (same as P&L).
  3. Call **`supabase.rpc("get_balance_sheet_from_trial_balance", { p_period_id: period.id })`**.
  4. On error → 500 with `rpcError.message`.
  5. On success it also calls `get_profit_and_loss_from_trial_balance` for current-period net income; that call can also hit the same permission error.

So both P&L and Balance Sheet fail at the same underlying point: an RPC that reads `trial_balance_snapshots` runs as the **authenticated** user and is denied by the database.

---

## 3. Why the Database Denies the Request

### 3.1 Who runs the RPC?

- `createSupabaseServerClient()` uses the **user’s JWT** (session).
- So `supabase.rpc("get_profit_and_loss_from_trial_balance", …)` runs in Postgres as the **invoker** (the `authenticated` role with that user’s identity), not as a superuser or `service_role`.

### 3.2 What the RPC does

- **`get_profit_and_loss_from_trial_balance(p_period_id)`** and **`get_balance_sheet_from_trial_balance(p_period_id)`** both call **`get_trial_balance_from_snapshot(p_period_id)`** (see `supabase/migrations/169_trial_balance_canonicalization.sql` and 234).
- **`get_trial_balance_from_snapshot`** (169):
  - Does **`SELECT * INTO snapshot_record FROM trial_balance_snapshots WHERE period_id = p_period_id`**.
  - If no row, calls **`generate_trial_balance(p_period_id, NULL)`** (which writes to `trial_balance_snapshots`), then **SELECT**s again from `trial_balance_snapshots`.

So the only table the **invoker** must be able to read for the report to succeed is **`trial_balance_snapshots`**. All report data for P&L and Balance Sheet comes from that table (via the snapshot).

### 3.3 Why “permission denied” appears

- **Before the fix (migrations 237/238):**
  - **Table privileges:** `trial_balance_snapshots` was created in 169 and never granted **SELECT** to `authenticated`. So the invoker role was not allowed to read the table at all, **or**
  - **RLS:** If RLS was later enabled on `trial_balance_snapshots` without a policy (or with a policy that referenced a non-existent function, e.g. `can_accountant_access_business`), then either:
    - The role had no SELECT grant (denied before RLS), or
    - The policy failed at runtime (e.g. “function does not exist”), effectively denying the row.

- In both cases the **same** thing happens: the RPC runs as the authenticated user, executes `SELECT … FROM trial_balance_snapshots`, and Postgres returns **permission denied for table trial_balance_snapshots**. The API then returns 500 with that message.

So “this” (reports failing with permission denied) happens because:

1. The **only** place P&L and Balance Sheet read report data is **`trial_balance_snapshots`**, via RPCs that run as the **authenticated** user.
2. That user was never allowed to SELECT from `trial_balance_snapshots` (missing grant and/or correct RLS policy).
3. The API has already allowed the request (checkAccountingAuthority passed); the failure is purely at the **database** permission layer.

---

## 4. Why It Affects All Entry Points Equally

- **Service** (`/reports/profit-loss`, `/reports/balance-sheet`): same APIs, same RPCs, same table.
- **Portal Accounting** (`/portal/accounting`): same APIs for P&L and Balance Sheet tabs; same RPCs and table.
- **Export** (CSV/PDF): same report APIs with the same `business_id` and `period_start`; same RPCs and table.

So business owners and service/portal users all hit the same DB permission check when the RPC runs. No code path bypasses `trial_balance_snapshots`; the fix had to be at the table (grant + RLS policy), not in the pages or routes.

---

## 5. Summary

| Question | Answer |
|----------|--------|
| **Where does the failure occur?** | Inside Postgres when the report RPC runs as the authenticated user and SELECTs from `trial_balance_snapshots`. |
| **Why does it happen?** | The `authenticated` role did not have SELECT on `trial_balance_snapshots`, and/or RLS was enabled without a policy that allowed the invoker to read the row (or the policy referenced a missing function). |
| **Why do P&L and Balance Sheet both fail?** | Both use the same canonical path: `get_*_from_trial_balance` → `get_trial_balance_from_snapshot` → read `trial_balance_snapshots`. |
| **Why do Service, Portal, and export all fail?** | They all call the same report APIs, which call the same RPCs, which read the same table. |
| **Is app-layer auth wrong?** | No. `checkAccountingAuthority` correctly restricts who can call the API. The failure is **after** that, at the DB layer. |

**Root cause:** Phase 10 correctly exposed the report UI and API, but the database never granted the **invoker** of the report RPCs (the authenticated user) read access to `trial_balance_snapshots`. Fix: grant SELECT to `authenticated` and add a read-only RLS policy scoped by `business_id` (owner / employee admin|accountant / firm), as in migrations 237 and 238.
