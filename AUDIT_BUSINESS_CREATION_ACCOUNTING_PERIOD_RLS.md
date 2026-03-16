# AUDIT — Business Creation Blocked by Accounting Period RLS

**Audit mode:** Evidence-only. No fixes proposed. No behavior changes.

---

## PART 1 — ENTRY POINT TRACE

### 1. Business creation flow

| Layer | Location | Evidence |
|-------|----------|----------|
| **UI** | `app/business-setup/page.tsx` | "Set up your business" form; `supabase.from("businesses").insert(...)` then `supabase.from("business_users").insert(...)` in sequence. |
| **API** | None | Business creation is client-only: Supabase client inserts directly into `businesses` and `business_users`. No dedicated API route. |
| **DB trigger** | `supabase/migrations/242_service_accounting_bootstrap_on_create.sql` | `AFTER INSERT ON businesses` → `trigger_initialize_business_accounting_period()`. |

### 2. Side-effects on business creation

- **Trigger:** `after_business_insert_initialize_accounting_period` (AFTER INSERT, FOR EACH ROW).
- **Trigger function:** `trigger_initialize_business_accounting_period()` (no SECURITY clause → **INVOKER**).
- **RPC:** `PERFORM initialize_business_accounting_period(NEW.id, period_start_date)` when `NEW.industry IN ('service', 'professional')`.
- **Function:** `initialize_business_accounting_period` (migration 177; no SECURITY clause → **INVOKER**) performs **INSERT INTO accounting_periods**.

Other side-effects (from existing migrations): trigger on `businesses` for Chart of Accounts (e.g. `trigger_create_system_accounts`) — not traced here.

### 3. Writes during business creation

| Table | Occurs during business creation? | Source |
|-------|----------------------------------|--------|
| **accounting_periods** | **Yes** | Trigger 242 → `initialize_business_accounting_period()` → INSERT (migration 177, lines 78–86). |
| **journal_entries** | No | Not in this path. |
| **trial_balance_snapshots** | No | Not in this path. |

---

## PART 2 — WRITE ATTEMPT ANALYSIS

### 1. Write to `accounting_periods`

- **SQL source:** `supabase/migrations/177_retail_accounting_period_initialization.sql`, lines 78–86.
- **Trigger timing:** AFTER INSERT on `businesses`.
- **Function security:** No `SECURITY DEFINER` in 177 or 242 → default **SECURITY INVOKER**. Insert runs as the role that performed the INSERT on `businesses`.

**Exact failing write:**

```sql
INSERT INTO accounting_periods (
  business_id,
  period_start,
  period_end,
  status
) VALUES (
  p_business_id,
  period_start_date,
  period_end_date,
  'open'
);
```

### 2. Execution context

- **current_user / session_user:** The authenticated user who called `supabase.from("businesses").insert(...)` (Supabase uses that role for the session).
- **auth.uid():** Set to that user’s ID.
- **Role:** **authenticated** (Supabase JWT role for logged-in users). Not service_role or postgres.

### 3. Verification

- Write runs under **authenticated**.
- Not under service_role or postgres.

---

## PART 3 — RLS ENFORCEMENT LAYER

### 1. RLS on `accounting_periods`

- **RLS enabled:** Yes (migration 157, line 100: `ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY`).
- **INSERT policy name:** "Users can insert accounting periods for their business" (157, 113–121; 159, 17–25).

**WITH CHECK clause:**

```sql
EXISTS (
  SELECT 1 FROM business_users bu
  WHERE bu.business_id = accounting_periods.business_id
    AND bu.user_id = auth.uid()
)
```

### 2. Why the insert fails

- Trigger runs in the **same transaction** as the INSERT into `businesses`.
- App code inserts into `business_users` in a **separate client round-trip** after the businesses insert returns (`app/business-setup/page.tsx`: first `.from("businesses").insert(...).single()`, then `.from("business_users").insert(...)`).
- So at trigger execution time there is **no row** in `business_users` for `(auth.uid(), NEW.id)`.
- The INSERT policy requires such a row → **WITH CHECK** fails.

