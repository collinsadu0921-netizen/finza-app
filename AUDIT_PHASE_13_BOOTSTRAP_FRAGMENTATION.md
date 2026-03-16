# AUDIT — Phase 13 Bootstrap Fragmentation (Control Mapping Missing)

**Role:** Principal Accounting Systems Auditor  
**Mode:** Evidence-only. No fixes. No refactor. No DB changes. No speculation.  
**Business under test (trace reference):** `57323b08-d096-43e6-851a-bc65e89a5dc5`

---

## Executive Conclusion

**Fragmentation has two causes:**

1. **Client-side early return:** `ensureAccountingInitialized` in `lib/aaccountingBootstrap.ts` calls `isAccountingUninitialized`; when `accounting_periods` has at least one row for the business, it returns without calling the RPC `ensure_accounting_initialized`. So if a business already has a period (from a previous 243-only bootstrap or any other period-creating path), the RPC—and thus `initialize_business_chart_of_accounts`—is never run on subsequent requests. Control mappings are never created for that business.

2. **Partial bootstrap when only migration 243 is applied:** The 243 version of `ensure_accounting_initialized` creates only `create_system_accounts` + `initialize_business_accounting_period`. It does not call `initialize_business_chart_of_accounts`. So with 243 only: first accounting action runs bootstrap → accounts + period created, **no** `chart_of_accounts` or `chart_of_accounts_control_map`. Later, client sees period exists → skips RPC → posting fails with "Missing control account mapping: AR."

**Contract compliance:** **FAIL.** The implementation does not guarantee that accounts, chart_of_accounts, control mappings, and period all exist before posting: (a) the client skips the full bootstrap when a period exists, and (b) a period can exist without control mappings.

---

## PART 1 — All Account Creation Paths

| Location | Object Type | Called By | Calls ensure_accounting_initialized? | Calls initialize_business_chart_of_accounts? |
|----------|-------------|-----------|--------------------------------------|-----------------------------------------------|
| `supabase/migrations/043_accounting_core.sql` | `create_system_accounts` (function); INSERT INTO accounts inside it | ensure_accounting_initialized (243/244), **trigger_auto_create_system_accounts (050/200/202)** | N/A (it is called by bootstrap) | No (create_system_accounts does not call it) |
| `supabase/migrations/050_fix_account_id_null.sql` | Trigger `trigger_auto_create_system_accounts` on businesses | AFTER INSERT ON businesses | No | No |
| `supabase/migrations/200_fix_professional_system_accounts.sql` | `trigger_create_system_accounts()` → create_system_accounts(NEW.id) | Trigger on businesses (replaces 050) | No | No |
| `supabase/migrations/202_remove_professional_from_constraints.sql` | Same trigger/function | Same | No | No |
| **`supabase/migrations/243_phase13_fortnox_accounting_bootstrap.sql`** | **DROP TRIGGER trigger_auto_create_system_accounts** | — | — | — |
| `supabase/migrations/244_phase13_control_mapping_bootstrap.sql` | ensure_accounting_initialized calls create_system_accounts | API routes via ensureAccountingInitialized → RPC | Yes (same function) | Yes (244 adds call after create_system_accounts) |
| `supabase/migrations/187_retail_accounting_bootstrap.sql` | initialize_retail_accounting: INSERT INTO accounts | trigger_auto_initialize_retail_accounting (ON businesses, industry=retail) | No | N/A (retail has its own CoA+mapping in same function) |
| `supabase/migrations/094_accounting_periods.sql` | (no account creation) | — | — | — |
| `supabase/migrations/094_accounting_periods.sql` | ensure_accounting_period | assert_accounting_period_is_open | No | No |
| `supabase/migrations/177_retail_accounting_period_initialization.sql` | initialize_business_accounting_period; INSERT inside | ensure_accounting_initialized, retail finalize (historically), **trigger after_business_insert (242, dropped in 243)** | N/A | No |

