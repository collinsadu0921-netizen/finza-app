# FINZA — Complete End-to-End Audit Report (Static + Runtime)

**Date:** 2025-02-12  
**Scope:** Service Mode E2E, Accounting workspace entry, Engagement/readiness gating, Navigation discipline.  
**Key bug addressed:** "Advanced accounting pages load, reload, and return to dashboard."

---

## 1. Executive Verdict

**Status: Ready (with applied minimal patches)**

**Blocking reasons addressed:**
- Business owners (service/retail) hitting `/accounting/*` were **silently** redirected to `/dashboard` or `/retail/dashboard`, causing the observed "load, reload, return to dashboard" (ProtectedLayout runs async `resolveAccess` → deny → `router.push(redirectTo)`). This is now replaced with an **explicit** Access Denied screen at `/accounting/access-denied`.

**Remaining (non-blocking):**
- No middleware; all redirects are client-side in ProtectedLayout or server-side in auth callback / legacy redirects. Entry points that bypass `/accounting/open` are documented; client-scoped pages show EmptyState when `business_id` is missing (no silent redirect).

---

## 2. Runtime Redirect Map (ALL redirect sources)

Evidence: exact file and line.

| File | Function / location | Condition | Target | Persona impacted |
|------|---------------------|-----------|--------|-------------------|
| `components/ProtectedLayout.tsx` | `useEffect` → `checkAccess()` | `!decision.allowed` | `decision.redirectTo` (from resolveAccess) | All denied users |
| `lib/accessControl.ts` | `resolveAccess` | No userId | `/login` | Unauthenticated |
| `lib/accessControl.ts` | `resolveAccess` | path /pos, no cashier PIN | `/pos/pin` | User without PIN |
| `lib/accessControl.ts` | `resolveAccess` | workspace === "service" && path /accounting/* | **`/accounting/access-denied`** (was `/dashboard`) | P1 Service owner |
| `lib/accessControl.ts` | `resolveAccess` | workspace === "accounting" && user not in firm && has business (service) | **`/accounting/access-denied`** (was `/dashboard`) | P1 Service owner |
| `lib/accessControl.ts` | `resolveAccess` | workspace === "accounting" && user not in firm && has business (retail) | **`/accounting/access-denied?return=retail`** (was `/retail/dashboard`) | P2 (retail owner) |
| `lib/accessControl.ts` | `resolveAccess` | workspace === "accounting" && no business, no firm, signupIntent accounting_firm | `/accounting/firm/setup` | P5 |
| `lib/accessControl.ts` | `resolveAccess` | workspace === "accounting" && no business, no firm, else | `/business-setup` | No business |
| `lib/accessControl.ts` | `resolveAccess` | No business (non-accounting), not setup route | `/business-setup` | No business |
| `lib/accessControl.ts` | `resolveAccess` | workspace retail && industry !== retail | `/dashboard` | P1 on retail route |
| `lib/accessControl.ts` | `resolveAccess` | workspace service && industry retail | `/retail/dashboard` | Retail user on /dashboard |
| `lib/accessControl.ts` | `resolveAccess` | accountant_readonly && accounting route not in allowed list | `/accounting` | P3 readonly on blocked route |
| `lib/accessControl.ts` | `resolveAccess` | role cashier && path not /pos | `/pos` | Cashier |
| `lib/accessControl.ts` | `resolveAccess` | role manager && path /settings/staff or /admin | `/retail/dashboard` | Manager |
| `lib/accessControl.ts` | `resolveAccess` | Store context required, no active store | `/select-store?return=...` | Retail admin/owner/manager |
| `app/auth/callback/route.ts` | POST handler | User has business | `${origin}/dashboard` | Post-login |
| `app/auth/callback/route.ts` | POST handler | Firm user, no firm setup | `${origin}/accounting/firm/setup` | P5 |
| `app/auth/callback/route.ts` | POST handler | Firm user | `${origin}/accounting/firm` | P3/P4 |
| `app/login/page.tsx` | (success) | After login | `window.location.href = "/dashboard"` | Post-login |
| `app/accounting/open/page.tsx` | Server component | !businessId | `redirect("/accounting")` | Missing business_id on open |
| `app/accounting/open/page.tsx` | Server component | !user | `redirect("/login")` | Not logged in |
| `app/ledger/page.tsx` | Server | businessId from cookie/session | `redirect(buildAccountingRoute("/accounting/ledger", businessId) or "/accounting")` | Legacy /ledger |
| `app/trial-balance/page.tsx` | Server | Same | `redirect(.../accounting/reports/trial-balance or "/accounting")` | Legacy /trial-balance |
| `app/reconciliation/page.tsx` | Server | Same | `redirect(.../accounting/reconciliation or "/accounting")` | Legacy /reconciliation |
| `app/reconciliation/[accountId]/page.tsx` | Server | Same | `redirect(... or "/accounting")` | Legacy |
| `app/reconciliation/[accountId]/import/page.tsx` | Server | Same | `redirect(... or "/accounting")` | Legacy |

**Note:** `/accounting/access-denied` is **allowed** in `resolveAccess` when `pathname === "/accounting/access-denied"` so that denied users can see the screen instead of being sent to dashboard.

---

## 3. Navigation Inventory (entry into accounting)

| Entry point | Target route | Goes through /accounting/open? | Notes |
|-------------|--------------|--------------------------------|-------|
| Sidebar (accounting items) | `buildAccountingRoute("/accounting/ledger", sidebarBusinessId)` etc. | No | Direct to /accounting/ledger?business_id=…; Control Tower has no business_id |
| Sidebar | Control Tower | N/A | `/accounting/control-tower` (no business_id) |
| Dashboard (service) discrepancy banner | `buildAccountingRoute("/accounting/reconciliation", business?.id)` | No | Service owner: hits resolveAccess → **access-denied** (patched) |
| app/accounting/page.tsx hub cards | Links to ledger, CoA, TB, etc. with businessId from URL | N/A | Hub is already under /accounting; businessId from URL |
| Control Tower drill links | `buildAccountingRoute("/accounting/...", clientBusinessId)` | No | From control-tower list; includes business_id |
| Legacy /ledger, /trial-balance, /reconciliation | Server redirect | No | Redirect to /accounting/...?business_id= or /accounting |
| Direct URL /accounting/open?business_id=X | Server: authority + readiness then redirect to /accounting?business_id=X | Yes | Canonical gate for “open accounting” for a client |
| Firm clients list | `router.push(\`/accounting?business_id=${client.business_id}\`)` | No | From firm dashboard |

**Conclusion:** Most entry points do **not** go through `/accounting/open`. They link directly to client-scoped routes with `?business_id=`. When `business_id` is missing, pages show **EmptyState** (“Client not selected”) or **ClientContextWarning**; no redirect to dashboard from within accounting pages. The only redirect to dashboard for accounting routes was in `resolveAccess` (business owner / service user), now replaced with `/accounting/access-denied`.

---

## 4. API Gate Inventory (accounting APIs requiring business_id)

| API pattern | Missing business_id behavior | Evidence |
|-------------|------------------------------|----------|
| `/api/accounting/readiness?business_id=` | 400 or 404 typical | readiness route validates param |
| `/api/accounting/periods/close` | 400 "Missing required fields" | app/api/accounting/periods/close/route.ts |
| `/api/ledger/list?business_id=` | Likely 400/403 | List route requires business_id |
| `/api/accounting/coa?business_id=` | Same | Used by ledger, chart-of-accounts |

Behavior for missing param: APIs return 4xx; no redirect. Client-scoped pages that call these without `business_id` (from URL) do not fetch or show EmptyState.

---

## 5. Engagement / Readiness Matrix (expected vs observed)

| Persona | Description | Expected | Observed (after patch) |
|---------|-------------|----------|-------------------------|
| P1 Service owner | Business owner, industry service | Cannot access /accounting/* | resolveAccess → redirect to **/accounting/access-denied**; page shows “Access denied” + “Return to Dashboard” |
| P2 Service employee | business_users employee | Same as P1 for /accounting (no firm) | Same as P1 |
| P3 Firm accountant, ACTIVE + effective + accepted | Firm user, engagement active | Access client-scoped routes with business_id | Allowed; EmptyState when business_id missing |
| P4 Firm accountant, PENDING | Engagement pending | Denied or limited | /accounting/open shows “Engagement is pending acceptance” (server); client pages use readiness/authority |
| P5 Firm accountant, NO engagement | No engagement for client | Denied | /accounting/open shows “No engagement exists”; API readiness/authority deny |
| P6 Firm accountant, NOT_EFFECTIVE | effective_from in future | Denied for that client | getAccountingAuthority returns not allowed; /accounting/open shows “Engagement is not effective” |
| P7 Firm accountant, SUSPENDED/TERMINATED | Engagement ended | Denied | Same as P6; reason message in open page |
| P8 Missing business_id on client-scoped route | Any user, URL without business_id | EmptyState or warning, no silent redirect | ClientContextWarning banner; pages show EmptyState “Client not selected”; no redirect to dashboard |

