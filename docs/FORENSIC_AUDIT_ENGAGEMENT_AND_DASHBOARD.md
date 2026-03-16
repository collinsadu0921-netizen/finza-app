# Forensic Audit: Engagement Lifecycle, Context Resolution, and Workspace Gating (READ-ONLY)

**Scope:** Recent changes related to engagement lifecycle, context resolution, and workspace gating.  
**Constraints:** No fixes, no code changes. Explanation of what changed and why UI moved or disappeared.

---

## 1. Why the “Accept engagement” button no longer appears in the accounting workspace

### 1.1 Where the button would have to live (by design)

- **Accept is a client (business owner) action.**  
  `app/api/accounting/firm/engagements/[id]/route.ts` (PATCH): only the **business owner** can call `action: 'accept'`. The API checks `business?.owner_id === user.id` and returns 403 with "Only business owners can accept engagements" otherwise.
- So any UI for “Accept engagement” must be shown to the **owner** of the client business, not to firm users.

### 1.2 Accounting workspace is not visible to business owners

- **Access control:** `lib/accessControl.ts` (resolveAccess for workspace `"accounting"`):
  - If the user has a business via `getCurrentBusiness(supabase, userId)` (i.e. they are an owner or have `business_users` membership), they are treated as a **business owner** and **denied** access to `/accounting/*`.
  - They are redirected to `/dashboard` (service) or `/retail/dashboard` (retail).
- So **business owners never see the accounting workspace**. Only users who are **accounting firm members** (and optionally have no business) can reach `/accounting/*`.
- **Causal chain:** Accept is owner-only → owners are blocked from `/accounting/*` → the Accept button **cannot** appear in the accounting workspace for the user who is allowed to click it.

### 1.3 No “Accept engagement” UI found anywhere

- Grep for “Accept engagement”, “accept.*engagement”, “Accept” (in engagement context), and for calls to `PATCH .../engagements/[id]` with accept:
  - **No component or page** in `app/` or `components/` renders an “Accept engagement” button.
- The accounting firm pages that show engagements:
  - `app/accounting/firm/page.tsx`: client list with `EngagementStatusBadge` (pending/active/suspended/terminated). Row click goes to `/accounting?business_id=...`. **No Accept or Reject button.**
  - `app/accounting/firm/clients/add/page.tsx`: copy says “The client must accept this engagement before it becomes active” and “Engagements start in 'pending' status and require client acceptance”. **No owner-facing Accept UI.**
- **Conclusion:** There is **no UI in the codebase** that lets a business owner accept (or reject) a pending engagement. The API supports it; the button was either never implemented or was removed. It **could not** live in the accounting workspace for the acting user (the owner), because owners are gated out of that workspace.

### 1.4 Engagement status and firm visibility (migrations 277, 279)

- **Migration 279** (engagement lifecycle hardening):
  - Adds status `accepted`. Effective = `accepted` or `active` + within date range.
  - Blocks direct `pending → active`; only `pending → accepted` (client accept sets `accepted`).
  - RLS and `get_active_engagement` use `status IN ('accepted', 'active')` for “effective”.
- **Migration 277:** Adds update policy so **business owners** can update their business’s engagements (accept/reject).
- These changes do **not** remove or hide any Accept **button**; they define who can accept (owner) and what state transitions are valid. The absence of the button is due to **no UI implementing it** and **owners not being allowed in the accounting workspace**.

### 1.5 Summary (Accept button)

| Question | Answer |
|----------|--------|
| Which files/guards removed or hid it? | No guard “removed” it. **accessControl** prevents owners from seeing `/accounting/*`, so the button could not meaningfully live there for the owner. No Accept button exists in the repo. |
| Engagement status changes (pending → accepted)? | 279 enforces pending→accepted (owner accept); does not affect presence of a button. |
| Accounting vs service workspace? | **Yes.** Accept is an owner action; owners are redirected to service (or retail). So any Accept UI would have to be in **service** (e.g. dashboard/settings), not in accounting. |
| Client context gating? | Accounting context is for firm users selecting a client. The **actor** for accept is the owner; they use “current business” context in the service workspace, not accounting client context. |
| UI conditional logic? | No conditional found that shows/hides an Accept button; the button is simply not implemented. |

