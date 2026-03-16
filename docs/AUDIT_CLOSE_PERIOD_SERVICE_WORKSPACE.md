# Audit: Close Period in Service Workspace (AUDIT ONLY — NO CODE CHANGES)

## Problem Statement

In Service workspace, a Close Period UI exists, but clicking it executes firm/accounting workspace logic. Service users cannot close periods properly.

---

## 1. Where Is the Close Period Button in Service Workspace?

### Finding: There is no Close Period page under `/app/service/...`

- **Service workspace** has no page that renders a Close Period button or `PeriodCloseCenter`.
- **`/app/service/health/page.tsx`** shows a read-only “Period summary” (open / soft closed / locked and “Next period to close”) but has **no button** to close a period. It only fetches `/api/accounting/periods?business_id=...` for display.
- Other service accounting routes either:
  - Render their own content (e.g. `/service/accounting`, `/service/accounting/contribution`, `/service/accounting/adjustment`), or
  - Redirect to canonical accounting (e.g. `/service/accounting/health` → `RedirectToCanonicalAccounting` → `/accounting/health?business_id=...`).

So the “Close Period UI” that Service users see is **not** under `/app/service/...`. It is the **Accounting workspace** page.

### How Service users reach the Close Period UI

- **Sidebar** (Service mode, non–firm user): the “Accounting” section includes **“Accounting Periods”** with route  
  `buildAccountingRoute("/accounting/periods", accountingBusinessId ?? undefined)`  
  i.e. **`/accounting/periods?business_id=<serviceBusinessId or urlBusinessId>`**.
- **`accountingBusinessId`** for Service (non–firm) is `serviceBusinessId ?? urlBusinessId`, where `serviceBusinessId` comes from `getCurrentBusiness()` when not on an accounting path.
- So when a Service user clicks “Accounting Periods”, they are sent to the **same** page as firm/accounting users: **`/accounting/periods`** with `business_id` in the query.

**Conclusion:**  
The Close Period **UI** is the **Accounting workspace** page. Service users reach it via the Sidebar link; there is **no** dedicated service-only Close Period page.

---

## 2. Page, onClick, and API Route

| Item | Detail |
|------|--------|
| **Page that shows Close Period** | `finza-web/app/accounting/periods/page.tsx` (Accounting workspace) |
| **Component that renders close actions** | `@/components/PeriodCloseCenter` (imported and used in that page) |
| **onClick / handlers** | Inside `PeriodCloseCenter`: buttons trigger `handleRequestClose`, `handleApproveClose`, `handleRejectClose`, `handleLock`, which call the API (see below). |
| **API route called for close** | **`POST /api/accounting/periods/close`** (single route for all close actions) |

**File paths:**

- Page: `finza-web/app/accounting/periods/page.tsx`
- Component: `finza-web/components/PeriodCloseCenter.tsx`
- API route: `finza-web/app/api/accounting/periods/close/route.ts`

`PeriodCloseCenter` also uses:

- **GET** `/api/accounting/periods/readiness?business_id=...&period_start=...`
- **RPC** `get_period_close_request_info(p_business_id, p_period_start)` (client-side Supabase)
- **POST** `/api/accounting/periods/close` for request_close / approve_close / reject_close / soft_close / lock

So there is **no** separate “service-mode” close route; Service and firm/accounting both use **`/api/accounting/periods/close`**.

---

## 3. API Route: Authorization and Firm Assumptions

**Route:** `finza-web/app/api/accounting/periods/close/route.ts`

### Exact authorization logic (in order)

1. **Auth**  
   - No user → `401 Unauthorized`.

2. **Body**  
   - Requires `business_id`, `period_start`, `action` (one of `soft_close`, `lock`, `request_close`, `approve_close`, `reject_close`).  
   - Otherwise `400`.

3. **Accounting write authority**  
   - `checkAccountingAuthority(supabase, user.id, business_id, "write")`.  
   - If not authorized → **403** with message:  
     **`"Unauthorized. Only accountants with write access can close or lock periods."`**  
   - `checkAccountingAuthority` treats as authorized: **owner**, **admin**, **accountant** (non–readonly), or firm user with write via `getAccountingAuthority`. So **business owners are allowed** at this step.

