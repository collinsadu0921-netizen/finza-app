# FINZA ENGAGEMENT & INVITATION SYSTEM — FORENSIC AUDIT

**Mode:** Evidence only  
**Scope:** Authority, visibility, RLS, session, and workspace interactions  
**Objective:** Determine whether the current system structurally guarantees accountant access after acceptance.

---

## 1. TRUE AUTHORITY SOURCES (ACTUAL, NOT INTENDED)

### 1.1 Engagement table

**Table:** `firm_client_engagements`  
**Definition:** `supabase/migrations/146_firm_client_engagements_step8_8_batch2.sql` (lines 12–31).

**Columns (evidence):**

- `accounting_firm_id` (UUID, FK to `accounting_firms`)
- `client_business_id` (UUID, FK to `businesses`)
- `status` (TEXT; after 279: `pending | accepted | active | suspended | terminated`)
- `access_level` (TEXT: `read | write | approve`)
- `effective_from` (DATE), `effective_to` (DATE)
- `accepted_at` (TIMESTAMPTZ), `accepted_by` (UUID ref auth.users)

**Lifecycle:** Migration 279 adds `accepted`; accept flow sets `status = 'accepted'`, `accepted_at`, `accepted_by`. Trigger blocks `pending → active`; only `pending → accepted` allowed from client.

---

### 1.2 Accounting authority checks — where they appear

#### A. RLS — firm_client_engagements SELECT

**Policies:** `supabase/migrations/146_firm_client_engagements_step8_8_batch2.sql` (lines 173–194).

- **Firm users can view their firm engagements**  
  `USING (EXISTS (SELECT 1 FROM accounting_firm_users WHERE accounting_firm_users.firm_id = firm_client_engagements.accounting_firm_id AND accounting_firm_users.user_id = auth.uid()))`  
  No status or effective-date filter: firm users see all engagements for their firm (pending, accepted, active, etc.).

- **Business owners can view their business engagements**  
  `USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = firm_client_engagements.client_business_id AND businesses.owner_id = auth.uid()))`  
  Authority requires: business row exists with that `client_business_id` and `businesses.owner_id = auth.uid()`.

**Conclusion:** Owner authority is **business-owned** (businesses.id + owner_id). Firm authority is **firm membership** (accounting_firm_users). No single-source; both are derived (businesses table and accounting_firm_users table).

---

#### B. RLS — firm_client_engagements UPDATE

**Policies:** `supabase/migrations/277_add_update_policy_firm_client_engagements.sql`.

- **Firm users can update their firm engagements**  
  USING/WITH CHECK: EXISTS on `accounting_firm_users` with `firm_id`, `user_id = auth.uid()`, `role IN ('partner','senior')`.

- **Business owners can update their business engagements**  
  USING/WITH CHECK: EXISTS on `businesses` where `businesses.id = firm_client_engagements.client_business_id` and `businesses.owner_id = auth.uid()`.

**Conclusion:** Same predicates as SELECT conceptually: owner via businesses.owner_id; firm via accounting_firm_users. Multi-hop (engagements → businesses / accounting_firm_users).

---

#### C. Businesses RLS (firm visibility)

**Policy:** Firm users can select engaged client businesses.

**Current definition:** `supabase/migrations/284_fix_businesses_rls_recursion_firm_engagement_policy.sql`.

- **Helper (SECURITY DEFINER):** `has_firm_engagement_with_business(_business_id uuid)`  
  Returns `EXISTS (SELECT 1 FROM public.firm_client_engagements fce JOIN public.accounting_firm_users afu ON afu.firm_id = fce.accounting_firm_id AND afu.user_id = auth.uid() WHERE fce.client_business_id = _business_id)`.

- **Policy:** `USING (public.has_firm_engagement_with_business(businesses.id))`.

**Evidence:** No filter on `fce.status` or effective_from/effective_to in the helper. Any engagement row (including `pending`) for that firm–client pair makes the business row visible to that firm user for SELECT.

