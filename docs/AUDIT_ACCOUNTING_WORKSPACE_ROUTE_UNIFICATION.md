# FINZA ACCOUNTING WORKSPACE ROUTE UNIFICATION AUDIT

**Objective:** Identify all accounting pages and APIs that rely on getCurrentBusiness(), service workspace resolver, session/cookie-only context, RPC authority without accounting authority engine, or client workspace routing instead of firm accounting routing.

**Scope:** Audit only. No code changes, no fixes, no patches.

---

## STEP 1 — Accounting-Related Routes Found

### Under `/accounting` (app/accounting/)

| Page file | Route path |
|-----------|------------|
| page.tsx | /accounting |
| layout.tsx | (layout) |
| control-tower/page.tsx | /accounting/control-tower |
| control-tower/[businessId]/page.tsx | /accounting/control-tower/[businessId] |
| opening-balances/page.tsx | /accounting/opening-balances |
| opening-balances-imports/page.tsx | /accounting/opening-balances-imports |
| opening-balances-imports/new/page.tsx | /accounting/opening-balances-imports/new |
| opening-balances-imports/[id]/page.tsx | /accounting/opening-balances-imports/[id] |
| opening-balances-imports/[id]/edit/page.tsx | /accounting/opening-balances-imports/[id]/edit |
| journals/page.tsx | /accounting/journals |
| journals/new/page.tsx | /accounting/journals/new |
| journals/drafts/[id]/page.tsx | /accounting/journals/drafts/[id] |
| journals/drafts/[id]/edit/page.tsx | /accounting/journals/drafts/[id]/edit |
| journals/drafts/[id]/review/page.tsx | /accounting/journals/drafts/[id]/review |
| journals/drafts/new/page.tsx | /accounting/journals/drafts/new |
| drafts/page.tsx | /accounting/drafts |
| ledger/page.tsx | /accounting/ledger |
| chart-of-accounts/page.tsx | /accounting/chart-of-accounts |
| reconciliation/page.tsx | /accounting/reconciliation |
| periods/page.tsx | /accounting/periods |
| trial-balance/page.tsx | /accounting/trial-balance |
| reports/balance-sheet/page.tsx | /accounting/reports/balance-sheet |
| reports/profit-and-loss/page.tsx | /accounting/reports/profit-and-loss |
| reports/general-ledger/page.tsx | /accounting/reports/general-ledger |
| reports/trial-balance/page.tsx | /accounting/reports/trial-balance |
| adjustments/page.tsx | /accounting/adjustments |
| adjustments/review/page.tsx | /accounting/adjustments/review |
| carry-forward/page.tsx | /accounting/carry-forward |
| audit/page.tsx | /accounting/audit |
| health/page.tsx | /accounting/health |
| exceptions/page.tsx | /accounting/exceptions |
| afs/page.tsx | /accounting/afs |
| firm/page.tsx | /accounting/firm |
| firm/onboarding/page.tsx | /accounting/firm/onboarding |
| firm/setup/page.tsx | /accounting/firm/setup |
| firm/clients/add/page.tsx | /accounting/firm/clients/add |
| firm/ops/page.tsx | /accounting/firm/ops |
| firm/authority/page.tsx | /accounting/firm/authority |

### Under `/portal/accounting`

| Page file | Route path |
|-----------|------------|
| portal/accounting/page.tsx | /portal/accounting |

### Under `/firm` (accounting client picker)

| Page file | Route path |
|-----------|------------|
| firm/accounting-clients/page.tsx | /firm/accounting-clients |
| firm/accounting-clients/add (via href) | /firm/accounting-clients/add |

### Under `/admin/accounting`

| Page file | Route path |
|-----------|------------|
| admin/accounting/forensic-runs/page.tsx | /admin/accounting/forensic-runs |
| admin/accounting/forensic-runs/[run_id]/page.tsx | /admin/accounting/forensic-runs/[run_id] |
| admin/accounting/tenants/page.tsx | /admin/accounting/tenants |

