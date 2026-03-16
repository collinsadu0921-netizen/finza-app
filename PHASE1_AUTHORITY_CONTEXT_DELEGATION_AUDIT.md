# PHASE 1 — Authority, Context & Delegation Audit (Foundation)

**Audit type:** Principal systems architect. Evidence only. No code changes, fixes, refactors, or assumptions.

**Date:** 2025-01-31.  
**Purpose:** Establish a single, canonical authority and context model that all workspaces must obey. Document exactly where and why it fails if it cannot be answered consistently.

**Objective (non-negotiable):** Answer conclusively: **Who is acting, on which business, with what authority — across Retail, Service, and Accounting-First?**

---

## PART 1 — CONTEXT RESOLUTION

Inventory of every mechanism used to resolve `business_id`:

---

### 1.1 getCurrentBusiness(supabase, userId)

| Attribute | Evidence |
|-----------|----------|
| **Where** | `lib/business.ts` — single exported async function |
| **Logic** | (1) Query `businesses` where `owner_id = userId`, limit 1. (2) If none, query `business_users` where `user_id = userId`, join `businesses`, limit 1. (3) Return first match or null. |
| **Who it works for** | Owner (businesses.owner_id); employee (business_users row). |
| **When it returns null** | User is not owner of any business and has no business_users row (e.g. firm-only user with no business membership). |
| **Firm → client** | **No.** Does not check accounting_firm_users, firm_client_engagements, or accountant_client_access. |
| **Ignores passed business_id** | **Yes.** Signature is (supabase, userId) only; no business_id parameter. |
| **Used by (UI)** | Accounting report pages (P&L, BS, GL, TB), periods page, reconciliation page, adjustments, carry-forward, opening-balances, chart-of-accounts, afs, exceptions, adjustments/review, trial-balance page. All set initial `businessId` from this only. |
| **Used by (API)** | Report APIs import it but do **not** use it for auth; they take business_id from query/body and use getUserRole(userId, businessId). So API does not “ignore” business_id — UI never passes one for these flows when user is firm-only (UI has no businessId). |

**Conflict:** For firm users, getCurrentBusiness returns null. Report/period/reconciliation/adjustments/carry-forward/coa/opening-balances/afs pages use it as sole source of initial businessId → firm users see “Business not found” and never get a business_id to pass to APIs.

---

### 1.2 getActiveClientBusinessId()

| Attribute | Evidence |
|-----------|----------|
| **Where** | `lib/firmClientSession.ts` — getActiveClientBusinessId(), setActiveClientBusinessId(). |
| **Logic** | Client-side only. Reads/writes sessionStorage key `finza_active_client_business_id`. |
| **Who it works for** | Firm users who have selected a client (e.g. from firm dashboard “Open client”). |
| **When it returns null** | No client selected; or SSR (typeof window === 'undefined'). |
| **Firm → client** | **Yes.** Explicit client selection; isolation by design. |
| **Ignores passed business_id** | N/A — this *is* the source of business_id for firm-client flows. |
| **Used by (UI)** | opening-balances-imports (all pages), journals/drafts (all pages), drafts page. These pages use it as primary businessId and call APIs with it. |
| **Used by (API)** | **No.** APIs do not read sessionStorage. They receive business_id in query/body and authorize via their own checks. |

**Conflict:** Report/period/reconciliation/adjustments/carry-forward/coa/opening-balances/afs pages do **not** use getActiveClientBusinessId() or URL business_id. So when a firm user opens “Open client” → /accounting?business_id=…, the accounting landing may receive the param, but child routes (reports, periods, reconciliation, etc.) never read it; they call getCurrentBusiness only → null.

---

### 1.3 URL business_id

| Attribute | Evidence |
|-----------|----------|
| **Where** | Firm dashboard: `router.push(\`/accounting?business_id=${client.business_id}\`)` — `app/accounting/firm/page.tsx` line 647. |
| **Consumed by** | No accounting page in scope reads searchParams for business_id for initial load. Periods, reports, reconciliation, adjustments, carry-forward, opening-balances, coa, afs all use getCurrentBusiness only (no useSearchParams for business_id). |
| **Firm → client** | Intended to pass client context; not consumed by target pages. |
| **Conflict** | UI passes business_id in URL; report/period/reconciliation (and related) pages ignore it. Context differs between navigation (firm has client) and page load (page has no business). |

---

### 1.4 Session / cookies