**Conclusion:** Authority for “firm sees business” is **multi-hop**: `accounting_firm_users` → `firm_client_engagements` → `businesses.id`. Not single-source. Engagement status/effective dates are **not** enforced in this RLS policy.

---

### Evidence conclusion (Section 1)

Authority is **multi-hop derived**:

```
accounting_firm_users (firm membership)
  → firm_client_engagements (engagement row)
    → businesses (owner_id for owner path; client_business_id for firm path)
      → accounting tables (journal_entries, etc. via further RLS)
```

There is **no single authoritative table**. Owner path depends on `businesses.owner_id`; firm path on `accounting_firm_users` + `firm_client_engagements` (+ optionally effective logic in application/RPCs, not in businesses RLS).

---

## 2. INVITATION VISIBILITY PATH

### Invitations GET route

**Route:** `GET /api/service/invitations`  
**File:** `app/api/service/invitations/route.ts`.

**Flow (evidence):**

1. `supabase.auth.getUser()` → user.
2. `resolveServiceBusinessContext(supabase, user.id)` → `ctx`.  
   **Resolver:** `lib/serviceBusinessContext.ts`: `getCurrentBusiness(supabase, userId)`; then require `business.owner_id != null`; return `{ businessId: business.id }` or `{ error: "NO_CONTEXT" }`.
3. If `"error" in ctx` → return 200 with empty pending/active (no 403).
4. `businessId = ctx.businessId`.
5. `supabase.from("firm_client_engagements").select(...).eq("client_business_id", businessId)` — no status filter in query; RLS filters rows (owner sees engagements for their business per 146).
6. Second query: firms by `accounting_firm_id` from those engagements.
7. In-memory split: `pending` = `row.status === "pending"`; `active` = `isEffective(row.status, row.effective_from, row.effective_to)` where `isEffective` is local (status in `accepted`|`active`, today within from/to).

**RLS required:** For the engagement SELECT to return rows, the **business owner** policy must pass: `businesses.id = client_business_id` and `businesses.owner_id = auth.uid()`. So invitations depend on **resolver output (businessId)** plus **RLS on firm_client_engagements** (owner policy). Resolver itself uses `getCurrentBusiness` (businesses + business_users), not engagements.

**Conclusion:** Invitations depend on **resolver output (owner’s current business)** + **engagement table SELECT under RLS**. If resolver returns NO_CONTEXT (no business or unclaimed business), invitations are empty without a 403.

---

## 3. ACCEPT FLOW AUTHORITY PATH

### Service PATCH route

**Route:** `PATCH /api/service/engagements/[id]`  
**File:** `app/api/service/engagements/[id]/route.ts`.

**Flow (evidence):**

1. Auth: `supabase.auth.getUser()`; 401 if no user.
2. Body: `action` in `{ accept, reject }`; 400 otherwise.
3. **SELECT engagement by id only:**  
   `supabase.from("firm_client_engagements").select("*").eq("id", engagementId).maybeSingle()`.  
   If no row or error → 404 “Engagement not found”. RLS applies: owner sees engagements for their business; firm sees their firm’s engagements. So if the row is pending and belongs to another owner’s business, the requester would not see it and get 404.
4. **Ownership check:**  
   `supabase.from("businesses").select("owner_id").eq("id", engagement.client_business_id).maybeSingle()`.  
   If `business?.owner_id !== user.id` → 403 “Only business owners can accept or reject engagements”.
5. Status check: must be `pending`; else 400 (only pending can be accepted/rejected).
6. **UPDATE** `firm_client_engagements` set status, accepted_at, accepted_by (accept) or status = terminated (reject).

**Conclusion:** Accept logic **does not use the invitations resolver**. It uses engagement row by id (RLS) then **explicit businesses.owner_id check**. So authority for accept is: (1) RLS so user can see the engagement row, (2) `businesses.owner_id = user.id` for that `client_business_id`. This matches the audit’s “Confirm owner_id = user.id via businesses table, not resolver.”

