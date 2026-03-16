# PHASE 5 — Accounting UI Context Normalization Audit (Mechanical)

**Audit type:** Principal frontend systems + product context auditor  
**Mode:** Evidence only. No fixes, no refactors, no suggestions, no UX opinions  
**Date:** 2025-01-31  
**Inputs:** Phase 2 — Canonical Authority & Context Model (LOCKED); Phase 4 — Canonical Authorization Unification (COMPLETED); Accounting-First UI routes under `/accounting/**`; shared UI helpers (`getCurrentBusiness`, `getActiveClientBusinessId`, URL params, sessionStorage).

---

## PART 1 — CONTEXT RESOLUTION INVENTORY

**Scope:** All Accounting-First UI pages under `/accounting`, `/accounting/reports/*`, `/accounting/periods`, `/accounting/reconciliation/*`, `/accounting/adjustments`, `/accounting/carry-forward`, `/accounting/coa` (chart-of-accounts), `/accounting/opening-balances*`, `/accounting/afs/*`, `/accounting/ledger`, `/accounting/trial-balance`, `/accounting/exceptions`, `/accounting/journals/*`, `/accounting/drafts`, `/accounting/opening-balances-imports*`, `/portal/accounting`. Excluded: `/accounting/firm/*`.

| Page | Route | Context source(s) used | Order of precedence | Violates contract? |
|------|--------|------------------------|----------------------|--------------------|
| Accounting hub | /accounting | None (menu only; no business_id) | N/A | N/A (no business context required) |
| Periods | /accounting/periods | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| Reconciliation | /accounting/reconciliation | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| Trial Balance (reports) | /accounting/reports/trial-balance | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| Balance Sheet | /accounting/reports/balance-sheet | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| Profit & Loss | /accounting/reports/profit-and-loss | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| General Ledger (reports) | /accounting/reports/general-ledger | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| Ledger (journal list) | /accounting/ledger | None (page does not resolve or pass business_id) | N/A — API called without business_id | Yes |
| Chart of Accounts | /accounting/chart-of-accounts | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| Adjustments | /accounting/adjustments | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| Adjustments Review | /accounting/adjustments/review | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| Carry-Forward | /accounting/carry-forward | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| Opening Balances | /accounting/opening-balances | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| AFS Review | /accounting/afs | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| Trial Balance (standalone) | /accounting/trial-balance | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| Exceptions | /accounting/exceptions | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |
| Opening Balance Imports list | /accounting/opening-balances-imports | getActiveFirmId(), getActiveClientBusinessId() | Firm + client from session; both required | No |
| Opening Balance Import new | /accounting/opening-balances-imports/new | getActiveFirmId(), getActiveClientBusinessId() | Same | No |
| Opening Balance Import [id] | /accounting/opening-balances-imports/[id] | getActiveFirmId(), getActiveClientBusinessId() | Same | No |
| Opening Balance Import [id] edit | /accounting/opening-balances-imports/[id]/edit | (same pattern; firm + client) | Same | No |
| Drafts list | /accounting/drafts | getActiveFirmId(), getActiveClientBusinessId() | Firm + client from session; both required | No |
| Journals (drafts list) | /accounting/journals | checkClientContext() → getActiveClientBusinessId(); firm via checkFirmOnboardingForAction | Client from session first; then firm | No |
| Journal draft [id] | /accounting/journals/drafts/[id] | checkClientContext(), getActiveClientBusinessId(), firm onboarding | Same | No |
| Journal draft new/edit/review | /accounting/journals/drafts/new, [id]/edit, [id]/review | (same pattern; client + firm) | Same | No |
| Portal Accounting | /portal/accounting | getCurrentBusiness(supabase, user.id) | Single: ownership/assignment fallback | Yes |

---

## PART 2 — PAGE-LEVEL ANALYSIS

### 2.1 Context acquisition

- **Pages using getCurrentBusiness only (periods, reconciliation, all four report pages, chart-of-accounts, adjustments, adjustments/review, carry-forward, opening-balances, afs, trial-balance, exceptions, portal/accounting):**  
  `business_id` is first resolved in a `loadBusiness` (or equivalent) function that: (1) gets the authenticated user, (2) calls `getCurrentBusiness(supabase, user.id)`. Resolution is async. It is derived only from ownership/assignment: `getCurrentBusiness` returns the first business where the user is `owner_id` or has a row in `business_users`. There is no consumption of URL `business_id`, no `getActiveClientBusinessId()`, and no explicit client selection.

- **Ledger page:**  
  `business_id` is never resolved or passed. The page calls `/api/ledger/list` with only filter params (start_date, end_date, account_code, reference_type, page, page_size). The API itself uses `getCurrentBusiness(supabase, user.id)` server-side to obtain `business.id`. So context is implicit and entirely server-side for this page.

