# FINZA ARCHITECTURE AUDIT — CANONICAL "CURRENT BUSINESS" CONTRACT

**MODE:** Read-only. No code, no migrations, no patches.  
**GOAL:** Determine whether Finza has a single canonical definition of "current business" across Service, Accounting, Dashboard, and Invitations flows.

---

## SECTION 1 — Resolver Inventory Table

| Resolver | File | Workspace Used | Ordering Logic | Single vs Multi Business | Persistence Mechanism |
|----------|------|----------------|----------------|---------------------------|------------------------|
| **resolveServiceBusinessContext** | lib/serviceBusinessContext.ts | Service (invitations, service/reports/*, service/ledger, service/health) | **None.** Owner path: `.limit(1).maybeSingle()` no order. Member path: `.in("id", ids).limit(1).maybeSingle()` no order. | Single (one businessId) | None. Stateless per request. |
| **resolveAccountingBusinessContext** | lib/accountingBusinessContext.ts | Accounting (/accounting/*), Portal (/portal/accounting) | **Priority order only:** (1) URL business_id, (2) getActiveClientBusinessId(), (3) getCurrentBusiness(). No ordering within getCurrentBusiness call. | Single (one businessId) | URL query; sessionStorage + cookie (firmClientSession). |
| **getCurrentBusiness** | lib/business.ts | Dashboard, accessControl, many APIs (reports, ledger, invoices, expenses, etc.), Accounting fallback | **Owner:** `.order("created_at", { ascending: false }).limit(1)`. **Member:** business_users `.order("created_at", { ascending: false }).limit(50)` then first non-archived in array order. | Single (one business) | None. Stateless per request. |
| **getActiveClientBusinessId** | lib/firmClientSession.ts | Accounting (as input to resolveAccountingBusinessContext) | N/A — returns stored value. | Single (one client id) | sessionStorage key `finza_active_client_business_id`; cookie same key, path=/, max-age=86400. |
| **URL business_id parameter** | — | Accounting (explicit in links e.g. /accounting?business_id=, /accounting/ledger?business_id=) | N/A. | Single (one id in query) | URL only (no persistence beyond navigation). |
| **Cookie-based client context** | lib/firmClientSession.ts (setActiveClientCookie) | Server can read cookie for active client; key = ACTIVE_CLIENT_BUSINESS_ID_COOKIE | N/A. | Single | Cookie `finza_active_client_business_id`. |
| **Dashboard business resolution** | app/dashboard/page.tsx | Dashboard (/dashboard) | Uses **getCurrentBusiness** only (line 103). No separate resolver. | Single | None; industry then frozen in sessionStorage via ensureTabIndustryMode (industry only, not business id). |

**Additional:** industryMode (getTabIndustryMode / ensureTabIndustryMode) stores **industry** per tab in sessionStorage, not business id. Sidebar uses getCurrentBusiness when not in accounting path (line 87) and getActiveClientBusinessId when path starts with /accounting (line 49) to choose menu/industry. So dashboard does not define its own business resolver; it uses getCurrentBusiness.

---

## SECTION 2 — Contract Drift / Selection Criteria

### Per-resolver extraction

**resolveServiceBusinessContext**
- **Selection:** (1) One business where owner_id = userId, archived_at null. (2) Else one business from business_users (role in admin/accountant/manager/employee) where business has owner_id IS NOT NULL and archived_at null.
- **Ordering:** None on either path.
- **Ownership:** Path 1 requires owner. Path 2 does not (member allowed).
- **Claim:** Path 2 explicitly requires `.not("owner_id", "is", null)`.
- **RLS:** Depends on RLS on businesses, business_users (user sees own rows).
- **Session/cookie:** None.

**resolveAccountingBusinessContext**
- **Selection:** URL business_id → session getActiveClientBusinessId() → getCurrentBusiness().
- **Ordering:** Priority order only; getCurrentBusiness has its own ordering.
- **Ownership:** Not required if URL/session supply client (firm’s client). Fallback uses getCurrentBusiness (owner or member).
- **Claim:** Not explicit in resolver; getCurrentBusiness does not filter owner_id null for owner path (owner path is owner_id = userId).
- **RLS:** N/A for resolution; subsequent queries use resolved id.
- **Session/cookie:** getActiveClientBusinessId() reads sessionStorage/cookie.

**getCurrentBusiness**
- **Selection:** (1) One business where owner_id = userId, archived_at null, **ordered by created_at desc**, limit 1. (2) Else business_users for userId, order created_at desc, limit 50; first business in list with archived_at null (and business joined).
- **Ordering:** **Deterministic:** most recent owned; or first non-archived in created_at desc order for members.
- **Ownership:** Path 1 owner only. Path 2 membership only (any role in business_users; no role filter in getCurrentBusiness).
- **Claim:** Owner path returns only owned (so claimed). Member path: no explicit owner_id check in getCurrentBusiness (businesses(*) can include unclaimed).
- **RLS:** Depends on RLS for businesses, business_users.
- **Session/cookie:** None.

**getActiveClientBusinessId**
- **Selection:** Value stored by setActiveClientBusinessId (e.g. from firm client list click).
- **Ordering:** N/A.
- **Persistence:** sessionStorage + cookie.

### Contract Comparison Matrix

| Resolver | Deterministic | Owner Required | Membership Allowed | Multi Business Safe | Session Aware |
|----------|---------------|----------------|--------------------|---------------------|---------------|
| resolveServiceBusinessContext | **NO** (no order when multiple owned/member) | No (member path allowed) | Yes | **NO** — returns one, choice undefined when multiple | No |
| resolveAccountingBusinessContext | **YES** (priority: URL → session → getCurrentBusiness) | No (client can be firm’s client) | Yes | **Partially** — single result but source can be URL/session | Yes (session/client) |
| getCurrentBusiness | **YES** (created_at desc) | No (member fallback) | Yes | **NO** — returns one (most recent owned or first member) | No |
| getActiveClientBusinessId | **YES** (returns stored value) | N/A | N/A | Single by design | Yes |
| URL business_id | **YES** | N/A | N/A | Single by design | No |

---

## SECTION 3 — Invitations Architectural Dependency

**File:** app/api/service/invitations/route.ts

| Assumption | YES/NO | Evidence (lines) |
|------------|--------|------------------|
| **A) Single current business** | **YES** | Line 45: `const businessId = ctx.businessId`. Single value used for entire response. Line 52: `.eq("client_business_id", businessId)` — one business only. |
| **B) Deterministic business selection** | **NO** | Line 38: `resolveServiceBusinessContext(supabase, user.id)` — resolver has no ordering; when user has multiple businesses, selection is not deterministic. |
| **C) Business chosen matches engagement target** | **Assumed but not enforced** | API does not verify that resolved businessId is “the” business that should show invitations. It assumes resolver returns the business the owner is acting in. When resolver returns a different business (e.g. another owned business), engagements for the “other” business are not returned (line 52 filter). |
| **D) Service workspace cannot be multi-business** | **YES** | No business switcher; no aggregation across businesses. Single businessId in and out (lines 37–45, 129). |

---

## SECTION 4 — Cross-Workspace Resolution Matrix

**Simulated user:** Multiple owned businesses (A, B); multiple firm engagements (firm sees clients including business B); mixed membership + ownership (e.g. owner of A and B, member of firm).

| Workspace | Resolver Used | Business Returned | Deterministic |
|------------|---------------|-------------------|---------------|
| **Service Dashboard** | getCurrentBusiness (dashboard/page.tsx 103) | One: most recently created owned business (or first member business by created_at desc) | Yes |
| **Service Invitations** | resolveServiceBusinessContext (invitations API) | One: arbitrary owned business or first claimed member business (no order) | **No** |
| **Accounting Client Workspace** (e.g. ledger, reports) | resolveAccountingBusinessContext → URL or getActiveClientBusinessId or getCurrentBusiness | URL/session client if set; else getCurrentBusiness (most recent owned) | Yes given URL/session |
| **Accounting Firm Client List** | None (firm-centric) | N/A — list of all clients of user’s firms; not “one current business” | N/A (multi-client list) |
| **Portal / Reports** (e.g. /portal/accounting, /reports/profit-loss) | Portal: resolveAccountingBusinessContext. Reports (root): getCurrentBusiness | Same as Accounting if portal; reports use getCurrentBusiness | Same as Accounting for portal; yes for reports |

**Implication:** For the same user with multiple owned businesses, Service Dashboard and many report APIs use getCurrentBusiness → **deterministic** (most recent created). Service Invitations uses resolveServiceBusinessContext → **non-deterministic**. So the business returned for Invitations can differ from the business returned for Dashboard/Reports, and from the engagement’s client_business_id.

---

## SECTION 5 — Hidden Architectural Assumptions

| Assumption | TRUE / FALSE | Evidence |
|------------|--------------|----------|
| "Service workspace is always single-business" | **TRUE** | No switcher; resolveServiceBusinessContext returns one businessId; invitations and service/reports/* all use single business. |
| "Accounting workspace is multi-client" | **TRUE** | Firm client list returns many clients; context is URL or session client or fallback; one “current” client at a time but user can switch (session/URL). |
| "Dashboard assumes owner context" | **TRUE** | Dashboard uses getCurrentBusiness (owner or member); redirects by industry; no firm-only path for “dashboard” — firm users without business redirect to accounting/firm (dashboard page 104–118). |
| "Firm workspace ignores service context" | **TRUE** | Accounting routes use resolveAccountingBusinessContext (URL/session/getCurrentBusiness); they do not call resolveServiceBusinessContext. Firm client list is firm-centric, not “current service business”. |
| "Current business is the same across Service features" | **FALSE** | Service invitations use resolveServiceBusinessContext (non-deterministic). Other service pages/APIs often use getCurrentBusiness (deterministic). So “current” can differ. |
| "Owner has exactly one business" | **FALSE** (implicit in some code) | getCurrentBusiness and resolveServiceBusinessContext both support multiple; neither asserts “exactly one”. Invitations assume single business matches engagement target. |
| "Session/client selection is authoritative in Accounting" | **TRUE** | resolveAccountingBusinessContext prefers URL then session over getCurrentBusiness. So explicit selection wins. |

---

## SECTION 6 — Canonical Contract Recommendation (NO CODE)

**Question:** Should Finza define:

- **OPTION A:** Single global "Current Business" context shared across all workspaces  
- **OPTION B:** Workspace-scoped context contracts  
- **OPTION C:** Explicit business selector everywhere  

**Recommendation:** **OPTION B (workspace-scoped context contracts)** with a **canonical rule for Service workspace** so that within Service, one resolver and one ordering rule apply.

**Justification:**

- **OPTION A** is not aligned with current design: Accounting is explicitly multi-client (firm chooses client via URL/session). A single global “current business” would conflict with “current client” in Accounting when the user is a firm member. So a single global context shared by Service and Accounting is not appropriate.
- **OPTION B** fits: Accounting already has a clear contract (URL → session → getCurrentBusiness) and is multi-client by design. Service can have its own contract, but it must be **consistent within Service**: all Service features (dashboard, invitations, service/reports, service/ledger) should resolve “current business” the same way (e.g. same as getCurrentBusiness: ordering by created_at desc for owner and for member). That would make Service single-business and deterministic without forcing Accounting to use the same source.
- **OPTION C** (explicit selector everywhere) would fix multi-business ambiguity but is a larger UX and implementation change. It can be layered on later (e.g. business switcher in Service once “current” is well-defined).

**Concrete recommendation from audit:** Define a **canonical Service “current business”** contract: e.g. “the business returned by getCurrentBusiness(supabase, userId) when the user is in Service workspace.” Then have resolveServiceBusinessContext (and any other Service-only resolution) use that same logic (or call getCurrentBusiness and return its id) so that Dashboard, Invitations, and service/reports/* all see the same business. No code changes in this audit; this is architectural direction only.

---

## SECTION 7 — Risk Assessment

If the current architecture remains unchanged:

| Risk | Description |
|------|-------------|
| **Engagement visibility drift** | Pending engagement visible in firm list but missing in Service invitations because Service resolver returns a different business than the one the engagement is linked to. **Already observed** (see AUDIT_PENDING_ENGAGEMENT_FIRM_VS_SERVICE.md). |
| **Multi-business data leakage** | Low risk of cross-business data leak from RLS (policies are per business_id). Higher risk is **wrong context**: user thinks they are in business A, resolver returns B, so they see B’s data in one flow and A’s in another (confusion, not necessarily leak). |
| **Context mismatch bugs** | Service features using getCurrentBusiness (dashboard, many APIs) vs resolveServiceBusinessContext (invitations, service/reports/*, service/ledger) can show different “current” business for same user. Leads to “why don’t I see my invitation?” and similar. |
| **RLS bypass edge cases** | Unlikely: RLS is per row and keyed by business_id / owner_id. No resolver bypasses RLS; they only choose which business_id to pass. Edge case: if a resolver ever returned a business the user is not allowed to see, subsequent queries would still be RLS-filtered; the issue would be “empty or wrong data” not bypass. |
| **UI inconsistency** | Dashboard and sidebar may show “Business A” (from getCurrentBusiness or industry from that business) while invitations shows list for “Business B” (from resolveServiceBusinessContext), with no indication that the context differs. |

---

## OUTPUT SUMMARY

1. **Resolver Inventory Table** — Section 1 (all resolvers, file, workspace, ordering, single/multi, persistence).
2. **Contract Comparison Matrix** — Section 2 (deterministic, owner required, membership, multi-business safe, session aware).
3. **Cross Workspace Resolution Matrix** — Section 4 (per-workspace resolver, business returned, deterministic).
4. **Hidden Assumptions List** — Section 5 (TRUE/FALSE with evidence).
5. **Canonical Contract Recommendation** — Section 6: **OPTION B** (workspace-scoped contracts) with a single canonical rule for Service so that Service uses one consistent “current business” (e.g. aligned with getCurrentBusiness).
6. **Risk Assessment** — Section 7 (engagement visibility drift, context mismatch, UI inconsistency, etc.).

No fixes. No design proposals beyond the recommendation above. No code.