---

## 4. ACCOUNTING WORKSPACE AUTHORITY

### Client selection and context

Accounting workspace does **not** use the invitations API. It uses:

- **Context gate:** `components/AccountingClientContextGate.tsx` calls `GET /api/accounting/firm/context-check` with path and search params. Response can set `autoSelect` or `redirectTo` and can call `setActiveClientBusinessId(businessId, businessName)`.
- **Context check API:** `app/api/accounting/firm/context-check/route.ts` — uses `getActiveClientBusinessId()` (session/cookie), URL `business_id`, and fetches engagements from `firm_client_engagements` to determine `requiresClient`, `hasClient`, `businessId`, `autoSelect`, `redirectTo`.
- **Effective clients list:** `GET /api/accounting/firm/engagements/effective` (`app/api/accounting/firm/engagements/effective/route.ts`): selects from `firm_client_engagements` where `accounting_firm_id IN (user’s firms)`, `status IN ('accepted','active')`, `effective_from <= today`, and `effective_to` null or >= today; then loads `businesses.id, name` for those `client_business_id`s. RLS applies on both tables.
- **Resolver:** `lib/accountingBusinessContext.ts` — `resolveAccountingBusinessContext(supabase, userId, searchParams)`: (1) URL `business_id` / `businessId`, (2) `getActiveClientBusinessId()` (sessionStorage + cookie), (3) `getCurrentBusiness(supabase, userId)`. Returns `{ businessId, source: "client"|"owner" }` or `{ error: "NO_CONTEXT" }`.

**Conclusion:** Accounting visibility depends on: **firm membership** (accounting_firm_users), **engagement row** (firm_client_engagements), **effective logic** (status accepted/active + date range in effective route and in `get_active_engagement` / `isEngagementEffective` in lib), and **businesses RLS** (has_firm_engagement_with_business). Client selector and context gate rely on **session/client state** (`getActiveClientBusinessId`) and **effective** engagement list from the API.

---

## 5. EFFECTIVE DATE AUTHORITY LAYER

**Engagement columns:** `effective_from`, `effective_to` (both in table and in `get_active_engagement`).

**RPC:** `get_active_engagement(p_firm_id, p_business_id, p_check_date)` — `supabase/migrations/279_engagement_lifecycle_hardening.sql` (lines 141–172): returns rows where `status IN ('accepted','active')`, `effective_from <= p_check_date`, and `(effective_to IS NULL OR effective_to >= p_check_date)`.

**Application:** `lib/firmEngagements.ts` — `isEngagementEffective(engagement, checkDate)`: status in `accepted`|`active`; `effective_from <= checkDate`; `effective_to` null or >= checkDate. Used in `checkAccountingAuthority` (and elsewhere) so that **firm authority** requires not only an engagement row but **effective** engagement.

**Invitations route:** Local `isEffective(status, effectiveFrom, effectiveTo)` (invitations/route.ts) used only to split “active” vs “pending” in the response; it does not change which engagement rows are returned (that’s RLS).

**Conclusion:** Authority for **accounting access** (e.g. ledger, reports) requires **status accepted or active** and **date within effective_from / effective_to** in application code and in `get_active_engagement`. So “accepted” alone is **not** sufficient for access; effective dates are a **secondary authority condition**. Businesses RLS (has_firm_engagement_with_business) does **not** enforce status or dates — only existence of an engagement row.

---

## 6. RESOLVER DEPENDENCY LAYER

**Resolvers and usage (evidence):**