### Service workspace pages that call accounting APIs

| Page file | Route path |
|-----------|------------|
| service/health/page.tsx | /service/health |
| service/reports/profit-and-loss/page.tsx | /service/reports/profit-and-loss |
| service/reports/trial-balance/page.tsx | /service/reports/trial-balance |

### Other app routes that call accounting APIs (owner/service context)

| Page file | Route path |
|-----------|------------|
| reports/profit-loss/page.tsx | /reports/profit-loss |
| reports/balance-sheet/page.tsx | /reports/balance-sheet |
| dashboard/page.tsx | /dashboard (reconciliation mismatches) |

**Note:** No routes found under `/clients/*/accounting`, `/client/*/accounting`, or `/accounting-management`.

---

## STEP 2 — Per-Page Record (Context + Authority + APIs)

| Route | business_id / context source | Authority (page-level) | APIs called |
|-------|------------------------------|-------------------------|-------------|
| /accounting | getActiveFirmId() only (onboarding check) | NONE | /api/accounting/firm/onboarding/complete |
| /accounting/control-tower | None (no client required) | NONE | /api/accounting/control-tower/work-items |
| /accounting/control-tower/[businessId] | URL param [businessId] | NONE | /api/accounting/control-tower/client-summary?business_id= |
| /accounting/opening-balances | resolveAccountingBusinessContext (URL → session → getCurrentBusiness) | NONE | periods, opening-balances, opening-balances/apply |
| /accounting/opening-balances-imports | getActiveFirmId() + getActiveClientBusinessId() (session/cookie) | NONE | opening-balances, opening-balances-imports [id] |
| /accounting/opening-balances-imports/new | getActiveFirmId() + getActiveClientBusinessId() | NONE | periods, opening-balances (POST) |
| /accounting/opening-balances-imports/[id] | getActiveFirmId() + getActiveClientBusinessId() | NONE | opening-balances/[id], approve, post |
| /accounting/opening-balances-imports/[id]/edit | getActiveFirmId() + getActiveClientBusinessId() | NONE | opening-balances/[id], update |
| /accounting/journals | getActiveClientBusinessId() + checkClientContext() (session/cookie) | NONE | periods, journals/drafts (client_business_id + period_id) |
| /accounting/journals/new | getActiveClientBusinessId() | NONE | periods, coa, journals/drafts (POST), submit |
| /accounting/journals/drafts/[id] | getActiveClientBusinessId(), getActiveClientBusinessName() | NONE | journals/drafts/[id], submit, approve, reject, post |
| /accounting/journals/drafts/[id]/edit | getActiveClientBusinessId(), getActiveClientBusinessName() | NONE | journals/drafts/[id], periods, coa, PATCH |
| /accounting/journals/drafts/[id]/review | getActiveClientBusinessId() | NONE | journals/drafts/[id] |
| /accounting/journals/drafts/new | getActiveClientBusinessId() | NONE | (same as journals/new) |
| /accounting/drafts | getActiveFirmId() + getActiveClientBusinessId() | NONE | /api/accounting/drafts (firm_id, client_business_id query) |
| /accounting/ledger | resolveAccountingBusinessContext | NONE | /api/ledger/list (business_id) |
| /accounting/chart-of-accounts | resolveAccountingBusinessContext | NONE | coa?business_id= |
| /accounting/reconciliation | resolveAccountingBusinessContext | NONE | reconciliation/mismatches, pending-approvals, resolution-history, resolve |
| /accounting/periods | resolveAccountingBusinessContext | NONE | periods/close, periods?business_id= |
| /accounting/trial-balance | resolveAccountingBusinessContext | NONE | periods, reports/trial-balance |
| /accounting/reports/balance-sheet | resolveAccountingBusinessContext | NONE | periods, reports/balance-sheet, exports |
| /accounting/reports/profit-and-loss | resolveAccountingBusinessContext | NONE | periods, reports/profit-and-loss |
| /accounting/reports/general-ledger | resolveAccountingBusinessContext | NONE | periods, reports/general-ledger |
| /accounting/reports/trial-balance | resolveAccountingBusinessContext | NONE | periods, reports/trial-balance, exports |
| /accounting/adjustments | resolveAccountingBusinessContext | NONE | adjustments, periods, coa, adjustments/apply |
| /accounting/adjustments/review | resolveAccountingBusinessContext | NONE | (review flow) |
| /accounting/carry-forward | resolveAccountingBusinessContext | NONE | periods, carry-forward, carry-forward/apply |
| /accounting/audit | resolveAccountingBusinessContext | NONE | audit?businessId= |
| /accounting/health | resolveAccountingBusinessContext | NONE | (health checks) |
| /accounting/exceptions | resolveAccountingBusinessContext | NONE | (commented-out exceptions API) |
| /accounting/afs | resolveAccountingBusinessContext | NONE | afs/runs, documents, finalize |
| /accounting/firm | getActiveFirmId() | NONE | firm APIs |
| /accounting/firm/onboarding | getActiveFirmId() | NONE | firm/onboarding/complete |
| /accounting/firm/setup | (firm setup) | NONE | — |
| /accounting/firm/clients/add | getActiveFirmId() | NONE | firm/clients/add, firms |
| /accounting/firm/ops | (firm ops) | NONE | firm/ops |
| /accounting/firm/authority | (authority) | NONE | — |
| /portal/accounting | resolveAccountingBusinessContext | NONE | coa, periods/resolve, reports/* (business_id) |
| /firm/accounting-clients | getActiveFirmId() | NONE | /api/accounting/firm/clients |
| /reports/profit-loss | getCurrentBusiness() | NONE | /api/accounting/reports/profit-and-loss (business.id) |
| /reports/balance-sheet | getCurrentBusiness() | NONE | accounting reports |
| /service/health | (service business from context) | NONE | periods?business_id=, reconciliation/pending-approvals?businessId= |
| /service/reports/profit-and-loss | (service business) | NONE | periods, reports/profit-and-loss |
| /service/reports/trial-balance | (service business) | NONE | periods, reports/trial-balance |

---

## STEP 3 — APIs Called By Those Pages (Authority + business_id)

| API route | Requires business_id? | business_id from | Authority method | Multi-client (accepts any allowed client)? |
|-----------|------------------------|------------------|------------------|-------------------------------------------|
| GET /api/accounting/control-tower/work-items | No (uses effective list) | N/A | getAccountingAuthority + getEffectiveBusinessIdsForFirmUser | Yes |
| GET /api/accounting/control-tower/client-summary | Yes (query) | Query business_id | getAccountingAuthority | Yes |
| GET /api/accounting/firm/context-check | Optional (path + search) | URL search business_id or cookie | getAccountingAuthority when businessId present | Yes |
| GET /api/accounting/firm/engagements/effective | No | N/A | getEffectiveBusinessIdsForFirmUser | Yes |
| GET /api/accounting/firm/clients | No | N/A (firm from auth) | Firm membership | Yes |
| GET /api/accounting/journals/drafts | Yes | Query client_business_id (required) | checkFirmOnboardingForAction + getActiveEngagement (no engine) | Yes (param) |
| GET/POST /api/accounting/journals/drafts/[id] | No (id in path; draft has client_business_id) | From draft row | checkFirmOnboardingForAction + getActiveEngagement + resolveAuthority | Implicit client |
| GET /api/accounting/drafts | Yes | Query firm_id + client_business_id | getActiveEngagement + resolveAuthority | Yes (param) |
| GET /api/accounting/periods | Yes (query) | Query business_id | can_accountant_access_business (RPC) | Yes |
| POST /api/accounting/periods/close | Yes (body) | Body business_id | can_accountant_access_business + is_user_accountant_write + onboarding + getActiveEngagement + resolveAuthority | MIXED |
| GET /api/accounting/periods/readiness | Yes (query) | Query business_id, period_start | checkFirmOnboardingForAction + can_accountant_access_business | Yes |
| GET /api/accounting/periods/audit-readiness | Yes (businessId, periodId) | Query | can_accountant_access_business | Yes |
| GET /api/accounting/periods/resolve | Yes (query) | Query business_id | checkAccountingAuthority | Yes |
| POST /api/accounting/periods/reopen | Yes (body) | Body | checkFirmOnboardingForAction + getActiveEngagement + resolveAuthority | MIXED |
| GET /api/accounting/opening-balances | Yes (query) | Query business_id | checkAccountingAuthority + later onboarding/engagement | Yes |
| GET /api/accounting/opening-balances/[id] | No (id in path) | From import row client_business_id | checkFirmOnboardingForAction + getActiveEngagement | Implicit client |
| POST /api/accounting/opening-balances (create) | Yes (body) | Body | onboarding + getActiveEngagement (effective) | Yes |
| POST /api/accounting/opening-balances/[id]/approve | No (id in path) | From import | onboarding + getActiveEngagement + partner | Implicit |
| POST /api/accounting/opening-balances/[id]/post | No (id in path) | From import | onboarding + getActiveEngagement | Implicit |
| GET /api/accounting/coa | Yes (query) | Query business_id | checkAccountingAuthority | Yes |
| GET /api/accounting/trial-balance | Yes (query) | Query business_id | can_accountant_access_business (RPC) | Yes |
| GET /api/accounting/reports/* (all report + export routes) | Yes (query) | Query business_id | checkAccountingAuthority | Yes |
| GET /api/accounting/reconciliation/mismatches | Yes (businessId) | Query businessId | checkAccountingAuthority | Yes |
| GET /api/accounting/reconciliation/pending-approvals | Yes (businessId) | Query | checkAccountingAuthority | Yes |
| GET /api/accounting/reconciliation/policy | Yes (businessId) | Query | checkAccountingAuthority | Yes |
| GET /api/accounting/reconciliation/resolution-history | Yes (businessId) | Query | checkAccountingAuthority | Yes |
| GET /api/accounting/reconciliation/[scopeType]/[id] | Yes (businessId) | Query | (recon engine) | Yes |
| POST /api/accounting/reconciliation/resolve | Yes (body) | Body businessId | checkAccountingAuthority | Yes |
| GET /api/accounting/adjustments | Yes (query) | Query business_id | checkAccountingAuthority | Yes |
| POST /api/accounting/adjustments/apply | Yes (body) | Body business_id | checkAccountingAuthority | Yes |
| GET /api/accounting/carry-forward | Yes (query) | Query business_id | checkAccountingAuthority | Yes |
| POST /api/accounting/carry-forward/apply | Yes (body) | Body business_id | checkAccountingAuthority | Yes |
| GET /api/accounting/audit | Yes (businessId/business_id) | Query | checkAccountingAuthority | Yes |
| GET /api/accounting/afs/runs | Yes (query business_id) | Query | checkAccountingAuthority | Yes |
| GET /api/accounting/afs/runs/[id], exports, documents | Yes (query) | Query business_id | checkAccountingAuthority | Yes |
| POST /api/accounting/afs/[run_id]/finalize | Yes (body business_id) | Body | checkAccountingAuthority | Yes |
| GET /api/ledger/list | Yes or fallback | Query business_id / businessId OR getCurrentBusiness() | checkAccountingAuthority | MIXED (fallback = owner) |
| POST /api/accounting/opening-balances/apply | Yes (body) | Body business_id | checkAccountingAuthority | Yes |
| GET/POST /api/accounting/reversal, reversal/status | Yes (query) | Query business_id | checkAccountingAuthority | Yes |

---

## STEP 4 — Legacy / Client Workspace Dependencies Flagged

**Pages that require service workspace or owner context (getCurrentBusiness or session-only):**

- **/reports/profit-loss** — Uses getCurrentBusiness(); assumes owner. Does not accept business_id from URL for accountant.
- **/reports/balance-sheet** — Same.
- **/dashboard** — Uses getCurrentBusiness(); reconciliation banner uses business from owner context.
- **/service/health** — Uses service business context (not necessarily getCurrentBusiness; may be selected client). Calls accounting APIs with that business_id.
- **/service/reports/profit-and-loss**, **/service/reports/trial-balance** — Service workspace; business from service context.