**Evidence:** 243 drops `trigger_auto_create_system_accounts` and `after_business_insert_initialize_accounting_period`. So after 243, **no trigger** on businesses creates accounts or periods. The only path that creates accounts for **service** is `ensure_accounting_initialized` (invoked via RPC from app). Retail still has `trigger_auto_initialize_retail_accounting` (187) which calls `initialize_retail_accounting` (accounts + chart_of_accounts + control_map in one function).

---

## PART 2 — All Accounting Period Creation Paths

| Location | Object Type | Called By | Calls ensure_accounting_initialized? | Calls initialize_business_chart_of_accounts? |
|----------|-------------|-----------|--------------------------------------|-----------------------------------------------|
| `supabase/migrations/094_accounting_periods.sql` | ensure_accounting_period: **INSERT INTO accounting_periods** (lines 86–88) | assert_accounting_period_is_open (094, 165, 166) | No | No |
| `supabase/migrations/165_period_locking_posting_guards.sql` | assert_accounting_period_is_open → ensure_accounting_period | Posting functions (e.g. post_invoice_to_ledger) | No | No |
| `supabase/migrations/166_controlled_adjustments_soft_closed.sql` | Same | Same | No | No |
| `supabase/migrations/177_retail_accounting_period_initialization.sql` | initialize_business_accounting_period: **INSERT INTO accounting_periods** (78–86) | ensure_accounting_initialized (243/244), retail finalize (Phase 13) | N/A (it is inside bootstrap) | No (separate step in bootstrap) |
| `supabase/migrations/243_phase13_fortnox_accounting_bootstrap.sql` | ensure_accounting_initialized calls initialize_business_accounting_period | API via ensureAccountingInitialized → RPC | Yes | **No (243 does not call initialize_business_chart_of_accounts)** |
| `supabase/migrations/244_phase13_control_mapping_bootstrap.sql` | ensure_accounting_initialized calls initialize_business_chart_of_accounts then initialize_business_accounting_period | Same | Yes | Yes |

**Evidence:** `ensure_accounting_period` (094) can create a period without ever calling `ensure_accounting_initialized` or `initialize_business_chart_of_accounts`. It is invoked from `assert_accounting_period_is_open`. So a period can exist with **no** control mappings if it was created by ensure_accounting_period (e.g. during a posting path that calls assert_accounting_period_is_open after get_control_account_code—but post_invoice_to_ledger calls get_control_account_code first, so we fail before assert_accounting_period_is_open). The main partial state comes from: **ensure_accounting_initialized (243 only)** creating accounts + period and **not** calling initialize_business_chart_of_accounts.

---

## PART 3 — Chart / Control Mapping Creation Paths

| Location | Triggered Automatically? | Requires Manual / API Call? |
|----------|---------------------------|------------------------------|
| `supabase/migrations/176_business_coa_bootstrap.sql` | No | Yes: `initialize_business_chart_of_accounts(p_business_id)` must be called explicitly |
| `supabase/migrations/232_service_chart_of_accounts_backfill.sql` | Yes (one-time migration): FOR each business_id IN (SELECT DISTINCT business_id FROM accounts) PERFORM initialize_business_chart_of_accounts(biz.business_id) | No at run time; one-time at migration |
| `supabase/migrations/244_phase13_control_mapping_bootstrap.sql` | No (DB trigger); called when ensure_accounting_initialized runs | Yes: only when RPC ensure_accounting_initialized is invoked and period does not exist yet |
| `supabase/migrations/187_retail_accounting_bootstrap.sql` | Yes: trigger_auto_initialize_retail_accounting on businesses (industry=retail) runs initialize_retail_accounting which INSERTs into chart_of_accounts_control_map | N/A for retail |
| `supabase/migrations/175_retail_control_account_mapping.sql` | No | ensure_retail_control_account_mapping called from posting (e.g. post_sale_to_ledger) for CASH; not used for invoice AR path |
| `app/api/onboarding/retail/finalize/route.ts` | No | Yes: calls initialize_business_chart_of_accounts RPC then ensure_accounting_initialized RPC |