| Resolver | File | Used in |
|----------|------|---------|
| `resolveServiceBusinessContext` | `lib/serviceBusinessContext.ts` | `app/api/service/invitations/route.ts`; `app/service/*` pages (ledger, reports, health, expenses) |
| `resolveAccountingBusinessContext` | `lib/accountingBusinessContext.ts` | Accounting pages (ledger, reports, periods, reconciliation, chart-of-accounts, etc.) and portal |
| `getCurrentBusiness` | `lib/business.ts` | Both resolvers; invitations; many API routes |
| `getActiveClientBusinessId` | `lib/firmClientSession.ts` | `resolveAccountingBusinessContext`; accounting pages (drafts, opening balances, journals); ClientSelector; context gate |
| `getActiveEngagement` / `isEngagementEffective` | `lib/firmEngagements.ts` | `checkAccountingAuthority`; accounting API routes (periods close/reopen, opening balances, journals drafts, etc.) |

**Conclusion:** Authority in multiple flows depends on **resolver output** (service business, accounting business, active client). Different routes use different resolvers (service vs accounting vs session-only), so **resolver drift** (e.g. service resolver returning NO_CONTEXT while accounting uses URL/session) can cause inconsistent visibility.

---

## 7. SESSION / COOKIE AUTHORITY LAYER

**Supabase:** Server client uses `cookies()` → session → `auth.uid()` (standard Supabase server client).

**Active client (accounting):** `lib/firmClientSession.ts`:

- **Storage:** `sessionStorage` key `finza_active_client_business_id` (and name). Cookie `finza_active_client_business_id` (path=/, max-age=86400, samesite=lax) for server-side read.
- **Read:** `getActiveClientBusinessId()` — client-side reads sessionStorage; server-side would read cookie (same key exported as `ACTIVE_CLIENT_BUSINESS_ID_COOKIE`).
- **Write:** `setActiveClientBusinessId(businessId, businessName)` — set by AccountingClientContextGate (autoSelect from context-check), ClientSelector (user choice), and firm accounting-clients/add flow.

**Conclusion:** Accounting workspace **does** store “active client” in **sessionStorage and cookie**. So authority can differ between: (1) GET invitations (no client selector; uses service resolver only), (2) PATCH accept (no client selector; uses engagement + businesses.owner_id), (3) Accounting UI (client selector + context-check + resolver). Session/URL state is required for accounting pages to have a business_id when the user is a firm user.

---

## 8. RLS CROSS-TABLE DEPENDENCIES

**Businesses SELECT** (evidence):

- Owner: `businesses.owner_id = auth.uid()` (283).
- Business members: `business_users` join (283).
- Firm: `has_firm_engagement_with_business(businesses.id)` (284), which reads `firm_client_engagements` and `accounting_firm_users`.

**firm_client_engagements SELECT** (evidence):

- Firm: EXISTS on `accounting_firm_users` (firm_id, user_id = auth.uid()).
- Owner: EXISTS on `businesses` (id = client_business_id, owner_id = auth.uid()).

So: **businesses** policies depend on **business_users** and **firm_client_engagements + accounting_firm_users**. **firm_client_engagements** policies depend on **businesses** and **accounting_firm_users**. The recursion fix (284) uses a SECURITY DEFINER function so that the firms policy on businesses does not re-enter businesses RLS when reading fce/afu.

**Conclusion:** Authority involves **cross-table RLS chains**. Recursion is avoided by definer function for “firm sees business”; otherwise there is a logical cycle (businesses → fce → afu; fce → businesses).

---

## 9. POST-ACCEPT ACCESS REQUIREMENTS (FULL CHAIN)

For an accountant to access a client’s books, the following must all be true (with evidence):