**Pages that rely on session/cookie-only client (no URL business_id):**

- **/accounting/journals** — getActiveClientBusinessId() + checkClientContext(); no URL business_id in resolution order on page (context gate can set from URL elsewhere).
- **/accounting/journals/new**, **/accounting/journals/drafts/[id]**, **edit**, **review**, **drafts/new** — getActiveClientBusinessId(); session/cookie client.
- **/accounting/opening-balances-imports** (list, new, [id], [id]/edit) — getActiveFirmId() + getActiveClientBusinessId(); session/cookie.
- **/accounting/drafts** — Same; API requires firm_id + client_business_id from query (page passes from session).

**APIs that use RPC or onboarding+engagement instead of accounting authority engine:**

- **can_accountant_access_business (RPC):** used by GET /api/accounting/periods, GET /api/accounting/trial-balance, GET /api/accounting/periods/readiness, GET /api/accounting/periods/audit-readiness, POST /api/accounting/periods/close (plus onboarding + resolveAuthority).
- **checkFirmOnboardingForAction + getActiveEngagement + resolveAuthority:** used by journals/drafts (list, [id], post), opening-balances (create, [id], approve, post), periods/close, periods/reopen, periods/readiness.

**APIs that do NOT accept business_id (entity-id only; client from row):**

- **GET /api/accounting/journals/drafts/[id]** — No business_id param; derives client from draft.client_business_id. Page must have selected client for context gate; drill from Control Tower with ?business_id= works via context-check.
- **GET /api/accounting/opening-balances/[id]** — Same; client from import row.