**Evidence:** For **service**, control mappings are created only by: (1) one-time 232 backfill, (2) ensure_accounting_initialized when it calls initialize_business_chart_of_accounts (244 only), (3) explicit RPC call to initialize_business_chart_of_accounts. There is **no** trigger on service business creation that creates control mappings (243 removed the triggers that ran on business insert).

---

## PART 4 — Invoice Posting Call Order

**Flow when `app/api/invoices/[id]/send/route.ts` runs (e.g. send WhatsApp, send email, or default “mark as sent”):**

1. `POST` handler runs; `createSupabaseServerClient()` (anon key, user cookies) → `supabase`.
2. Invoice fetched; `invoice.business_id` available.
3. **ensureAccountingInitialized(supabase, invoice.business_id)** (e.g. lines 197, 249, 330):
   - **lib/accountingBootstrap.ts** `ensureAccountingInitialized`:
     - Calls `isAccountingUninitialized(supabase, businessId)` → SELECT count from `accounting_periods` WHERE business_id = businessId.
     - **If count > 0:** returns `{ initialized: false }` **without calling** `supabase.rpc("ensure_accounting_initialized", ...)`.
     - If count === 0: calls `supabase.rpc("ensure_accounting_initialized", { p_business_id: businessId })`.
4. If RPC was called and returned error → route returns 500 with bootstrapErr.
5. **performSendTransition(supabase, invoiceId, invoice, sendMethod)**:
   - Updates `invoices` SET status = 'sent', sent_at = now(), etc.
6. DB trigger **trigger_auto_post_invoice** (AFTER UPDATE OF status on invoices) runs → **post_invoice_to_ledger(NEW.id)**.
7. **post_invoice_to_ledger** (226): get_control_account_code(business_id_val, 'AR') → SELECT from chart_of_accounts_control_map → if no row, RAISE 'Missing control account mapping: AR'.

**Does posting ever run without bootstrap being invoked first?**

**YES.** Evidence:

- When **period already exists**, `ensureAccountingInitialized` never calls the RPC (lib/accountingBootstrap.ts lines 34–37: `if (!uninitialized) return { initialized: false }`). So bootstrap (and thus initialize_business_chart_of_accounts) is **not** invoked; the route then calls performSendTransition; trigger runs; post_invoice_to_ledger runs and fails at get_control_account_code if control mappings were never created.
- So posting runs without the **full** bootstrap (including control mappings) whenever the client considers the business “initialized” (period exists), even when chart_of_accounts_control_map is empty.

---

## PART 5 — Authority Gate Failure Risk

**ensure_accounting_initialized authority block (243/244):**

- Requires: `businesses.owner_id = auth.uid()` OR `business_users` row for (business_id, auth.uid()) with role IN ('admin', 'accountant').
- If neither: RAISE 'Not allowed to initialize accounting for this business'.

**Could bootstrap be skipped because of:**