---

## 2. Why the service dashboard “reverted” to the old version

### 2.1 Which dashboard is rendered today

- **Route:** `app/dashboard/page.tsx` (used for `/dashboard`).
- **Context:** Uses **getCurrentBusiness(supabase, user.id)** only. Does **not** use `resolveServiceBusinessContext` or `resolveAccountingBusinessContext`.
- **Flow:** If no user → login. If no business and not accounting_firm signup → redirect to business-setup (or firm setup). If cashier → redirect to POS. If industry retail → redirect to POS. If industry logistics → redirect to rider. **Only when industry === "service"** does the page stay on dashboard and render the **inline** service UI (metric cards, charts, alerts, menu sections).
- **ServiceDashboardCockpit** (`components/dashboard/service/ServiceDashboardCockpit.tsx`): Implements the “new” service dashboard (tiles, FinancialFlowChart, service-timeline or service-analytics). It is **never imported or rendered** by any route in `app/`. So the **current** dashboard is the “old” version: inline implementation in `app/dashboard/page.tsx`, not the cockpit component.

### 2.2 Context resolver used for the dashboard

- **Dashboard page** uses **getCurrentBusiness** (from `lib/business.ts`). It does **not** use:
  - `resolveServiceBusinessContext`, or
  - `resolveAccountingBusinessContext`.
- So the “revert” is **not** caused by a switch from one context resolver to another on the dashboard route. The dashboard has not been wired to `resolveServiceBusinessContext`.

### 2.3 Effect of owner_id and “business claim” on dashboard

- **getCurrentBusiness** (lib/business.ts):
  - First: business where `owner_id = userId` and `archived_at` is null.
  - Else: first business from `business_users` (user_id, roles admin/accountant/manager/employee) whose business has `archived_at` null.
  - No filter on `owner_id IS NOT NULL` for the owner path (the owner’s business is always “claimed”). For **business_users** path, the code does not explicitly filter by `owner_id IS NOT NULL` in the current implementation; it just takes the first non-archived business from the user’s memberships.
- **resolveServiceBusinessContext** (lib/serviceBusinessContext.ts):
  - Returns a business only if: (1) user is owner (`owner_id = userId`), or (2) user is in `business_users` and the business has **owner_id IS NOT NULL** (and not archived).
  - So **unclaimed businesses** (firm-created, `owner_id` null) never get service context from `resolveServiceBusinessContext`. They are intentionally excluded from service workspace.
- **Dashboard:** Because the dashboard uses **getCurrentBusiness**, not `resolveServiceBusinessContext`, the dashboard can in theory show a business that is “unclaimed” if that business were returned by getCurrentBusiness. In practice, getCurrentBusiness does not join to firms; firm-created unclaimed businesses typically have no `business_users` row for the firm user (firm users are not added as business_users for the client). So a firm user usually has **no business** from getCurrentBusiness and is redirected to accounting/firm or firm/setup. So for the **dashboard** route, “owner_id IS NOT NULL” does not change layout in the current code path: the dashboard is only rendered when the user has a business and industry is service, which in practice is the **owner** (or an employee of a claimed business). Unclaimed businesses are not surfaced to the dashboard because their owner has not logged in yet.

### 2.4 Charts and “accountant internal” indicators

- Charts on the dashboard are rendered **inline** in `app/dashboard/page.tsx` (e.g. AreaChart, stats from `loadServiceDashboardStats`). They are not rendered via ServiceDashboardCockpit.
- **ClientContextWarning** and **AccountingBreadcrumbs** (ProtectedLayout): Rendered only when `pathname?.startsWith('/accounting')`. So they do not appear on `/dashboard`; no “accountant internal” indicators on the service dashboard.