**API that falls back to getCurrentBusiness:**

- **GET /api/ledger/list** — If business_id/businessId missing, uses getCurrentBusiness(supabase, user.id). Breaks pure accountant multi-client if caller does not pass business_id.

---

## STEP 5 — Route Status Table

| Route | Context Source | Authority Source | Status |
|-------|----------------|------------------|--------|
| /accounting | Firm session (getActiveFirmId) | N/A (onboarding only) | MIXED |
| /accounting/control-tower | None | Engine (work-items) | CANONICAL |
| /accounting/control-tower/[businessId] | URL param | Engine (client-summary) | CANONICAL |
| /accounting/opening-balances | URL → session → getCurrentBusiness | APIs use checkAccountingAuthority | CANONICAL (resolver) |
| /accounting/opening-balances-imports | Session (firm + client cookie) | APIs use onboarding + engagement | LEGACY |
| /accounting/opening-balances-imports/new | Session | Same | LEGACY |
| /accounting/opening-balances-imports/[id] | Session | Same | LEGACY |
| /accounting/opening-balances-imports/[id]/edit | Session | Same | LEGACY |
| /accounting/journals | Session (getActiveClientBusinessId) | onboarding + engagement on API | LEGACY |
| /accounting/journals/new | Session | Same | LEGACY |
| /accounting/journals/drafts/[id] | Session | Same | LEGACY |
| /accounting/journals/drafts/[id]/edit | Session | Same | LEGACY |
| /accounting/journals/drafts/[id]/review | Session | Same | LEGACY |
| /accounting/journals/drafts/new | Session | Same | LEGACY |
| /accounting/drafts | Session (firm_id + client_business_id) | getActiveEngagement + resolveAuthority | LEGACY |
| /accounting/ledger | URL → session → getCurrentBusiness | checkAccountingAuthority; ledger list fallback | MIXED |
| /accounting/chart-of-accounts | Resolver | checkAccountingAuthority | CANONICAL |
| /accounting/reconciliation | Resolver | checkAccountingAuthority | CANONICAL |
| /accounting/periods | Resolver | can_accountant_access_business RPC | MIXED |
| /accounting/trial-balance | Resolver | can_accountant_access_business RPC | MIXED |
| /accounting/reports/balance-sheet | Resolver | checkAccountingAuthority | CANONICAL |
| /accounting/reports/profit-and-loss | Resolver | checkAccountingAuthority | CANONICAL |
| /accounting/reports/general-ledger | Resolver | checkAccountingAuthority | CANONICAL |
| /accounting/reports/trial-balance | Resolver | checkAccountingAuthority | CANONICAL |
| /accounting/adjustments | Resolver | checkAccountingAuthority | CANONICAL |
| /accounting/adjustments/review | Resolver | checkAccountingAuthority | CANONICAL |
| /accounting/carry-forward | Resolver | checkAccountingAuthority | CANONICAL |
| /accounting/audit | Resolver | checkAccountingAuthority | CANONICAL |
| /accounting/health | Resolver | (varies) | CANONICAL |
| /accounting/exceptions | Resolver | (APIs commented out) | CANONICAL |
| /accounting/afs | Resolver | checkAccountingAuthority | CANONICAL |
| /accounting/firm | Firm session | N/A | MIXED |
| /accounting/firm/onboarding | Firm session | N/A | MIXED |
| /accounting/firm/setup | — | — | MIXED |
| /accounting/firm/clients/add | Firm session | N/A | MIXED |
| /accounting/firm/ops | — | — | MIXED |
| /accounting/firm/authority | — | — | MIXED |
| /portal/accounting | Resolver | checkAccountingAuthority (via APIs) | CANONICAL |
| /firm/accounting-clients | Firm session | Firm clients API | MIXED |
| /admin/accounting/forensic-runs | (admin) | (admin) | — |
| /admin/accounting/tenants | (admin) | (admin) | — |
| /reports/profit-loss | getCurrentBusiness | checkAccountingAuthority on API | LEGACY |
| /reports/balance-sheet | getCurrentBusiness | Same | LEGACY |
| /service/health | Service context | APIs use checkAccountingAuthority | MIXED |
| /service/reports/profit-and-loss | Service context | Same | MIXED |
| /service/reports/trial-balance | Service context | Same | MIXED |