| Risk | Evidence |
|------|----------|
| Invoice send route runs as **service role** | No. `createSupabaseServerClient()` uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` and cookies (lib/supabaseServer.ts). Requests run as **authenticated** user with JWT; not service role. |
| **Missing business_users row** | Yes. If the user is the **owner** (businesses.owner_id = auth.uid()), they pass the first EXISTS. If they are not owner and have no business_users row (e.g. new business, business_users not yet inserted), they fail the gate and RPC raises. So bootstrap is **blocked** for that caller until they are owner or in business_users. |
| **Owner mismatch** | Yes. If auth.uid() is not businesses.owner_id and not in business_users for that business, gate fails. |
| **null auth.uid()** | Yes. If the request has no valid session, auth.uid() is null; both EXISTS checks fail; bootstrap raises. |

**Conclusion:** Bootstrap can be **skipped** (1) when the client sees a period and never calls the RPC, or (2) when the RPC is called but the authority gate raises (e.g. no business_users row, or unauthenticated). It is **not** skipped because the route uses service role.

---

## PART 6 — Partial Initialization State

**Is this sequence possible: accounts created, period created, chart_of_accounts_control_map NOT created?**

**YES.**

**Exact code paths:**

1. **Path A (243-only bootstrap, then client skips RPC):**
   - First accounting action (e.g. open Ledger) → ledger list route calls ensureAccountingInitialized → isAccountingUninitialized true (no period) → RPC ensure_accounting_initialized (243) runs → create_system_accounts (accounts) + initialize_business_accounting_period (period). No call to initialize_business_chart_of_accounts. Result: accounts + period, **no** chart_of_accounts_control_map.
   - Later: user sends invoice. ensureAccountingInitialized → isAccountingUninitialized **false** (period exists) → return without calling RPC. performSendTransition → trigger → post_invoice_to_ledger → get_control_account_code('AR') → no row → "Missing control account mapping: AR".

2. **Path B (ensure_accounting_period creates period only):**
   - Some code path calls assert_accounting_period_is_open(business_id, date) when no period exists for that month. assert_accounting_period_is_open (094/165/166) calls ensure_accounting_period(p_business_id, p_date), which INSERTs into accounting_periods. That path does **not** create accounts or control mappings. So we could have **period** only (no accounts for that business from this path). But then get_control_account_code would still fail (no mapping). So “accounts + period, no control map” is path A; “period only” from ensure_accounting_period does not by itself create accounts.

**Conclusion:** The partial state “accounts + period, no chart_of_accounts_control_map” is produced by **Path A**: 243-only ensure_accounting_initialized (or any bootstrap that creates accounts + period but not control mappings), followed by client logic that skips the RPC when a period exists.

---

## PART 7 — Contract Compliance Check

**Phase 13 contract:** Accounting initializes on first accounting action.

**Question:** Does the current implementation guarantee that **accounts**, **chart_of_accounts**, **control mappings**, and **period** all exist before posting?

**Answer: FAIL.**

**Justification:**

1. **Client early return:** When `accounting_periods` has at least one row for the business, `ensureAccountingInitialized` does not call the RPC. So control mappings (and, if 244 was not run before, chart_of_accounts sync) are never created for that business on subsequent requests.
2. **243-only deployment:** If only migration 243 is applied, ensure_accounting_initialized never calls initialize_business_chart_of_accounts, so chart_of_accounts and chart_of_accounts_control_map are never created by bootstrap.
3. **Order of operations:** Posting (post_invoice_to_ledger) calls get_control_account_code('AR') before assert_accounting_period_is_open. So the failure is “Missing control account mapping: AR”, not period. The system does **not** guarantee that control mappings exist before posting runs.

---

## Output Summary

| Section | Result |
|---------|--------|
| **Executive Conclusion** | Fragmentation from (1) client early return when period exists, (2) 243-only bootstrap without control mappings. |
| **Fragmentation Sources Table** | PART 1–3 tables above: account creation (triggers dropped in 243); period creation (ensure_accounting_period does not call CoA/control map); control mapping only via initialize_business_chart_of_accounts (232 one-time, 244 inside bootstrap, retail trigger). |
| **Posting Order Verification** | Bootstrap (RPC) runs only when period count is 0. When period exists, RPC is skipped; posting runs without full bootstrap → FAIL. |
| **Authority Gate Findings** | Route uses anon key (authenticated). Bootstrap can be blocked by missing business_users, non-owner, or null auth.uid(); not by service role. |
| **Contract Compliance Verdict** | **FAIL:** Implementation does not guarantee accounts + chart_of_accounts + control mappings + period before posting. |

---

*Audit complete. Evidence only. No fixes, no code changes, no recommendations.*