### 2.5 Summary (service dashboard “revert”)

| Question | Answer |
|----------|--------|
| Which context resolver is used? | **getCurrentBusiness** only. Neither serviceBusinessContext nor accountingBusinessContext is used on the dashboard page. |
| owner_id / business claim effect on layout/charts? | Dashboard is only shown when user has a business and industry is service; in practice that is owner or employee of a claimed business. resolveServiceBusinessContext (owner_id guard) is not used on this page, so the “revert” is not caused by that guard. |
| Why “old” version? | The “new” version is ServiceDashboardCockpit (tiles + FinancialFlowChart + service-timeline/analytics). It exists but is **never used** by any app route. The dashboard route has always (in current codebase) used the inline implementation; there is no evidence in the repo of the dashboard ever having rendered ServiceDashboardCockpit. So either the cockpit was never wired up, or it was wired and later reverted (no commit history in this audit). |

---

## 3. Exact changes that caused this behaviour

### 3.1 Accept button

- **Relevant logic (no UI):**
  - **lib/accessControl.ts:** Denies business owners access to `/accounting/*` and redirects them to `/dashboard` or `/retail/dashboard`. So the only users who see the accounting workspace cannot accept engagements (only owners can).
  - **app/api/accounting/firm/engagements/[id]/route.ts:** PATCH with `action: 'accept'` requires `business?.owner_id === user.id`; otherwise 403 "Only business owners can accept engagements".
  - **app/accounting/firm/page.tsx:** Shows clients and engagement status badge; no Accept/Reject actions.
- **Migrations:** 277 (owner update policy on firm_client_engagements), 279 (pending→accepted, accepted_at required, RLS effective = accepted/active). These support the accept **flow** and **data**; they do not add or remove UI.

### 3.2 Service dashboard “revert”

- **Relevant files:**
  - **app/dashboard/page.tsx:** Uses getCurrentBusiness; branches on industry (service → inline dashboard); does **not** import or render ServiceDashboardCockpit.
  - **lib/business.ts:** getCurrentBusiness (owner then business_users); no owner_id IS NOT NULL filter for service.
  - **lib/serviceBusinessContext.ts:** Restricts to claimed businesses (owner_id IS NOT NULL for non-owner path). Used by `/service/*` and some service report pages; **not** by `/dashboard`.
- **No evidence in codebase** of the dashboard ever having used ServiceDashboardCockpit; the “revert” may reflect an expectation (cockpit as “new” design) that was never merged or was reverted in an earlier change.

### 3.3 Engagement lifecycle and context (list of relevant artifacts)