| Attribute | Evidence |
|-----------|----------|
| **Where** | Firm client context: sessionStorage only (firmClientSession). No cookie-based business_id found. Supabase session (auth) is separate. |
| **Summary** | Session storage used for active client business_id (firm only). Not used for owner/employee business context; getCurrentBusiness does not read session. |

---

### 1.5 Implicit owner resolution

| Attribute | Evidence |
|-----------|----------|
| **Where** | getCurrentBusiness: first step is businesses.owner_id = userId. getUserRole: first step is businesses.owner_id = userId → return "owner". requireBusinessRole: calls getUserRole only. |
| **Summary** | Owner is resolved implicitly as “user who is businesses.owner_id for that business.” No separate “current business” for owner other than getCurrentBusiness (which returns one business, owner or first business_users). |

---

### 1.6 Fallback logic

| Attribute | Evidence |
|-----------|----------|
| **getCurrentBusiness** | Fallback: if ownerError, retry businesses query; if multiple rows, limit(1). Still returns null if no owner and no business_users row. |
| **getUserRole** | No fallback; returns null if not owner and no business_users row. |
| **requireBusinessRole** | No fallback; 403 if getUserRole returns null. |
| **API report routes** | business_id from query required (400 if missing). Auth: getUserRole + isUserAccountantReadonly with that business_id. No fallback to “current” business. |

---

### 1.7 Context resolution — conflicts summary

