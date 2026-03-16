# AUDIT — Phase 13 Bootstrap Invocation Gap (Client Guard vs Server Authority)

**Role:** READ-ONLY architectural audit  
**Mode:** Evidence-only. No fixes. No refactor. No patches.

---

## Executive Verdict

**RPC bootstrap is being skipped at the server level, not the client level.** The client helper (`lib/accountingBootstrap.ts`) **always** calls `supabase.rpc("ensure_accounting_initialized")` unconditionally (no early return). However, the **server RPC** (`ensure_accounting_initialized` in migration 244) has an early return at lines 58-59: if `accounting_periods` has at least one row for the business, it returns without executing `initialize_business_chart_of_accounts`. Therefore, if a business already has a period (from a previous 243-only bootstrap or any other period-creating path), subsequent RPC invocations skip control mapping creation. The AR mapping remains missing because the server function considers "period exists" equivalent to "fully initialized" and returns early, even though control mappings may not exist. This is a **server-side idempotency contract mismatch**: the server assumes period existence implies full initialization, but it does not verify or create control mappings when returning early.

---

## PART 1 — Bootstrap Entry Points

| File | Function | Calls RPC? | Conditional guard present? | Guard condition |
|------|----------|------------|---------------------------|------------------|
| `lib/accountingBootstrap.ts` | `ensureAccountingInitialized()` | **Yes** (line 16) | **No** | None. Always calls `supabase.rpc("ensure_accounting_initialized", { p_business_id: businessId })`. No early return based on client-side checks. |
| `app/api/invoices/[id]/send/route.ts` | POST handler | Via `ensureAccountingInitialized()` | **No** | Calls `ensureAccountingInitialized(supabase, invoice.business_id)` unconditionally (lines 197, 249, 330). |
| `app/api/invoices/[id]/mark-paid/route.ts` | POST handler | Via `ensureAccountingInitialized()` | **No** | Calls `ensureAccountingInitialized(supabase, business.id)` unconditionally (line 108). |
| `app/api/expenses/create/route.ts` | POST handler | Via `ensureAccountingInitialized()` | **No** | Calls `ensureAccountingInitialized(supabase, business_id)` unconditionally (line 48). |
| `app/api/payments/create/route.ts` | POST handler | Via `ensureAccountingInitialized()` | **No** | Calls `ensureAccountingInitialized(supabase, business_id)` unconditionally (line 156). |
| `app/api/ledger/list/route.ts` | GET handler | Via `ensureAccountingInitialized()` | **No** | Calls `ensureAccountingInitialized(supabase, businessId)` unconditionally (line 40). |
| `app/api/accounting/trial-balance/route.ts` | GET handler | Via `ensureAccountingInitialized()` | **No** | Calls `ensureAccountingInitialized(supabase, businessId)` unconditionally (line 27). |
| `app/api/reports/trial-balance/route.ts` | GET handler | Via `ensureAccountingInitialized()` | **No** | Calls `ensureAccountingInitialized(supabase, business.id)` unconditionally (line 22). |
| `app/api/reports/profit-loss/route.ts` | GET handler | Via `ensureAccountingInitialized()` | **No** | Calls `ensureAccountingInitialized(supabase, business.id)` unconditionally (line 22). |
| `app/api/reports/balance-sheet/route.ts` | GET handler | Via `ensureAccountingInitialized()` | **No** | Calls `ensureAccountingInitialized(supabase, business.id)` unconditionally (line 22). |
| `app/api/reports/vat-control/route.ts` | GET handler | Via `ensureAccountingInitialized()` | **No** | Calls `ensureAccountingInitialized(supabase, business.id)` unconditionally (line 41). |
| `app/api/accounting/periods/route.ts` | GET handler | Via `ensureAccountingInitialized()` | **No** | Calls `ensureAccountingInitialized(supabase, businessId)` unconditionally (line 50). |
| `app/api/accounting/reports/trial-balance/route.ts` | GET handler | Via `ensureAccountingInitialized()` | **No** | Calls `ensureAccountingInitialized(supabase, businessId)` unconditionally (line 55). |
| `app/api/onboarding/retail/finalize/route.ts` | POST handler | **Direct RPC call** | **No** | Calls `supabase.rpc("ensure_accounting_initialized", { p_business_id: businessId })` directly (line 195). Also calls `initialize_business_chart_of_accounts` separately before bootstrap (line 178). |

**Evidence:** No client-side conditional guards prevent calling the RPC. All routes call `ensureAccountingInitialized()` unconditionally, and the helper always invokes the RPC.