| File / artifact | Role |
|-----------------|------|
| lib/accessControl.ts | Denies owners access to /accounting/*; redirects to /dashboard or /retail/dashboard. |
| app/api/accounting/firm/engagements/[id]/route.ts | PATCH accept/reject: owner-only; pending→accepted. |
| app/accounting/firm/page.tsx | Firm client list; EngagementStatusBadge; no Accept button. |
| app/accounting/firm/clients/add/page.tsx | Copy about client having to accept; no owner Accept UI. |
| lib/firmOnboarding.ts | checkEngagementAccessForAction; “Engagement is pending client acceptance” when status pending. |
| lib/serviceBusinessContext.ts | Resolves service business only when owner or business_users and owner_id IS NOT NULL. |
| lib/accountingBusinessContext.ts | URL → session client → getCurrentBusiness for accounting pages. |
| lib/business.ts | getCurrentBusiness (owner then business_users). |
| app/dashboard/page.tsx | getCurrentBusiness; inline service dashboard; no ServiceDashboardCockpit. |
| components/dashboard/service/ServiceDashboardCockpit.tsx | Present but unused by any route. |
| supabase/migrations/277_add_update_policy_firm_client_engagements.sql | Owners can update engagements (accept/reject). |
| supabase/migrations/278_firm_engagement_ledger_periods_tbs_rls.sql | Firm SELECT on ledger/periods/TBS (later updated by 279 to accepted/active). |
| supabase/migrations/279_engagement_lifecycle_hardening.sql | accepted status; pending→accepted only; accepted_at required; RLS and get_active_engagement use accepted/active. |

---

## 4. Whether this behaviour is intentional or a side-effect

### 4.1 Accept button

- **Is the engagement button supposed to live only in the service workspace?**  
  Yes, for the **actor** who can click it. Only the **business owner** can accept; owners are restricted to service (or retail). So any Accept UI **should** live in the service (or owner) workspace (e.g. dashboard, settings, or “Invitations” page), not in the accounting workspace. The accounting workspace is for **firm** users; they can see pending status but cannot accept.
- **Side-effect:** The **complete absence** of an Accept (and Reject) button anywhere is likely a **missing feature**, not an intentional removal: the API and policies are in place for owners to accept, but no UI was built (or it was removed and not restored in the owner flow).

### 4.2 Service dashboard and unclaimed businesses

- **Is the service dashboard intentionally hidden for unclaimed businesses?**  
  **resolveServiceBusinessContext** intentionally excludes unclaimed businesses (owner_id IS NOT NULL). So pages that use **resolveServiceBusinessContext** (e.g. `/service/ledger`, `/service/reports/*`) will not resolve a context for a firm-created, unclaimed business. The **dashboard** does not use that resolver; it uses getCurrentBusiness. Unclaimed businesses are not expected to be returned by getCurrentBusiness for the firm user (no business_users link). So the “hidden for unclaimed” behaviour is intentional in **service** context resolution; the dashboard itself is only shown when the user already has a (claimed) business and industry service.
- **Intentional vs side-effect:** The current dashboard being the “old” (inline) version and not the cockpit is either **intentional** (cockpit never shipped) or a **side-effect** of a prior revert or refactor; the codebase does not show when or why the cockpit was not wired to `/dashboard`.

---

## 5. Bullet-point summary

- **Accept button:**
  - Only **business owners** can accept engagements (API and 277/279).
  - **accessControl** blocks owners from `/accounting/*` and sends them to `/dashboard` (or retail). So the accounting workspace is never visible to the user who is allowed to accept.
  - No UI in the repo renders an “Accept engagement” button (no owner-facing page listing pending engagements with Accept/Reject).
  - So the button does not appear in the accounting workspace because (1) it could not be used there by the right actor, and (2) it is not implemented anywhere (owner flow missing).

- **Service dashboard:**
  - The route `/dashboard` uses **getCurrentBusiness** only (no resolveServiceBusinessContext / resolveAccountingBusinessContext).
  - The rendered UI is the **inline** service dashboard in `app/dashboard/page.tsx`. **ServiceDashboardCockpit** is never imported or rendered by any app route.
  - So the “old” version is the only version in the codebase; “revert” likely means the cockpit was never integrated or was removed earlier.

- **Context and gating:**
  - **resolveServiceBusinessContext:** Used by `/service/*` and some service report pages; restricts to claimed businesses (owner_id IS NOT NULL for non-owner path). Unclaimed businesses never get service context there.
  - **resolveAccountingBusinessContext:** Used by `/accounting/*` and portal/accounting; URL → session client → getCurrentBusiness.
  - **Dashboard** does not use either; it uses getCurrentBusiness and industry, so owner_id in serviceBusinessContext does not directly drive dashboard layout; unclaimed businesses are not in scope for the dashboard because getCurrentBusiness does not return them for firm-only users.

- **Migrations 277, 278, 279:**
  - 277: Owners can update engagements (accept/reject).
  - 278: Firm users with effective engagement can read ledger/periods/TBS (279 later broadened “effective” to accepted/active).
  - 279: Lifecycle hardening (accepted, pending→accepted only, accepted_at required, RLS and functions use accepted/active). No UI changes; they enable correct data and permissions for accept and for firm access once accepted.
