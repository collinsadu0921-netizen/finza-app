# FINZA IMPLEMENTATION — CANONICAL SERVICE "CURRENT BUSINESS" CONTRACT

**MODE:** Architecture-aligned implementation  
**GOAL:** Enforce ONE deterministic resolver for Service workspace  
**CONSTRAINT:** Accounting workspace unchanged  

---

## AUTHORITATIVE DECISION

Service workspace SHALL use **getCurrentBusiness(supabase, userId)** as the canonical resolver for:

- Service Dashboard (already used getCurrentBusiness; unchanged)
- Service Invitations
- Service Ledger
- Service Reports
- Any /service/* APIs or pages

**resolveServiceBusinessContext** SHALL be a thin wrapper around getCurrentBusiness.

---

## SECTION 1 — Service Resolver Usage Table

### resolveServiceBusinessContext — all usages (code only)

| File | Route/API/Page | Resolver Used | Must Change (Y/N) |
|------|----------------|---------------|--------------------|
| app/api/service/invitations/route.ts | GET /api/service/invitations | resolveServiceBusinessContext | N |
| app/service/invitations/page.tsx | /service/invitations | (page calls API; API uses resolver) | N |
| app/service/ledger/page.tsx | /service/ledger | resolveServiceBusinessContext | N |
| app/service/health/page.tsx | /service/health | resolveServiceBusinessContext | N |
| app/service/reports/profit-and-loss/page.tsx | /service/reports/profit-and-loss | resolveServiceBusinessContext | N |
| app/service/reports/trial-balance/page.tsx | /service/reports/trial-balance | resolveServiceBusinessContext | N |
| app/service/reports/balance-sheet/page.tsx | /service/reports/balance-sheet | resolveServiceBusinessContext | N |
| app/service/expenses/activity/page.tsx | /service/expenses/activity | resolveServiceBusinessContext | N |
| lib/serviceBusinessContext.ts | (definition) | — | Y (implementation only) |

### getCurrentBusiness — Service-relevant usages (no call-site changes)

| File | Route/API/Page | Resolver Used | Must Change (Y/N) |
|------|----------------|---------------|--------------------|
| app/dashboard/page.tsx | /dashboard (Service entry) | getCurrentBusiness | N |
| lib/accessControl.ts | All workspaces (access resolution) | getCurrentBusiness | N |
| components/Sidebar.tsx | Global nav | getCurrentBusiness (non-accounting path) | N |
| app/api/ledger/list/route.ts | /api/ledger/list (used by service ledger) | getCurrentBusiness | N |
| app/api/reports/* (profit-loss, balance-sheet, trial-balance, etc.) | Shared report APIs | getCurrentBusiness | N |

**Summary:** Only **lib/serviceBusinessContext.ts** was changed (implementation). All call sites of resolveServiceBusinessContext continue to call it; they now receive deterministic business selection without any change.

---

## SECTION 2 — Refactor Plan (Completed)

**Target:** lib/serviceBusinessContext.ts

**New contract (implemented):**

1. Call getCurrentBusiness(supabase, userId).
2. If null or no id → return { error: "NO_CONTEXT" }.
3. If business exists but owner_id is null → return { error: "NO_CONTEXT" } (preserve “claimed only” membership rule).
4. Otherwise → return { businessId: business.id }.

**Preserved:**

- Return type: ServiceBusinessContext unchanged.
- Error string: "NO_CONTEXT" unchanged.
- Membership rules: only claimed businesses (owner_id IS NOT NULL) still returned; unclaimed/firm-created businesses still excluded.
- RLS: resolution still uses same Supabase client; no RLS expectations changed.

**Not changed:**

- accountingBusinessContext.ts (Accounting workspace)
- firmClientSession, URL business_id, portal routes
- Any UI or migrations

---

## SECTION 3 — Service Consistency Verification

All Service features that need business context now resolve it via **resolveServiceBusinessContext → getCurrentBusiness**.

| Feature | Resolver chain | Previous behaviour | New behaviour |
|---------|----------------|--------------------|----------------|
| /service/invitations (API) | resolveServiceBusinessContext → getCurrentBusiness | Arbitrary owned or first claimed member business (no order) | Most recent owned by created_at DESC, or first non-archived member by created_at DESC; claimed only |
| /service/ledger | resolveServiceBusinessContext → getCurrentBusiness | Same as above | Same as above |
| /service/health | resolveServiceBusinessContext → getCurrentBusiness | Same as above | Same as above |
| /service/reports/profit-and-loss | resolveServiceBusinessContext → getCurrentBusiness | Same as above | Same as above |
| /service/reports/trial-balance | resolveServiceBusinessContext → getCurrentBusiness | Same as above | Same as above |
| /service/reports/balance-sheet | resolveServiceBusinessContext → getCurrentBusiness | Same as above | Same as above |
| /service/expenses/activity | resolveServiceBusinessContext → getCurrentBusiness | Same as above | Same as above |
| /dashboard (Service) | getCurrentBusiness directly | Most recent owned / first member (deterministic) | Unchanged |
| /api/service/expenses/activity | business_id from request (from page’s resolver) | Page passed businessId from resolveServiceBusinessContext | Page still uses resolveServiceBusinessContext; API receives same businessId, now deterministic |

**Diff summary:** For users with multiple owned or multiple member businesses, the **which** business is returned is now deterministic (created_at DESC) everywhere in Service. Previously, Invitations (and other resolveServiceBusinessContext call sites) could return a different business than Dashboard/Reports.

---

## SECTION 4 — Determinism Validation

**getCurrentBusiness ordering (lib/business.ts):**

- **Owner path:** `ORDER BY created_at DESC LIMIT 1` — single deterministic business (most recently created owned).
- **Membership path:** business_users query uses `ORDER BY created_at DESC LIMIT 50`; first non-archived in that ordered list is chosen — deterministic (first by created_at DESC among memberships).

**resolveServiceBusinessContext** now:

1. Calls getCurrentBusiness (no additional ordering).
2. Applies only a null check and owner_id non-null check.

**Confirmation:** Service workspace context is now deterministic. All callers of resolveServiceBusinessContext inherit the same ordering as getCurrentBusiness: owner = most recent by created_at; member = first non-archived by created_at in business_users.

---

## SECTION 5 — Regression Safety Audit

| Area | Impact | PASS/FAIL |
|------|--------|-----------|
| Accounting client selection (resolveAccountingBusinessContext) | resolveAccountingBusinessContext is in lib/accountingBusinessContext.ts; it uses URL → getActiveClientBusinessId() → getCurrentBusiness. It does not call resolveServiceBusinessContext. No change. | **PASS** |
| Firm workspace client listing | Firm client list and firm APIs use firm_id and engagements; they do not use resolveServiceBusinessContext. No change. | **PASS** |
| Session-based active client | getActiveClientBusinessId/setActiveClientBusinessId and cookie live in lib/firmClientSession.ts; used only by resolveAccountingBusinessContext and accounting UI. No change. | **PASS** |
| URL business_id behaviour | Accounting pages and APIs that take business_id from URL are unchanged; resolveAccountingBusinessContext unchanged. | **PASS** |
| Portal accounting routes | Portal uses resolveAccountingBusinessContext (e.g. app/portal/accounting/page.tsx). No use of resolveServiceBusinessContext. No change. | **PASS** |

---

## SECTION 6 — Final Architecture Contract (Handbook Snippet)

**Business context resolution — canonical rules**

- **Service workspace**  
  Single deterministic “current business” for all /service/* and Service entry (e.g. dashboard when industry is service).  
  Resolver: **getCurrentBusiness(supabase, userId)**. Exposed to callers via **resolveServiceBusinessContext(supabase, userId)**, which is a thin wrapper (same result, plus “claimed only” guard).  
  Ordering: owner = most recent by created_at; member = first non-archived by created_at.  
  Service workspace = **single deterministic business**.

- **Accounting workspace**  
  Multi-client: current client is chosen by URL business_id, then session active client, then getCurrentBusiness fallback.  
  Resolver: **resolveAccountingBusinessContext(supabase, userId, searchParams)**.  
  Accounting workspace = **multi-client selectable**.

---

## SECTION 7 — Test Scenario Matrix

| Scenario | User type | Expected Service business resolution |
|----------|-----------|--------------------------------------|
| **A) 1 owned business** | Owner of business A | A (only option) |
| **B) 2 owned businesses** | Owner of A (older) and B (newer) | B (most recent by created_at DESC) |
| **C) Owner of A + member of B** | Owns A; member of B (claimed) | A (owner path takes precedence in getCurrentBusiness) |
| **D) Firm user + owner** | Belongs to firm; also owns business A | When in Service workspace: A (getCurrentBusiness returns owned business). Accounting workspace unchanged (firm client selection independent). |

---

## OUTPUT SUMMARY

1. **Service Resolver Usage Table** — Section 1 (resolveServiceBusinessContext and getCurrentBusiness; Must Change only for lib/serviceBusinessContext.ts implementation).
2. **Refactor Plan** — Section 2 (thin wrapper: getCurrentBusiness + null/claimed check; contract preserved).
3. **Service consistency** — Section 3 (all Service features now resolve via resolveServiceBusinessContext → getCurrentBusiness; diff map previous vs new).
4. **Determinism proof** — Section 4 (getCurrentBusiness ordering; Service inherits it).
5. **Regression safety table** — Section 5 (all PASS; Accounting, firm, session, URL, portal unchanged).
6. **Final architecture contract** — Section 6 (handbook snippet: Service = single deterministic; Accounting = multi-client).
7. **Test scenario matrix** — Section 7 (A–D expected resolution).

**Code change:** lib/serviceBusinessContext.ts only. No migrations. No UI changes.