---

## PART 2 — Audit lib/accountingBootstrap.ts

### Current Implementation (Post-Phase 13.2)

**File:** `lib/accountingBootstrap.ts`  
**Lines:** 12-29

```typescript
export async function ensureAccountingInitialized(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ initialized: boolean; error?: string }> {
  const { error } = await supabase.rpc("ensure_accounting_initialized", {
    p_business_id: businessId,
  })

  if (error) {
    console.error("accountingBootstrap: ensure_accounting_initialized failed", error)
    return {
      initialized: false,
      error: "Unable to start accounting. Please try again.",
    }
  }

  return { initialized: true }
}
```

### Initialization Decision Logic (verbatim)

**No client-side initialization check exists.** The function:
1. **Always** calls `supabase.rpc("ensure_accounting_initialized", { p_business_id: businessId })` (line 16-18).
2. **No** early return based on `accounting_periods` count.
3. **No** check for `chart_of_accounts_control_map` existence.
4. **No** check for `accounts` existence.
5. **No** conditional that skips the RPC call.

**Removed function:** `isAccountingUninitialized()` is **not present** in the current codebase (grep found zero matches in `.ts`/`.tsx` files). It was removed in Phase 13.2.

**Conclusion:** Client helper delegates all initialization decisions to the server RPC. No client-side guards prevent RPC invocation.

---

## PART 3 — Invocation Map

| Route/File | Action Type | Always calls bootstrap? | Conditional? | Pre-conditions |
|------------|-------------|-------------------------|--------------|----------------|
| `app/api/invoices/[id]/send/route.ts` | POST | **Yes** (3 call sites: WhatsApp, email, default) | **No** | Invoice exists; user authenticated. |
| `app/api/invoices/[id]/mark-paid/route.ts` | POST | **Yes** | **No** | Invoice exists; user authenticated; business resolved. |
| `app/api/expenses/create/route.ts` | POST | **Yes** | **No** | User authenticated; role check passed; business_id in body. |
| `app/api/payments/create/route.ts` | POST | **Yes** | **No** | User authenticated; business_id in body; invoice exists and is not draft. |
| `app/api/ledger/list/route.ts` | GET | **Yes** | **No** | User authenticated; businessId resolved; accounting authority check passed. |
| `app/api/accounting/trial-balance/route.ts` | GET | **Yes** | **No** | User authenticated; businessId in query; accountant access verified. |
| `app/api/reports/trial-balance/route.ts` | GET | **Yes** | **No** | User authenticated; business resolved. |
| `app/api/reports/profit-loss/route.ts` | GET | **Yes** | **No** | User authenticated; business resolved. |
| `app/api/reports/balance-sheet/route.ts` | GET | **Yes** | **No** | User authenticated; business resolved. |
| `app/api/reports/vat-control/route.ts` | GET | **Yes** | **No** | User authenticated; business resolved. |
| `app/api/accounting/periods/route.ts` | GET | **Yes** | **No** | User authenticated; businessId in query; accountant access verified. |
| `app/api/accounting/reports/trial-balance/route.ts` | GET | **Yes** | **No** | User authenticated; businessId in query; accounting authority check passed. |

**Evidence:** All routes call bootstrap **unconditionally**. No route has logic that says "if already initialized, skip bootstrap call."

---

## PART 4 — Skip Scenario Trace

**Scenario:** Business has `accounting_periods = 1 row`, `chart_of_accounts_control_map = 0 rows`.

**Deterministic execution trace:**

1. **User action:** Sends invoice via `POST /api/invoices/[id]/send`.
2. **Route handler:** `app/api/invoices/[id]/send/route.ts` line 197: `const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, invoice.business_id)`.
3. **Client helper:** `lib/accountingBootstrap.ts` line 16: `await supabase.rpc("ensure_accounting_initialized", { p_business_id: businessId })`. **No early return**; RPC is invoked.
4. **Server RPC:** `supabase/migrations/244_phase13_control_mapping_bootstrap.sql` lines 52-59:
   ```sql
   SELECT EXISTS (
     SELECT 1 FROM accounting_periods
     WHERE business_id = p_business_id
   ) INTO v_period_exists;

   IF v_period_exists THEN
     RETURN;  -- EARLY RETURN: skips lines 63-76
   END IF;
   ```
   **Result:** `v_period_exists = TRUE` → function returns at line 59. **Lines 63-76 are never executed**, including `PERFORM initialize_business_chart_of_accounts(p_business_id)` (line 68).