4. **Firm onboarding and role checks (only when user is a firm user)**  
   - `checkFirmOnboardingForAction(supabase, user.id, business_id)` → if it returns a **`firmId`**, the route:
     - Loads firm role from `accounting_firm_users`,
     - Loads active engagement via `getActiveEngagement(supabase, firmId, business_id)`,
     - Checks engagement effective dates,
     - Resolves authority with `resolveAuthority(...)` for the close action (`close_period`, `request_close_period`, `approve_close_period`, `reject_close_period`),
     - If not allowed → **403** and optional `logBlockedActionAttempt`.  
   - For a **pure Service user (owner, no firm)**, `getFirmIdForBusiness` returns **null**, so **this whole block is skipped**. No `accounting_firm_id` or accountant role is required for them at the API layer.

5. **Period fetch and state checks**  
   - Period is loaded from DB (via Supabase client, so **RLS applies**).  
   - Then action-specific validations (e.g. status must be `open` for `soft_close`, `closing` for `approve_close`, etc.).

6. **Mutations**  
   - Updates to `accounting_periods` (and related audit tables) are done with the **same Supabase server client** (user JWT). So **RLS applies** to SELECT/UPDATE on `accounting_periods`.

So the route:

- **Does not** explicitly enforce `accounting_firm_id` for all users; it only runs firm-specific checks when the user is linked to a firm for that business.
- **Does** require “accountant with write access” in the sense of `checkAccountingAuthority(..., "write")`, which **includes owner**.
- **Does** assume firm-mode only **when** `checkFirmOnboardingForAction` returns a firm (engagement, firm role, etc.). For Service-only owners, that branch is not taken.

So at the **API handler** level, a Service **owner** is not blocked by firm-only logic; they are allowed by `checkAccountingAuthority`. The blocker is elsewhere.

---

## 4. Comparison with Firm and Accounting Workspace Close Flows

| Aspect | Firm workspace | Accounting workspace | Service workspace |
|--------|----------------|----------------------|-------------------|
| **Page with Close Period UI** | Same: `/accounting/periods` (with `business_id` from URL / firm client selector) | Same: `/accounting/periods` | **No** dedicated page; uses same `/accounting/periods` via Sidebar link with `business_id` |
| **API route** | `POST /api/accounting/periods/close` | Same | Same |
| **business_id source** | URL / firm client context | URL | Sidebar: `serviceBusinessId ?? urlBusinessId` → passed in link |
| **Authority** | Firm user: `checkAccountingAuthority` + `resolveAuthority` (engagement, firm role). Owner of client biz could still be allowed if they have write. | Same as API | Same API; owner gets write via `checkAccountingAuthority` |

So:

- **Firm** and **Accounting** workspace close flows are the same page and same API; firm users get extra checks when `onboardingCheck.firmId` is set.
- **Service** has no separate close flow: it reuses the same page and same API. The only difference is how `business_id` is set (from Service sidebar context).

---

## 5. Is There a Dedicated Service-Mode Close Period Route?

**No.** There is no route under e.g. `/api/service/...` or any “owner-mode” variant for closing periods. Service users hit **`POST /api/accounting/periods/close`** with the same contract. So the failure is not “service calling the wrong route” but “same route + same data path hitting a different constraint” (see below).

---

## 6. Why Service Users Are Blocked

Two main possibilities, depending on how “service user” is defined and how the app sets up data:

### A) RLS on `accounting_periods` (most likely)

- **Current RLS** (from migrations 157/159 and 278/279): policies on `accounting_periods` are:
  - **“Users can view/insert/update/delete accounting periods for their business”** — **only** via `business_users` (user must have a row in `business_users` for that `business_id`).
  - **“Firm users can view accounting periods for engaged clients”** — only SELECT for firm + engagement.
- **Earlier migration 084** had allowed **owner** via `businesses.owner_id`; that was **replaced** by the `business_users`-only policies in 157/159. So **owner** is no longer explicitly in the USING clause unless they also have a `business_users` row.
- The API uses `createSupabaseServerClient()` (user JWT). So:
  - **GET** `/api/accounting/periods` → `supabase.from("accounting_periods").select(...)` → RLS applies. If the user is **owner only** (no `business_users` row), they may get **0 rows** → “No accounting periods found”.
  - **POST** `/api/accounting/periods/close` → after passing API auth, the handler does `supabase.from("accounting_periods").update(...)`. RLS again: if the owner has no `business_users` row, the UPDATE may affect **0 rows** → update “succeeds” but nothing changes, or the period was never visible so the flow is broken earlier (empty list or failed readiness).