---

## STEP 6 — Migration Impact Estimate

### LEGACY routes

**1. /accounting/opening-balances-imports (list, new, [id], [id]/edit)**  
- **Why it breaks accountant workspace:** Depends on getActiveFirmId() + getActiveClientBusinessId() from session/cookie. No URL business_id; direct link from Control Tower or bookmarked URL without selected client shows wrong or empty context.  
- **Recommendation:** **A) Convert to canonical.** Resolve client from URL first (e.g. query business_id or path), then session. Use same resolver as other accounting pages; ensure all APIs called accept business_id (they do).  

**2. /accounting/journals (and journals/new, drafts/[id], edit, review, drafts/new)**  
- **Why it breaks:** Same as above; getActiveClientBusinessId() and checkClientContext() only. No business_id in URL for deep links or multi-tab.  
- **Recommendation:** **A) Convert to canonical.** Use resolveAccountingBusinessContext (URL → session → getCurrentBusiness) for businessId; pass business_id in all API calls (journals/drafts already takes client_business_id; draft [id] derives from draft so drill with ?business_id= is sufficient for context gate).  

**3. /accounting/drafts**  
- **Why it breaks:** Uses session firm_id + client_business_id; API /api/accounting/drafts requires firm_id and client_business_id in query. Page does not read business_id from URL.  
- **Recommendation:** **A) Convert to canonical.** Resolve business_id from URL (or path) first; pass firm_id + client_business_id to API (firm_id can be derived from engagement or context-check). Alternatively **C) Rewrite** to use /api/accounting/journals/drafts with client_business_id + period_id and drop /api/accounting/drafts if redundant.  