5. **Client helper:** RPC returns successfully (no error) → `lib/accountingBootstrap.ts` line 28: `return { initialized: true }`.
6. **Route handler:** No `bootstrapErr` → continues to `performSendTransition()` (line 204).
7. **performSendTransition:** Updates `invoices` SET `status = 'sent'` → triggers `trigger_auto_post_invoice`.
8. **Trigger:** `supabase/migrations/043_accounting_core.sql` line 941: `PERFORM post_invoice_to_ledger(NEW.id)`.
9. **post_invoice_to_ledger:** `supabase/migrations/226_accrual_ar_posting_invoice_finalisation.sql` line 84: `ar_account_code := get_control_account_code(business_id_val, 'AR')`.
10. **get_control_account_code:** `supabase/migrations/098_chart_of_accounts_validation.sql` lines 54-61:
    ```sql
    SELECT account_code INTO mapped_account_code
    FROM chart_of_accounts_control_map
    WHERE business_id = p_business_id
      AND control_key = p_control_key
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Missing control account mapping: %', p_control_key;
    ```
    **Result:** No row found → RAISE `'Missing control account mapping: AR'`.

**Conclusion:** The skip occurs at **server RPC level** (line 59 of migration 244). The client always calls the RPC, but the server returns early when a period exists, preventing control mapping creation.

---

## PART 5 — Server Idempotency Confirmation

**ensure_accounting_initialized** (244, lines 28-80):

- **Idempotency check:** Lines 52-59 check `accounting_periods` existence. If period exists → RETURN (early exit).
- **Problem:** Early return **before** `initialize_business_chart_of_accounts` (line 68). So if period exists but control mappings don't, repeated invocation **does not** create mappings.
- **Idempotency assumption:** Server assumes "period exists" = "fully initialized". This is **incorrect** if period was created by 243-only bootstrap or any path that didn't create control mappings.

**initialize_business_chart_of_accounts** (176, lines 32-116):

- **Idempotency:** Lines 73-77 use `ON CONFLICT (business_id, account_code) DO UPDATE` for `chart_of_accounts`.
- **Idempotency:** Lines 87-110 use `ON CONFLICT (business_id, control_key) DO NOTHING` for `chart_of_accounts_control_map`.
- **Safe to call repeatedly:** Yes, but **only if it is called**. If `ensure_accounting_initialized` returns early, this function never runs.

**create_system_accounts** (043, lines 66-116):

- **Idempotency:** All INSERT statements use `ON CONFLICT (business_id, code) DO NOTHING` (lines 77, 91, 97, 103, 115).
- **Safe to call repeatedly:** Yes.

**initialize_business_accounting_period** (177, lines 45-94):

- **Idempotency:** Lines 61-69 check if period exists; if yes, RETURN (early exit).
- **Safe to call repeatedly:** Yes.

**Conclusion:** All helper functions are idempotent, but `ensure_accounting_initialized`'s early return (based on period existence) prevents `initialize_business_chart_of_accounts` from running when a period already exists. Repeated invocation is **not safe** for businesses that have a period but lack control mappings.

---

## PART 6 — Contract Drift Detection

**Current codebase definitions:**

| Location | Definition of "Accounting Initialized" |
|----------|----------------------------------------|
| **Client helper** (`lib/accountingBootstrap.ts`) | **No definition.** Always calls RPC; delegates decision to server. |
| **Server RPC** (`ensure_accounting_initialized`, 244) | **Period exists** (lines 52-59). If `accounting_periods` has at least one row → RETURN (assumes initialized). |
| **Posting functions** (e.g. `post_invoice_to_ledger`, 226) | **Control mapping exists** (line 84). Calls `get_control_account_code(..., 'AR')` which requires a row in `chart_of_accounts_control_map`. |

**Contract drift classification:** **C) Mixed definitions across client/server.**

- **Client:** No definition (always calls server).
- **Server:** "Initialized" = period exists.
- **Posting:** "Initialized" = control mapping exists.

**Evidence:**
- Server RPC (244, line 58): `IF v_period_exists THEN RETURN;` — considers period existence sufficient.
- Posting (226, line 84): `ar_account_code := get_control_account_code(business_id_val, 'AR');` — requires control mapping.
- These definitions are **incompatible**: a business can have a period but no control mapping, causing posting to fail.

---

## PART 7 — Authority Gate Audit

**Server bootstrap RPC authority check** (244, lines 38-50):