- **Opening-balances-imports (list, new, [id], [id]/edit):**  
  Context is `getActiveFirmId()` and `getActiveClientBusinessId()` from sessionStorage. Resolution is synchronous (client-side). It is derived from explicit client selection (active client session). If either firm or client is missing, the page sets error "Please select a firm and client first" and does not call accounting APIs.

- **Drafts list:**  
  Same as opening-balances-imports: firm + client from session; both required; "Please select a firm and client first" if missing.

- **Journals (and journals/drafts/*):**  
  Context is obtained via `checkClientContext(true)`, which uses `getActiveClientBusinessId()`. Firm context is obtained via `checkFirmOnboardingForAction` and `getActiveEngagement`. Resolution is async for firm, synchronous for client Id. Client is from explicit client selection. If client or firm/engagement is missing, the page shows a blocked state ("An active engagement is required..." or "Firm onboarding required...").

### 2.2 Firm-user behaviour

- **Pages using only getCurrentBusiness:**  
  For a firm-only user (no owned business, no business_users row), `getCurrentBusiness` returns null. The page then sets error to "Business not found" and does not load data. The page loads with an error state; there is no "select a client" flow. So: firm-only user with no active client → "Business not found". Firm-only user with active client selected in session → active client is ignored; still "Business not found" (SESSION IGNORE).

- **Ledger page:**  
  The page does not read session or URL for business. The API `/api/ledger/list` uses `getCurrentBusiness`. So firm-only user gets 404 "Business not found" from the API; the page has no explicit handling and relies on API response.

- **Opening-balances-imports, drafts, journals/drafts:**  
  If the user has no firm or no active client, the page shows "Please select a firm and client first" or a blocked state. So: firm-only user with active client → page works. Firm-only user with NO active client → blocked / "select a firm and client first". No reliance on getCurrentBusiness.

### 2.3 Owner / dual-role user behaviour

- **Pages using only getCurrentBusiness:**  
  There is no branch that checks "explicit client selection" first. So an owner who is also a firm user with an active client selected always gets context from getCurrentBusiness (their owned or assigned business). Explicit client selection (active client in session) is never consulted. So when both exist, ownership/assignment wins — contract violation (explicit client should win).

- **Opening-balances-imports, drafts, journals:**  
  These pages do not use getCurrentBusiness. They use only firm + active client. So an owner who is on these pages is treated as a firm user; they must have a firm and active client. There is no "owner path" that uses getCurrentBusiness. Context used is always explicit client (and firm).

### 2.4 API call consistency

- **Pages using getCurrentBusiness:**  
  Once `businessId` is set from getCurrentBusiness, all observed API calls pass `business_id` (or `businessId`) in query or body (e.g. `/api/accounting/periods?business_id=...`, `/api/accounting/reports/trial-balance?business_id=...`, etc.). So for these pages, business_id is always explicit in API calls once context is resolved.

- **Ledger page:**  
  The page never passes business_id to any API. It calls `/api/ledger/list` with only filter and pagination params. So the page relies on the API to infer business_id (the API uses getCurrentBusiness). This is implicit API dependence from the UI perspective.

- **Opening-balances-imports, drafts, journals:**  
  API calls use `clientBusinessId` (or equivalent) from context in the request (e.g. `?business_id=${clientBusinessId}` or body with client_business_id). business_id is always explicit in API calls.

---

## PART 3 — CONTRACT VIOLATION TYPES

| Page(s) | Violation type | Evidence |
|---------|----------------|----------|
| /accounting/periods, /accounting/reconciliation, /accounting/reports/* (4), /accounting/chart-of-accounts, /accounting/adjustments, /accounting/adjustments/review, /accounting/carry-forward, /accounting/opening-balances, /accounting/afs, /accounting/trial-balance, /accounting/exceptions, /portal/accounting | **FIRM NULL CONTEXT** | Firm-only user has no business_id; getCurrentBusiness returns null → "Business not found". Contract: firm-only users must not rely on getCurrentBusiness; they must select a client. |
| Same pages | **OWNERSHIP LEAK** | When user is both owner and firm user with active client, page uses getCurrentBusiness only; explicit client selection (active client) is never read. Contract: when both exist, explicit client selection wins. |
| Same pages | **SESSION IGNORE** | Active client (getActiveClientBusinessId) exists in session but is not consumed; only getCurrentBusiness is used. |
| /accounting/ledger | **IMPLICIT API DEPENDENCE** | Page does not resolve or pass business_id; calls /api/ledger/list without business_id; API infers business server-side. Contract: UI must resolve business_id from explicit source and APIs use only business_id supplied in the request. |
| None in scope | CONTEXT AMBIGUITY | No page was found with multiple sources and no deterministic priority. |
| None in scope | URL IGNORE | No accounting-first page was found that reads business_id from URL. |

---

## PART 4 — GLOBAL CONSISTENCY CHECK

1. **Do all Accounting-First pages follow the same context resolution order?**  
   **No.** Two distinct patterns exist: (a) Ownership-only: many pages use only getCurrentBusiness with no explicit client or URL. (b) Firm+client-only: opening-balances-imports, drafts, journals use getActiveFirmId + getActiveClientBusinessId (or checkClientContext) and do not use getCurrentBusiness. No page implements the contract order "explicit client (URL or active client) first; then ownership/assignment fallback".

2. **Do any pages still treat Accounting-First like "owner accounting"?**  
   **Yes.** All pages that use getCurrentBusiness only (periods, reconciliation, all four report pages, chart-of-accounts, adjustments, adjustments/review, carry-forward, opening-balances, afs, trial-balance, exceptions, portal/accounting) treat context as "current business" from ownership or business_users. They never check explicit client selection. This matches an "owner accounting" or "single business" model, not "Accounting-First with explicit client or ownership fallback".

3. **Are there pages where context logic differs only slightly (risk of regression)?**  
   **Yes.** The "getCurrentBusiness only" pages share nearly identical loadBusiness logic (get user → getCurrentBusiness → setBusinessId or set error). Small copy-paste differences exist (e.g. some also load getUserRole or isUserAccountantReadonly). The firm+client pages (opening-balances-imports, drafts, journals) share a similar pattern (firm + client required; block if missing). So two clusters with internal similarity; cross-cluster behaviour is inconsistent with the contract.

4. **Are there pages where context is resolved twice in conflicting ways?**  
   **No.** No single page was found that resolves context from two different sources and then uses them in a conflicting way. Each page uses one pattern or the other.

---

## PART 5 — GAP MATRIX

| Intended (Phase 2) | Actual UI behaviour | Page(s) |
|--------------------|---------------------|--------|
| Explicit client wins over ownership | Ownership/assignment only; explicit client never read | periods, reconciliation, reports/* (4), chart-of-accounts, adjustments, adjustments/review, carry-forward, opening-balances, afs, trial-balance, exceptions, portal/accounting |
| Firm-only users must select client | Firm-only user gets "Business not found"; no select-a-client flow on these pages | Same as above |
| business_id always explicit in API calls | business_id not passed by ledger page; API infers it | /accounting/ledger |
| Accounting-First never assumes ownership | Many pages assume "current business" from getCurrentBusiness only | Same ownership-only list as first row |
| Explicit client (or ownership fallback) | Firm+client pages: explicit client only, block if missing. No ownership fallback on those pages. | opening-balances-imports, drafts, journals/* |

---

## PART 6 — ALIGNMENT SCORE

- **Pages in scope (excluding hub):** 26 (periods, reconciliation, 4 report pages, ledger, chart-of-accounts, adjustments, adjustments/review, carry-forward, opening-balances, afs, trial-balance, exceptions, opening-balances-imports list/new/[id]/[id]/edit, drafts, journals, journals/drafts [id]/new/edit/review, portal/accounting). Hub excluded (no business context).
- **Compliant with Phase 2 context contract:** 6 (opening-balances-imports list, new, [id], [id]/edit; drafts; journals and journals/drafts/* — firm+client only, explicit client, block if missing). These do not implement "explicit client then ownership fallback" (they have no owner path) but they do: (1) use explicit client selection, (2) not rely on getCurrentBusiness for firm users, (3) pass business_id explicitly in API calls.
- **Non-compliant:** 20 (all getCurrentBusiness-only pages + ledger).
- **Compliance rate:** 6 / 26 ≈ **23%** (if hub excluded); 6 / 27 ≈ 22% (if hub included as N/A).
- **Severity:** High. Violations are systemic: the majority of Accounting-First pages use only ownership/assignment context, ignore explicit client selection, and block firm-only users without a "select client" flow. One page (ledger) does not pass business_id to the API at all.
- **Alignment score: 23%** — justified by: low proportion of compliant pages, systemic use of getCurrentBusiness without explicit client precedence, and one page with implicit API dependence.

---

## DELIVERABLES

1. **Page-by-page context resolution table** — Part 1.
2. **Violation classification per page** — Part 3.
3. **Global consistency verdict** — Part 4: context resolution is not consistent; two patterns (ownership-only vs firm+client-only); no page implements full contract (explicit client first, then ownership fallback).
4. **Alignment score** — Part 6: 23%.
5. **Single-sentence verdict:**

> Accounting-First UI context resolution is **inconsistent** with the Phase 2 Canonical Context Contract because the majority of pages resolve business_id only via getCurrentBusiness (ownership/assignment), never consult explicit client selection (URL or active client), block firm-only users with "Business not found" instead of a select-client flow, and one page (ledger) does not pass business_id to the API at all; only the firm-only pages (opening-balances-imports, drafts, journals) use explicit client context and pass business_id in API calls.

---

**End of Phase 5. Mechanical audit only. No fixes authorized.**