| Conflict | Where | Why |
|----------|--------|-----|
| UI passes business_id in URL; pages ignore it | Firm dashboard → /accounting?business_id=…; periods, reports, reconciliation, etc. | Pages use getCurrentBusiness only; no searchParams or getActiveClientBusinessId for initial businessId. |
| Firm users have no resolvable business on most accounting pages | /accounting/reports/*, /accounting/periods, /accounting/reconciliation, adjustments, carry-forward, coa, opening-balances, afs, exceptions | getCurrentBusiness returns null for firm-only users; pages set businessId from it only → “Business not found.” |
| Context differs between page load and API call | Firm user on report page | Page load: getCurrentBusiness → null, so no API call with business_id. If page somehow had client business_id and called report API, API would receive business_id but getUserRole(userId, businessId) would return null → 403. So either no call (no context) or 403 (wrong auth). |

---

## PART 2 — AUTHORIZATION PATTERNS

Inventory of all authorization strategies used in accounting-related APIs:

---

### 2.1 getUserRole(supabase, userId, businessId)

| Attribute | Evidence |
|-----------|----------|
| **Where** | `lib/userRoles.ts`. |
| **Tables** | `businesses` (owner_id), `business_users` (business_id, user_id, role). |
| **User types** | Owner (businesses.owner_id); any role in business_users. |
| **Firm users + client** | **No.** Firm users have no business_users row for client businesses. Returns null. |
| **Blocks legitimate access** | **Yes.** Firm user acting on client business_id is legitimate by design but gets null → 403 where this is the only check. |
| **Allows unintended access** | No evidence. Only grants access if owner or business_users row. |
| **Used by** | All report APIs (P&L, BS, GL, TB + exports), period resolve, adjustments, carry-forward, coa, afs (all), opening-balances apply, reconciliation (via requireBusinessRole). |

---

### 2.2 requireBusinessRole(supabase, businessId, { allowedRoles })

| Attribute | Evidence |
|-----------|----------|
| **Where** | `lib/auth/requireBusinessRole.ts`. |
| **Tables** | Same as getUserRole (businesses.owner_id, business_users). Calls getUserRole only. |
| **User types** | Owner, admin, accountant (from business_users). allowedRoles default: ["owner", "admin", "accountant"]. |
| **Firm users + client** | **No.** 403 because getUserRole returns null. |
| **Blocks legitimate access** | **Yes.** Firm user + client → 403. |
| **Allows unintended access** | No evidence. |
| **Used by** | Reconciliation: mismatches, resolve, pending-approvals, policy, resolution-history, [scopeType]/[id]. |

---

### 2.3 can_accountant_access_business(p_user_id, p_business_id) (RPC)

| Attribute | Evidence |
|-----------|----------|
| **Where** | `supabase/migrations/105_accountant_access_guard.sql`. |
| **Tables** | `businesses` (owner_id); `accountant_firm_users`; `accountant_client_access` (aca.business_id, aca.firm_id, aca.access_level). |
| **Returns** | 'write' if owner; else access_level from accountant_client_access for (user in accountant_firm_users, firm has aca for business); else NULL. |
| **User types** | Owner; firm user with firm→client link in accountant_client_access. |
| **Firm users + client** | **Yes**, if RPC tables are populated. **Schema risk:** App and later migrations use `accounting_firm_users` and `accounting_firm_clients` / `firm_client_engagements` (migrations 142, 146). RPC references `accountant_firm_users` and `accountant_client_access` (migrations 104, 105). If only accounting_* / firm_client_engagements are populated, RPC may return NULL for all firm→client. |
| **Blocks legitimate access** | Possibly, if RPC tables are not the same as app tables. |
| **Allows unintended access** | No evidence. |
| **Used by** | Periods list, periods close, periods readiness, periods audit-readiness; trial-balance (legacy route); exports (transactions, levies, vat). |

---

### 2.4 isUserAccountantReadonly(supabase, userId, businessId)

| Attribute | Evidence |
|-----------|----------|
| **Where** | `lib/userRoles.ts`. |
| **Tables** | `businesses` (owner_id); `business_users` (business_id, user_id, accountant_readonly). |
| **User types** | Owner → false; business_users.accountant_readonly = true → true. |
| **Firm users + client** | **No.** No business_users row for firm→client. Returns false. Not used to *grant* firm access; used together with getUserRole so (owner | admin | accountant | accountant_readonly) get in. Since getUserRole is null for firm+client, isUserAccountantReadonly is irrelevant for that case. |
| **Used by** | All report APIs and exports that use getUserRole; reconciliation (to restrict posting). |

---

### 2.5 Direct role checks (firm + engagement)

| Attribute | Evidence |
|-----------|----------|
| **Where** | opening-balances (list/create): check firm onboarding + getActiveEngagement(supabase, firmId, business_id); engagement access_level and effective dates. Journals drafts post: checkFirmOnboardingForAction + draft.accounting_firm_id match + getActiveEngagement + resolveAuthority. Period reopen: checkFirmOnboardingForAction + getActiveEngagement + resolveAuthority. |
| **Tables** | accounting_firm_users; firm_client_engagements (or equivalent engagement source). |
| **User types** | Firm user with active engagement for client. |
| **Firm users + client** | **Yes.** Custom path; does not use can_accountant_access_business. |
| **Used by** | opening-balances route (list/create), opening-balances [id] (get, approve, post); journals drafts [id] post; periods reopen. |

---

### 2.6 Authorization — explicit flags

| Flag | APIs that allow owners but not firms | APIs that allow firms but not owners | Same business_id, different behavior |
|------|--------------------------------------|-------------------------------------|--------------------------------------|
| **Owners but not firms** | All report APIs (P&L, BS, GL, TB + exports), period resolve, adjustments (route + apply), carry-forward (route + apply), coa, afs (all), opening-balances apply, reconciliation (all). Owner has business_users/owner_id → getUserRole returns role; firm user has neither for client → null → 403. | None. | N/A. |
| **Firms but not owners** | None. | Periods list, close, readiness, audit-readiness; trial-balance (legacy); exports (transactions, levies, vat) use can_accountant_access_business — owner also passes (RPC returns 'write' for owner). So both owner and firm pass. | No. |
| **Different for same business_id** | No. For a given (user, business_id), result is deterministic: either owner/business_users path or firm path (where implemented). | No. | No. |

---

## PART 3 — FIRM → CLIENT DELEGATION COVERAGE

| API | Delegation | Auth check blocking firm→client | Delegation elsewhere for same business? |
|-----|------------|----------------------------------|------------------------------------------|
| **Period resolve** | ❌ | getUserRole + isUserAccountantReadonly only | Periods list uses can_accountant_access_business. |
| **Period list** | ✅ | — | — |
| **Period close** | ✅ | — | — |
| **Period readiness** | ✅ | — | — |
| **Period audit-readiness** | ✅ | — | — |
| **Period reopen** | ✅ | — | Uses firm+engagement path (getActiveEngagement, resolveAuthority). |
| **P&L report** | ❌ | getUserRole + isUserAccountantReadonly | No. |
| **P&L export CSV/PDF** | ❌ | Same | No. |
| **Balance sheet report** | ❌ | Same | No. |
| **Balance sheet export CSV/PDF** | ❌ | Same | No. |
| **Trial balance report** | ❌ | Same | Trial balance (legacy) route: ✅ can_accountant_access_business. |
| **Trial balance export CSV/PDF** | ❌ | Same | No. |
| **General ledger report** | ❌ | Same | No. |
| **General ledger export CSV/PDF** | ❌ | Same | No. |
| **Trial balance (legacy)** | ✅ | — | — |
| **Reconciliation mismatches** | ❌ | requireBusinessRole → getUserRole | No. |
| **Reconciliation resolve** | ❌ | requireBusinessRole → getUserRole | No. |
| **Reconciliation pending-approvals** | ❌ | requireBusinessRole | No. |
| **Reconciliation policy** | ❌ | requireBusinessRole | No. |
| **Reconciliation resolution-history** | ❌ | requireBusinessRole | No. |
| **Reconciliation [scopeType]/[id]** | ❌ | requireBusinessRole | No. |
| **Adjustments list** | ❌ | getUserRole + isUserAccountantReadonly | No. |
| **Adjustments apply** | ❌ | Same | No. |
| **Carry-forward list** | ❌ | Same | No. |
| **Carry-forward apply** | ❌ | Same | No. |
| **Chart of accounts** | ❌ | Same | No. |
| **AFS runs list** | ❌ | Same | No. |
| **AFS runs [id]** | ❌ | Same | No. |
| **AFS documents [run_id]** | ❌ | Same | No. |
| **AFS [run_id] finalize** | ❌ | Same | No. |
| **AFS runs [id] export csv/pdf/json** | ❌ | Same | No. |
| **Opening balances list/create** | ✅ | — | Uses firm+engagement (getActiveEngagement), not RPC. |
| **Opening balances [id] get/approve/post** | ✅ | — | Firm onboarding + engagement. |
| **Opening balances apply** | ❌ | getUserRole + isUserAccountantReadonly | No. |
| **Exports (transactions, levies, vat)** | ✅ | — | can_accountant_access_business. |
| **Drafts list** | ⚠️ | Uses accounting_firm_users + firmId; list scoped by firm. Client passed in query; auth via firm membership. | Partial: list is firm-scoped; client filter applied. |
| **Journals drafts [id] post** | ✅ | — | checkFirmOnboardingForAction + engagement + resolveAuthority. |

**Summary:** ✅ 10 (or 11 with drafts post). ❌ 35+. ⚠️ 1 (drafts list). Blocking check for all ❌ is either getUserRole (null for firm+client) or requireBusinessRole (same).

---

## PART 4 — WORKSPACE BOUNDARIES

### Retail

| Dimension | Evidence |
|-----------|----------|
| **What it can do** | Operate POS, sales, refunds, voids, inventory, register open/close. Ledger impact only via RPCs (post_sale_to_ledger, etc.) triggered by API; no direct ledger UI. Close Register reads Cash account balance for expected cash. |
| **What it must never do** | Access /accounting/*. Route guard: redirect to /retail/dashboard (lib/accessControl.ts). No accounting workspace UI. |
| **Where it depends on accounting APIs** | It does not call /api/accounting/*. Legacy /api/reports/registers returns 410; Retail does not call canonical accounting report APIs. |
| **Claims authority but lacks API support** | N/A. Retail does not claim accounting authority. |
| **UI exists but cannot function due to auth/context** | Register Report / VAT Report links point to legacy report endpoints that return 410; not an auth/context failure — intentional block. |

---

### Service

| Dimension | Evidence |
|-----------|----------|
| **What it can do** | Invoices, estimates, customers, dashboard. Read-only /accounting/reconciliation (route allowed for Service; reconciliation page uses getCurrentBusiness so owner sees own business). Dashboard calls /api/accounting/reconciliation/mismatches?businessId=… with businessId from getCurrentBusiness. |
| **What accounting data it can read** | Reconciliation mismatches (own business); balance sheet (app/reports/balance-sheet) calls /api/accounting/periods/resolve and /api/accounting/reports/balance-sheet with own business. Service owner has getUserRole = owner → passes. |
| **What it must never post** | No accounting post endpoints are exposed in Service workspace (no period close, adjustments, journal post from Service UI). |
| **Claims authority but lacks API support** | No. Service uses accounting APIs only for own business; getCurrentBusiness + getUserRole work for owner. |
| **UI exists but cannot function due to auth/context** | No. Owner has context and role. |

---

### Accounting-First

| Dimension | Evidence |
|-----------|----------|
| **What it is supposed to control** | Periods, reports, reconciliation, adjustments, carry-forward, COA, AFS, opening balances, journal drafts, exports — for firm’s clients and (if applicable) own business. |
| **What it actually controls today** | Same set of *features*, but **for firm users acting on client business:** only period list/close/readiness/audit-readiness, period reopen, trial-balance (legacy), exports, opening-balances (list/create/get/approve/post), journals drafts post. Reports, period resolve, reconciliation, adjustments, carry-forward, COA, AFS, opening-balances apply do **not** authorize firm→client. |
| **Where firm users are blocked from client work** | (1) **UI:** Report/period/reconciliation/adjustments/carry-forward/coa/opening-balances/afs pages use getCurrentBusiness only → “Business not found” for firm users. (2) **API:** Same endpoints use getUserRole or requireBusinessRole → 403 for firm user + client business_id even if client_id were passed. |
| **Claims authority but lacks API support** | Yes. Firm dashboard invites “Open client” and accounting is the workspace for “managing client books.” Core reports and reconciliation for that client are not available (API 403 or UI no context). |
| **UI exists but cannot function due to auth/context** | Yes. Report, period, reconciliation, adjustments, carry-forward, coa, opening-balances, afs pages do not function for firm-only users (no businessId). |

---

## PART 5 — FAILURE MODES

| Failure | Root cause | Assumption violated | Workspace |
|---------|------------|---------------------|-----------|
| “Business not found” on report/period/reconciliation/adjustments/carry-forward/coa/opening-balances/afs pages | Context: getCurrentBusiness returns null for firm-only user. | “Firm user can work in accounting with a selected client.” | Accounting-First |
| 403 Unauthorized / FORBIDDEN for firm user calling report API with client business_id | Auth: getUserRole(userId, client_business_id) returns null. | “Firm user may access client’s reports via same API as owner.” | Accounting-First |
| 403 for firm user calling reconciliation (mismatches, resolve, etc.) with client businessId | Auth: requireBusinessRole → getUserRole returns null. | “Firm user may run reconciliation for client.” | Accounting-First |
| Report pages load for owner but not for firm user | Context: owner has getCurrentBusiness → businessId; firm user has null. | “Single workspace supports both owner and firm viewing a business.” | Accounting-First |
| Same API succeeds for owner but fails for firm (e.g. GET report?business_id=X) | Auth: getUserRole(owner, X) = owner; getUserRole(firm_user, X) = null. | “Access to business X is consistent for whoever is allowed to act on X.” | Accounting-First |
| Period resolve 403 for firm user with client business_id | Auth: getUserRole + isUserAccountantReadonly only; no can_accountant_access_business. | “Period resolve is available to anyone who can list periods for that business.” | Accounting-First |
| Opening balance apply 403 for firm user with client business_id | Auth: getUserRole only. | “Firm can apply opening balances for client (same as list/post).” | Accounting-First |

---

## DELIVERABLES

### 1. Canonical Authority Model (DESCRIPTIVE, NOT PRESCRIPTIVE)

**Actors**

- **Owner:** User with `businesses.owner_id = user_id` for a business. Resolved by getCurrentBusiness (first) and getUserRole (first).
- **Employee:** User with a row in `business_users` for a business (role admin, manager, cashier, accountant, etc.). Resolved by getCurrentBusiness (second) and getUserRole (second).
- **Firm user:** User with a row in `accounting_firm_users` (and in app, `accounting_firm_users`). No requirement to be in business_users for client businesses. Access to client businesses intended via firm→client link (accountant_client_access in RPC; firm_client_engagements / accounting_firm_clients in app).

**Businesses**

- One business_id per tenant business. Ledger, periods, reports are keyed by business_id. Owner/employee membership: businesses.owner_id + business_users. Firm→client link: accountant_client_access (RPC) or firm_client_engagements / accounting_firm_clients (app).

**Delegation paths**

- **Owner/employee → business:** businesses.owner_id, business_users. Used by getCurrentBusiness, getUserRole, requireBusinessRole, all report/reconciliation/adjustment/coa/afs/opening-balances apply APIs.
- **Firm → client:** RPC can_accountant_access_business uses accountant_firm_users + accountant_client_access. App uses accounting_firm_users + firm_client_engagements (and accounting_firm_clients in some migrations). Custom firm+engagement checks used by opening-balances, journals drafts post, period reopen. **Delegation is not used** by report APIs, period resolve, reconciliation, adjustments, carry-forward, coa, afs, opening-balances apply.

**Authority scopes**

- **Retail:** Operational only; no /accounting/* access; ledger writes only via RPCs from API.
- **Service:** Own business only; read accounting (reconciliation, reports) via getCurrentBusiness + getUserRole; no accounting post from Service UI.
- **Accounting-First:** Intended: firm can act on client businesses (read + write where engagement allows). Actual: firm can act on client only for period list/close/readiness/audit-readiness/reopen, trial-balance (legacy), exports, opening-balances (list/create/get/approve/post), journals drafts post. Reports, period resolve, reconciliation, adjustments, carry-forward, coa, afs, opening-balances apply: owner/employee only (getUserRole/requireBusinessRole).

---

### 2. Gap Matrix

| Intended behavior | Actual behavior | API / workspace |
|-------------------|-----------------|------------------|
| Firm user views P&L for client | 403 or page “Business not found” | Report APIs use getUserRole; report pages use getCurrentBusiness only. |
| Firm user views Balance Sheet for client | Same | Same. |
| Firm user views Trial Balance (report) for client | Same | Same. |
| Firm user views General Ledger for client | Same | Same. |
| Firm user resolves period for client | 403 | Period resolve uses getUserRole only. |
| Firm user runs reconciliation for client | 403 or “Business not found” | requireBusinessRole; reconciliation page uses getCurrentBusiness. |
| Firm user lists adjustments for client | 403 or “Business not found” | getUserRole; adjustments page uses getCurrentBusiness. |
| Firm user applies adjustment for client | 403 | getUserRole. |
| Firm user carry-forward for client | 403 or “Business not found” | getUserRole; page uses getCurrentBusiness. |
| Firm user views COA for client | 403 or “Business not found” | getUserRole; coa page uses getCurrentBusiness. |
| Firm user runs AFS for client | 403 or “Business not found” | getUserRole; afs page uses getCurrentBusiness. |
| Firm user applies opening balances for client | 403 | getUserRole. |
| Firm user lists periods for client | ✅ Works | Periods API uses can_accountant_access_business. |
| Firm user closes period for client | ✅ Works | Same. |
| Firm user views trial balance (legacy) for client | ✅ Works | Trial balance route uses can_accountant_access_business. |
| Firm user exports (transactions, levies, vat) for client | ✅ Works | Exports use can_accountant_access_business. |
| Firm user manages opening balance imports for client | ✅ Works | Firm+engagement auth. |
| Firm user posts journal draft for client | ✅ Works | Firm+engagement + resolveAuthority. |
| Owner views own reports | ✅ Works | getCurrentBusiness + getUserRole. |
| Service owner sees reconciliation on dashboard | ✅ Works | getCurrentBusiness + requireBusinessRole. |

---

### 3. Alignment Score (0–100%)

**Score: 42%**

**Justification:**

- **Unified model:** One ledger per business; one set of accounting concepts (periods, reports, reconciliation). Retail and Service do not duplicate accounting authority.
- **Firm boundary:** Accounting workspace is firm-only at route level; delegation exists in DB and in a subset of APIs (periods, trial-balance legacy, exports, opening-balances, journal drafts).
- **Failure:** The majority of accounting APIs and all corresponding “business-scoped” pages assume a single path: **owner or business_users**. Firm→client is implemented in only a minority of APIs and is not used by report/period/reconciliation/adjustments/carry-forward/coa/afs/opening-balances apply. Context resolution for firm users on those pages is getCurrentBusiness only → null. So “who is acting, on which business, with what authority” is **not** answerable consistently: for firm user + client, context is missing or auth fails in most flows. Alignment is partial: ~10–11 APIs support firm→client; 35+ do not; UI for the latter does not supply client context for firm users.

---

### 4. Single Sentence Verdict

**Finza is currently operating on *multiple* authority models:** owner/employee membership (businesses + business_users) is the only model used by report, reconciliation, period resolve, adjustments, carry-forward, COA, AFS, and opening-balances apply APIs and by all corresponding pages for initial context; firm→client delegation exists in the schema and in a subset of APIs (periods, trial-balance legacy, exports, opening-balances, journal drafts) but is not used by the rest, so the same “acting on a client business” scenario is authorized in one place and denied in another.

---

**End of audit. Evidence only. No fixes, refactors, or assumptions.**