```sql
IF NOT EXISTS (
  SELECT 1 FROM businesses b
  WHERE b.id = p_business_id AND b.owner_id = auth.uid()
) AND NOT EXISTS (
  SELECT 1 FROM business_users bu
  WHERE bu.business_id = p_business_id
    AND bu.user_id = auth.uid()
    AND bu.role IN ('admin', 'accountant')
) THEN
  RAISE EXCEPTION 'Not allowed to initialize accounting for this business'
    USING ERRCODE = 'P0001';
END IF;
```

**Conditions that can cause bootstrap to fail:**

| Condition | Evidence | Result |
|-----------|----------|--------|
| **Missing business_users row** | If user is not owner (`businesses.owner_id != auth.uid()`) and has no `business_users` row for that business, both EXISTS checks fail → RAISE. | Bootstrap **fails** with exception. Route returns 500. |
| **Owner mismatch** | If `businesses.owner_id != auth.uid()` and user is not in `business_users` with admin/accountant role, both EXISTS fail → RAISE. | Bootstrap **fails** with exception. Route returns 500. |
| **Null auth.uid()** | If request has no valid session, `auth.uid()` is NULL. Both EXISTS checks fail → RAISE. | Bootstrap **fails** with exception. Route returns 500. |
| **Service role** | Routes use `createSupabaseServerClient()` (anon key, user cookies), not service role. RPC runs as **authenticated** user. | Bootstrap **does not** fail due to service role. |

**Conclusion:** Bootstrap can fail (raise exception) if the caller is not owner and not in `business_users` with admin/accountant role, or if `auth.uid()` is null. However, this failure is **explicit** (exception raised, route returns 500), not silent. The authority gate does **not** cause silent skip; it causes explicit failure.

---

## Output Summary

### Executive Verdict

RPC bootstrap is skipped at the **server level** due to an early return in `ensure_accounting_initialized` (migration 244, lines 58-59). When `accounting_periods` has at least one row, the function returns without executing `initialize_business_chart_of_accounts`. The client helper always calls the RPC unconditionally (no client-side guards), but the server's idempotency check assumes "period exists" equals "fully initialized," which is incorrect if the period was created by a previous partial bootstrap (243-only) or any path that didn't create control mappings. The AR mapping remains missing because the server function never runs the control mapping creation step when a period already exists.

### Bootstrap Invocation Map

| Route | Always calls bootstrap? | Conditional guard? |
|-------|-------------------------|-------------------|
| Invoice send | Yes (3 call sites) | No |
| Invoice mark-paid | Yes | No |
| Expense create | Yes | No |
| Payment create | Yes | No |
| Ledger read | Yes | No |
| Trial balance (all routes) | Yes | No |
| P&L | Yes | No |
| Balance sheet | Yes | No |
| VAT reports | Yes | No |
| Accounting periods | Yes | No |

**All routes call bootstrap unconditionally.** No client-side guards prevent RPC invocation.

### Guard Condition Evidence

**Client helper (`lib/accountingBootstrap.ts`):**
- **No guard conditions.** Function always calls RPC (line 16).

**Server RPC (`ensure_accounting_initialized`, 244):**
- **Guard condition:** Lines 52-59 check `accounting_periods` existence.
- **Early return:** Line 58-59: `IF v_period_exists THEN RETURN;`
- **Effect:** When period exists, function returns **before** executing `initialize_business_chart_of_accounts` (line 68).

### Skip Path Deterministic Trace

1. Client calls `ensureAccountingInitialized(businessId)`.
2. Client helper calls `supabase.rpc("ensure_accounting_initialized", { p_business_id: businessId })`.
3. Server RPC checks `accounting_periods` → finds 1 row → `v_period_exists = TRUE`.
4. Server RPC executes `IF v_period_exists THEN RETURN;` → exits at line 59.
5. Server RPC **never executes** lines 63-76 (create_system_accounts, initialize_business_chart_of_accounts, initialize_business_accounting_period).
6. Client receives successful RPC response (no error).
7. Route continues → `performSendTransition()` → trigger → `post_invoice_to_ledger`.
8. Posting calls `get_control_account_code(..., 'AR')` → no row in `chart_of_accounts_control_map` → RAISE 'Missing control account mapping: AR'.

### Contract Drift Classification

**C) Mixed definitions across client/server.**

- **Client:** No definition (always calls server).
- **Server:** "Initialized" = period exists (244, line 58).
- **Posting:** "Initialized" = control mapping exists (226, line 84; 098, line 61).

These definitions are incompatible: a business can satisfy the server definition (period exists) but fail the posting definition (control mapping missing).

---

*Audit complete. Evidence only. No fixes, no refactor, no patches.*