**4. /reports/profit-loss and /reports/balance-sheet**  
- **Why it breaks:** getCurrentBusiness() only; assumes single-owner context. Accountant with multiple clients cannot use these routes for a chosen client.  
- **Recommendation:** **A) Convert to canonical.** Add URL business_id support and use resolveAccountingBusinessContext (or equivalent) so owner and accountant both work; accountant passes business_id from client selection or drill link.  

---

### MIXED routes

**5. /accounting**  
- **Why mixed:** Only checks firm onboarding (getActiveFirmId); no client. Fine for hub; links to client-scoped pages assume session client.  
- **Recommendation:** Leave as-is or ensure all linked flows support URL business_id.  

**6. /accounting/ledger**  
- **Why mixed:** Page uses resolveAccountingBusinessContext (canonical). API /api/ledger/list accepts business_id but falls back to getCurrentBusiness() when missing. If page always passes business_id, behavior is canonical.  
- **Recommendation:** **A) Harden API.** Remove getCurrentBusiness() fallback in /api/ledger/list; require business_id so authority is always explicit. Page already passes business_id when resolver returns one.  

**7. /accounting/periods**  
- **Why mixed:** Page uses resolver (canonical). API uses can_accountant_access_business RPC instead of getAccountingAuthority. RPC may duplicate logic and can diverge from engine.  
- **Recommendation:** **A) Convert API to canonical.** Replace can_accountant_access_business with checkAccountingAuthority (or getAccountingAuthority) in GET /api/accounting/periods so authority is single-sourced.  