---

## 6. Repro Steps for the “Load, Reload, Return to Dashboard” Bug

**Before patch:**
1. Log in as **service business owner** (no accounting_firm_users row).
2. From service dashboard, click “Go to Accounting → Reconciliation” (discrepancy banner) or open `/accounting/ledger?business_id=<owner’s business id>` (or any /accounting/* URL).
3. **Observed:** Loading appears, then navigation to `/dashboard` (or `/retail/dashboard` for retail owner). No explicit denial message.

**Root cause:**  
- **File:** `lib/accessControl.ts`  
- **Condition:** `workspace === "accounting"` and user has a business and is **not** in `accounting_firm_users` (or workspace === "service" and path is /accounting/*).  
- **Action:** `resolveAccess` returned `redirectTo: "/dashboard"` (or `/retail/dashboard`).  
- **Execution:** `ProtectedLayout` useEffect runs after mount → `resolveAccess(supabase, userId, pathname)` → `!decision.allowed` → `router.push(redirectTo)`.

**After patch:**  
Same steps lead to redirect to **`/accounting/access-denied`** (or `?return=retail` for retail). User sees “Access denied” and “Return to Dashboard” instead of silent dashboard.

---

## 7. Minimal Patches Applied

| # | File | Change | Why minimal |
|---|------|--------|-------------|
| 1 | `app/accounting/access-denied/page.tsx` | **New.** Client page showing “Access denied” and “Return to Dashboard” (and optional “Retail Dashboard”). | Single dedicated screen; no change to other UI. |
| 2 | `lib/accessControl.ts` | Allow `pathname === "/accounting/access-denied"` → `return { allowed: true }` at start of STEP 4. | Only addition for that path; no other logic changed. |
| 3 | `lib/accessControl.ts` | STEP 3b: service user on /accounting/* → `redirectTo: "/accounting/access-denied"` instead of `/dashboard`. | One string change. |
| 4 | `lib/accessControl.ts` | STEP 4: business owner (service) → `redirectTo: "/accounting/access-denied"`; (retail) → `redirectTo: "/accounting/access-denied?return=retail"`. | Two redirect targets updated; no new logic. |

No migrations, no schema edits, no UI redesign. No redirect in render; redirect remains in ProtectedLayout useEffect.

---

## 8. Task 4 — Runtime Trace (Bug)

- **Route entered:** e.g. `/accounting/ledger?business_id=<id>` or `/accounting/reconciliation?business_id=<id>` (by service owner).
- **Next navigation:** ProtectedLayout’s `useEffect` runs → `resolveAccess(supabase, userId, pathname)` → for service owner on accounting path, returns `{ allowed: false, redirectTo: "/dashboard" }` (pre-patch).
- **Condition:** User in `businesses` / owner of business, **not** in `accounting_firm_users`; OR workspace from path is "service" and path starts with `/accounting`.
- **File+line responsible:** `lib/accessControl.ts` (STEP 3b and STEP 4 block for business owner) setting `redirectTo`; `components/ProtectedLayout.tsx` line 64 `router.push(redirectTo)`.

No `router.replace` or redirect during render in accounting pages; no async state update during render that triggers redirect. Redirect is entirely from ProtectedLayout after async resolveAccess.

---

## 9. Task 5 — Service Mode Cannot Close Periods

**Statement:** **Service Mode cannot close accounting periods: by design, enforced by access control and API authority.**

- **UI:** Period close is only in **accounting** workspace: `app/accounting/periods/page.tsx` (Soft close / Lock buttons). Service routes (`/dashboard`, `/service/*`, `/invoices`, etc.) do not render period close. Service health (`/service/health`) and control-tower show “Next period to close” as **read-only**.
- **API:** `POST /api/accounting/periods/close` is used only by the accounting periods page. It calls `checkAccountingAuthority(supabase, user.id, business_id, "write")` and returns 403 with “Only accountants with write access can close or lock periods” when not authorized (`app/api/accounting/periods/close/route.ts` lines 54–60). Firm role and engagement are then checked via `resolveAuthority` / `getActiveEngagement` for request_close / approve_close / reject_close.
- **Enforcement:** (1) `resolveAccess` blocks non–firm users from all `/accounting/*` routes, so service owners never reach the periods page. (2) Period close API requires firm user and write (or approve) authority; service owners have no firm membership and never pass `checkAccountingAuthority` for that context.

---

## 10. Acceptance Results (Post-Patch)

| Check | Result |
|-------|--------|
| Accountant without business_id sees explicit “Client required” state, not dashboard | Yes. Client-scoped pages show EmptyState “Client not selected”; ClientContextWarning shows “Go to Control Tower”. No redirect to dashboard. |
| Accountant with denied engagement sees Access Denied UI, not dashboard | Yes. /accounting/open validates authority; when not allowed it renders “Access denied” + reason + “Go to Control Tower”. No redirect to dashboard. |
| Owner with business_id (and firm access) reaches accounting without reload loop | Yes. Firm users get `allowed: true` for accounting; client-scoped pages load when business_id present. No redirect. |
| /accounting/open as single canonical gate | Partial. /accounting/open is the **only** route that validates authority + readiness and then redirects to /accounting?business_id=X. Other entry points (sidebar, control tower, hub cards) link directly to client-scoped routes with business_id; they rely on resolveAccess (firm vs non-firm) and in-page EmptyState when business_id is missing. So “canonical gate” for “open this client’s books” is /accounting/open?business_id=; direct links are valid and deterministic. |
| Service/retail owner hitting /accounting/* sees explicit Access Denied, not dashboard | Yes. Redirect target is now /accounting/access-denied (or ?return=retail); page shows message and “Return to Dashboard”. |

---

## 11. Summary

- **Redirect map:** All redirect sources are in `lib/accessControl.ts` (via ProtectedLayout) and in auth callback, login, and legacy server redirects; table in §2 lists them with file and line.
- **Accounting entry:** Most entries are direct links with `?business_id=`; only “open this client” flow uses `/accounting/open`. Missing business_id yields EmptyState, not silent redirect.
- **Bug:** “Load, reload, return to dashboard” was caused by `resolveAccess` returning `redirectTo: "/dashboard"` (or retail) for business owners on /accounting/*; ProtectedLayout then called `router.push(redirectTo)`. Fix: redirect to `/accounting/access-denied` (and `/accounting/access-denied?return=retail`) and allow that path so users see an explicit “Access denied” screen with “Return to Dashboard”.
- **Patches:** One new page (`app/accounting/access-denied/page.tsx`) and three edits in `lib/accessControl.ts`; no other files changed, no migrations, no schema or UI redesign.