| # | Requirement | Evidence |
|---|-------------|----------|
| 9.1 | Firm membership | `accounting_firm_users` row for user and firm (RLS on fce, effective route, context-check, checkAccountingAuthority). |
| 9.2 | Engagement exists | `firm_client_engagements` row for that firm and client_business_id (effective route, get_active_engagement, RLS). |
| 9.3 | Engagement status valid | Status `accepted` or `active` (get_active_engagement in 279; isEngagementEffective; effective route filters .in("status", ["accepted","active"])). |
| 9.4 | Effective date valid | effective_from <= today and (effective_to IS NULL OR effective_to >= today) (get_active_engagement; isEngagementEffective; effective route .lte("effective_from", today) and .or on effective_to). |
| 9.5 | Businesses RLS allows firm visibility | Policy using has_firm_engagement_with_business(id) — any engagement row (including pending) currently makes business visible. |
| 9.6 | Accounting table RLS | e.g. journal_entries, journal_entry_lines, accounting_periods, trial_balance_snapshots — 278: firm user can view if EXISTS (afu JOIN fce ON firm_id and client_business_id = table.business_id). No status/effective check in 278 policies; they only require an fce row for that firm–client. |
| 9.7 | Client selector or resolver returns business | resolveAccountingBusinessContext uses URL, then getActiveClientBusinessId(), then getCurrentBusiness. So either URL, or session/cookie, or owner business must supply businessId. |

**Conclusion:** **Seven** separate layers (membership, engagement existence, status, effective date, businesses RLS, accounting table RLS, resolver/session) all must hold. Acceptance only updates 9.2/9.3 (and accepted_at). It does **not** set session client, URL, or effective dates; those are set elsewhere (context-check, user selection, or firm creation of engagement with dates).

---

## 10. PROVEN STRUCTURAL COMPLEXITY

Authority is distributed across (evidence):

| Layer | Authority source | Evidence |
|-------|-------------------|----------|
| Engagement row | Partial | Required for firm path; status/effective enforced in app and RPC, not in businesses RLS. |
| Effective date | Partial | get_active_engagement, isEngagementEffective, effective route; not in has_firm_engagement_with_business. |
| Resolver output | Partial | Service: resolveServiceBusinessContext (invitations). Accounting: resolveAccountingBusinessContext (URL → session → getCurrentBusiness). |
| Firm membership | Required | accounting_firm_users in every firm path (RLS, effective, context-check, checkAccountingAuthority). |
| Businesses RLS | Required | Owner or has_firm_engagement_with_business for firm to see business row. |
| Accounting table RLS | Required | 278 policies: afu + fce join for journal_entries, journal_entry_lines, periods, trial_balance_snapshots. |
| Session client selection | Required | For accounting UI, getActiveClientBusinessId or URL business_id must be set for firm user to have context. |

---

## 11. OBSERVED FAILURE MODES (FROM EVIDENCE)

**Mode A — Resolver drift**  
Service uses resolveServiceBusinessContext (getCurrentBusiness + owner_id not null). Accounting uses resolveAccountingBusinessContext (URL → session → getCurrentBusiness). If the owner has no business (or unclaimed) or different “current” business, service invitations and accounting context can diverge. **Evidence:** Different resolvers and different call sites; no shared “canonical” business for both flows.

**Mode B — Effective date mismatch**  
Engagement can be accepted but effective_from in the future (or effective_to in the past). get_active_engagement and effective route filter by date; so “accepted” alone does not put the client in the effective list or pass isEngagementEffective. **Evidence:** 279 get_active_engagement; effective route; isEngagementEffective in firmEngagements.ts.

**Mode C — RLS visibility mismatch**  
Businesses RLS (has_firm_engagement_with_business) does not filter by status. Firm can see business row as soon as an engagement exists (e.g. pending). Client list in UI is filtered by effective (accepted/active + dates). So “row visible by business filter” (RLS) can be true while “in effective client list” (API) is false. **Evidence:** has_firm_engagement_with_business has no status/date check; effective route and get_active_engagement do.

**Mode D — Session mismatch**  
Active client is in sessionStorage and cookie. If the user accepts an engagement in one tab or without having selected that client in the accounting workspace, the next accounting page load may still have no client or a different client. Context gate and context-check can auto-select when exactly one effective client exists, but otherwise user must select. **Evidence:** firmClientSession.ts; AccountingClientContextGate; context-check and effective APIs.

**Mode E — Multi-table RLS dependency**  
Firm access to ledger/periods/snapshots requires: afu → fce → table.business_id. Multiple EXISTS chains; failure in any (e.g. RLS change, missing row) breaks access. **Evidence:** 278 policies; 284 definer for businesses.