RLS is evaluated when the INSERT into `accounting_periods` is executed (after the trigger runs, before the row is committed). The inserting role is `authenticated`; the policy is not satisfied because `business_users` does not yet link that user to the new business.

### 3. Error classification

- **Table-level privilege:** Not the cause; authenticated has INSERT granted.
- **RLS policy violation:** Yes. Error "new row violates row-level security policy for table \"accounting_periods\"" is an RLS WITH CHECK failure.

---

## PART 4 — CONTRACT COMPLIANCE CHECK

**Contract:** *Accounting starts when an account is created.*

1. **Does the system create accounting periods implicitly at business creation?**  
   **Yes.** Migration 242 and 177 intend one initial open period when a service/professional business is created.

2. **Does the system require accounting to exist before any account is created?**  
   The contract does not require accounting to exist *before* business creation; it ties accounting start to *account* creation. The bootstrap trigger ties it to *business* creation (and CoA/accounts are created by other triggers). So the *intent* is aligned with “accounting starts when an account is created” (accounts and period created at business creation). The **failure** is not a contract choice but an implementation ordering issue.

3. **Classification:**  
   **⚠️ Ambiguous / underspecified.** The contract is satisfied in intent (accounting bootstrap at creation). Current behavior violates the contract only in outcome: creation is blocked by RLS, so the user never reaches “accounting started.” The violation is in **lifecycle ordering** (trigger runs before `business_users` exists), not in the stated contract rule.

---

## PART 5 — ARCHITECTURAL CLASSIFICATION

| Category | Yes / No |
|----------|----------|
| Permission bug | No (privileges are sufficient). |
| RLS misconfiguration | Yes (policy assumes `business_users` exists before period insert). |
| Trigger misplacement | Yes (trigger runs in a context where RLS cannot pass). |
| Lifecycle violation | Yes (period insert before `business_users` insert). |
| UX error only | No (hard DB error, creation aborted). |

---

## PART 6 — BUSINESS IMPACT

1. **Can a user create a business without accounting knowledge?**  
   No. Creation fails with an RLS error before the user is associated with the business in `business_users`.

2. **Does a failure in accounting logic block core onboarding?**  
   Yes. The accounting bootstrap trigger runs on business insert and causes the transaction to fail; business creation does not complete.

3. **Is the failure recoverable without DB intervention?**  
   No. The user cannot complete business creation through the UI; no retry path fixes the ordering. Recovery would require DB-side or code-side change (not proposed in this audit).

---

## REQUIRED OUTPUT (SUMMARY)

1. **Exact failing write statement**  
   `INSERT INTO accounting_periods (business_id, period_start, period_end, status) VALUES (p_business_id, period_start_date, period_end_date, 'open');` (177, 78–86), executed from `initialize_business_accounting_period()` invoked by trigger `after_business_insert_initialize_accounting_period` on `businesses`.

2. **Execution role at time of failure**  
   **authenticated** (the user creating the business via Supabase client).

3. **RLS rule that blocks it**  
   INSERT policy "Users can insert accounting periods for their business" on `accounting_periods`, WITH CHECK: `EXISTS (SELECT 1 FROM business_users bu WHERE bu.business_id = accounting_periods.business_id AND bu.user_id = auth.uid())`. Blocked because there is no `business_users` row for that user and business when the trigger runs.

4. **Whether this write is allowed by contract**  
   Yes. The contract (“Accounting starts when an account is created”) allows creating the first period at bootstrap; the write itself is contract-compliant. The failure is due to RLS/lifecycle ordering, not contract.

5. **Single-sentence root cause**  
   The AFTER INSERT trigger on `businesses` inserts into `accounting_periods` as the authenticated user while the app only inserts into `business_users` in a subsequent request, so RLS (which requires a matching `business_users` row) blocks the period insert.

---

*Audit complete. No fixes or recommendations. Evidence only.*