So **service users who are pure owners (no `business_users` entry)** can be blocked by **RLS** on `accounting_periods`: the policies do not include `businesses.owner_id`, only `business_users`.

### B) API 403 “Only accountants with write access”

- If the service user is **not** owner/admin/accountant and **not** a firm user with write, `checkAccountingAuthority(..., "write")` fails and they get **403** with “Only accountants with write access can close or lock periods.”  
- So **non-owner, non-accountant** service users (e.g. manager/employee) are blocked at the **API authorization** step.

---

## 7. Blocker Classification

| Blocker | Description |
|--------|-------------|
| **A) Frontend routing** | Partially: there is **no** Close Period page under `/app/service/...`; the UI is the accounting page. Service users are sent to `/accounting/periods` via Sidebar. So “frontend” is “same page as firm/accounting,” not a wrong route. |
| **B) API authorization check** | Yes for **non-owner** service users: the route requires write in `checkAccountingAuthority` and returns 403 for others. Not the issue for **owners**. |
| **C) RPC restriction** | `get_period_close_request_info` and `check_period_close_readiness` / `run_period_close_checks` take only `business_id` and period; they are called from the API or client with already-authorized context. No explicit `accounting_firm_id` in the RPCs. RLS can still make underlying table access fail (e.g. on `accounting_periods`). So the main issue is not “RPC contract” but RLS behind the RPCs. |
| **D) RLS** | **Yes.** `accounting_periods` RLS allows only `business_users` (and firm for SELECT). It does **not** allow `businesses.owner_id`. So **owner-only** service users can be blocked on SELECT (empty periods) and UPDATE (close does nothing or period not found). |
| **E) Missing owner-mode branch** | **Yes.** The close route and UI do not have a dedicated “owner-mode” or “service-mode” branch. They use the same path as firm/accounting; when the user is owner and not in `business_users`, RLS (D) effectively blocks them. So the lack of an explicit owner path (or owner-aware RLS) is the gap. |

**Summary:**  
For **owner** service users, the main blocker is **D) RLS** (and thus **E) missing owner-mode branch**). For **non-owner** service users, **B) API authorization check** is the blocker.

---

## 8. Output Summary

- **Close Period UI in “Service workspace”:**  
  - No page under `/app/service/...` hosts it.  
  - Service users see it by going to **`/accounting/periods?business_id=...`** (Accounting workspace) via the Sidebar “Accounting Periods” link.

- **Page:** `finza-web/app/accounting/periods/page.tsx`  
- **Close actions component:** `finza-web/components/PeriodCloseCenter.tsx`  
- **API route:** `POST /api/accounting/periods/close`  
  - File: `finza-web/app/api/accounting/periods/close/route.ts`

- **Authorization in that route:**  
  - Requires `checkAccountingAuthority(..., "write")` (owner / admin / accountant / firm write).  
  - If the user is a firm user for that business, additionally: firm onboarding, engagement effective dates, and `resolveAuthority` for the close action.  
  - No explicit `accounting_firm_id` requirement for non-firm users; owners are allowed by `checkAccountingAuthority`.

- **Why service users are blocked:**  
  - **Owners:** RLS on `accounting_periods` does not include `businesses.owner_id`, only `business_users` (and firm SELECT). So owner-only users can get no rows on periods and no visible effect on close.  
  - **Non-owners:** 403 from “Only accountants with write access” when they lack write in `checkAccountingAuthority`.

- **Blocker types:**  
  - **A)** Frontend: no service-specific Close Period page; they use the accounting page (same route, correct).  
  - **B)** API: blocks non-owner, non-accountant service users.  
  - **C)** RPC: no direct restriction; RLS can still block via tables used inside RPCs.  
  - **D)** RLS: **primary** for owner service users — `accounting_periods` policies are `business_users` (and firm) only.  
  - **E)** Missing owner-mode branch: no separate path or RLS branch for owner-only access to close periods.

---

*Audit only; no code was modified.*