---

## 12. STRUCTURAL COUPLING ANALYSIS

**Current dependency chain (evidence):**

```
Engagement (row + status + effective_from/to)
  → Business (businesses row visible via RLS)
    → Firm membership (accounting_firm_users)
      → Accounting authority (checkAccountingAuthority, get_active_engagement, isEngagementEffective)
        → Accounting table RLS (journal_entries, etc.)
```

Authority is **not** “acceptance = access”. It is **engagement existence + status + effective dates + firm membership + businesses RLS + accounting RLS + resolver/session**. Acceptance only updates engagement row (status, accepted_at, accepted_by). It does not set effective_from/effective_to, session client, or URL.

---

## 13. INVITATION SYSTEM GUARANTEES

**Current system guarantees (evidence):**

- **Invitation visibility to owner:** GET /api/service/invitations returns engagements where client_business_id = resolved businessId and RLS allows owner to see those rows (146 owner policy). **Evidence:** invitations/route.ts; 146 SELECT policy for owners.
- **Acceptance updates engagement row:** PATCH /api/service/engagements/[id] with action accept updates status to accepted, sets accepted_at and accepted_by; RLS and businesses.owner_id check enforce owner-only. **Evidence:** service/engagements/[id]/route.ts; 277 UPDATE policy for owners.

**Current system does NOT guarantee (evidence):**

- **Immediate accounting workspace access:** Access requires effective engagement (status + dates), client in effective list, and session/URL with that business_id. None of these are set by the accept endpoint. **Evidence:** effective route; resolveAccountingBusinessContext; firmClientSession.
- **Single authoritative access condition:** Access is the AND of firm membership, engagement row, status, effective dates, businesses RLS, accounting RLS, and resolver/session. **Evidence:** Sections 9–10.
- **Resolver independence:** Invitations use service resolver; accounting uses accounting resolver and session. **Evidence:** Section 6.
- **RLS independence:** Businesses RLS for firms uses has_firm_engagement_with_business (any engagement); effective list and get_active_engagement use status and dates. **Evidence:** 284; effective route; get_active_engagement.

---

## 14. EVIDENCE CONCLUSION

The engagement invitation system behaves as:

- **Invitation** = list engagements for resolved (owner) business; RLS + resolver.
- **Acceptance** = update engagement (status, accepted_at, accepted_by); authority = RLS + businesses.owner_id.
- **Accounting access** = multi-layer: firm membership + engagement (existence + status + effective dates) + businesses RLS + accounting table RLS + resolver/session (client or URL).

---

## 15. ROOT STRUCTURAL PROPERTY

The system is **engagement-triggered** but **not engagement-authoritative**.

- **Triggered:** Accept creates/updates the engagement row that is part of the chain used for firm access.
- **Not authoritative:** Access also depends on RLS chains (businesses, accounting tables), resolvers, session/URL client selection, and effective date logic. No single “engagement accepted ⇒ access granted” enforcement point.

Authority is distributed across: RLS (businesses, firm_client_engagements, accounting tables), resolvers (service, accounting), UI/session (active client), effective date logic (app + RPC), and firm membership.

---

## 16. FINAL AUDIT VERDICT

**Engagement acceptance does NOT structurally guarantee accounting access.**

**Reason:** Authority is **multi-derived**. Acceptance only ensures an engagement row exists with status `accepted` and accepted_at set. Accounting access additionally requires: (1) firm membership, (2) effective dates (effective_from/effective_to) to be satisfied, (3) businesses RLS to allow the firm to see the business (currently any engagement, including pending), (4) accounting table RLS to allow the firm to see ledger/periods/snapshots, and (5) the accounting UI to have a business context (URL or session client). None of (2)–(5) are guaranteed or set by the accept flow alone. Therefore the system does not have a single, structural guarantee that “after accept, the accountant can access the client’s books.”

---

*End of forensic audit. Evidence-only; no recommendations.*