**8. /accounting/trial-balance**  
- **Why mixed:** Same as periods; resolver on page, RPC on API.  
- **Recommendation:** **A) Convert API.** Use checkAccountingAuthority in GET /api/accounting/trial-balance.  

**9. /accounting/periods/close (and reopen, readiness)**  
- **Why mixed:** periods/close uses can_accountant_access_business + is_user_accountant_write + onboarding + getActiveEngagement + resolveAuthority. Multiple authority sources; not single engine.  
- **Recommendation:** **A) Convert to canonical.** Use getAccountingAuthority (or checkAccountingAuthority) for read/write and firm role for close_period; align with control-tower and context-check.  

**10. /accounting/firm, onboarding, setup, clients/add, ops, authority**  
- **Why mixed:** Firm-scoped; no business_id. Rely on firm session. Acceptable for firm admin; ensure they do not assume owner context.  
- **Recommendation:** No change for firm-only routes; document that they are firm-scoped.  

**11. /firm/accounting-clients**  
- **Why mixed:** Client picker; getActiveFirmId(); then redirects to /accounting/* with business_id. Fits canonical flow.  
- **Recommendation:** Keep; ensure redirect URLs always include business_id.  

**12. /service/health and /service/reports/* **  
- **Why mixed:** Service workspace; business from service context (selected client or owner). APIs receive business_id and use checkAccountingAuthority.  
- **Recommendation:** Document as service workspace; ensure service context sets business_id consistently. No change unless service workspace is deprecated.  

---

## Summary

- **CANONICAL:** Control Tower, resolver-based accounting pages (ledger, reconciliation, reports, coa, adjustments, carry-forward, audit, health, afs, portal/accounting), and APIs that take business_id and use checkAccountingAuthority or getAccountingAuthority only.  
- **LEGACY:** Session-only accounting pages (opening-balances-imports, journals, drafts) and owner-only report pages (/reports/profit-loss, /reports/balance-sheet).  
- **MIXED:** /accounting hub, ledger (API fallback), periods/trial-balance (RPC authority), period close/reopen/readiness (RPC + onboarding + resolveAuthority), firm and service routes.  

**Authority consolidation:** Prefer replacing can_accountant_access_business and onboarding+getActiveEngagement+resolveAuthority with getAccountingAuthority/checkAccountingAuthority for business-scoped accounting APIs so accountant multi-client and determinism are single-sourced.
