# FINZA ENGAGEMENT SYSTEM — NUCLEAR FORENSIC AUDIT

**MODE:** READ ONLY — No fixes, refactors, patches, migrations, UI, or RLS changes.

**GOAL:** Prove exactly why engagement Accept can fail with "Engagement not found" when invitations GET shows the engagement.

---

## SECTION 1 — ROUTE MAP VALIDATION

| Function | File | Endpoint | Workspace | Purpose |
|----------|------|----------|-----------|---------|
| Invitations GET | `app/api/service/invitations/route.ts` | GET /api/service/invitations | Service | List pending/active engagements for resolved service business |
| Service engagement PATCH | `app/api/service/engagements/[id]/route.ts` | PATCH /api/service/engagements/[id] | Service | Accept/Reject only; fetch by id; validate owner via engagement.client_business_id |
| Accounting engagement GET | `app/api/accounting/firm/engagements/[id]/route.ts` | GET /api/accounting/firm/engagements/[id] | Accounting | Get one engagement by id; firm or owner access |
| Accounting engagement PATCH | `app/api/accounting/firm/engagements/[id]/route.ts` | PATCH /api/accounting/firm/engagements/[id] | Accounting | Suspend/Resume/Terminate/Update only; returns 403 for accept/reject |
| UI invitations page | `app/service/invitations/page.tsx` | (page) /service/invitations | Service | Renders list; calls GET invitations, PATCH service/engagements for accept/reject |
| UI accept handler | `app/service/invitations/page.tsx` (handleAccept) | — | Service | fetch PATCH /api/service/engagements/${id} with { action: "accept" } |
| Service business resolver | `lib/serviceBusinessContext.ts` (resolveServiceBusinessContext) | — | Service | Wrapper around getCurrentBusiness; returns businessId or NO_CONTEXT |
| Accounting business resolver | `lib/accountingBusinessContext.ts` (resolveAccountingBusinessContext) | — | Accounting | URL/session → getActiveClientBusinessId / getCurrentBusiness; not used in accept flow |
| Supabase server client | `lib/supabaseServer.ts` (createSupabaseServerClient) | — | Shared | createServerClient(ANON_KEY, { cookies: getAll/setAll from next/headers cookies() }) |
| RLS firm_client_engagements SELECT | Migrations 146, 277, 279 | — | DB | Firm users; Business owners (businesses.id = client_business_id AND owner_id = auth.uid()) |
| RLS firm_client_engagements UPDATE | Migration 277 | — | DB | Firm users (partner/senior); Business owners (same predicate) |
| RLS businesses SELECT | Migration 283 | — | DB | Owners (owner_id = auth.uid()); Members (business_users) |
| Middleware | (none found) | — | — | No middleware.ts in project; no explicit auth/session refresh in path |

---

## SECTION 2 — UI ACCEPT FLOW TRACE

**FULL CALL GRAPH**

1. **UI:** User clicks Accept on a pending invitation card.  
   - Source: `app/service/invitations/page.tsx` → `onClick={() => handleAccept(item.id)}` (item from `pending[]`).

2. **Handler:** `handleAccept(id: string)`  
   - Sets `actioningId(id)`, clears card error for `id`.  
   - Calls `fetch(\`/api/service/engagements/${id}\`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept" }) })`.  
   - No `credentials` option → browser default for same-origin is to send cookies.

3. **Request:**  
   - **URL:** `https://<origin>/api/service/engagements/<engagementId>` (exact string from `item.id`).  
   - **Method:** PATCH.  
   - **Payload:** `{ "action": "accept" }`.  
   - **Credentials:** Cookies sent by default (same-origin).  
   - **Authorization header:** Not set by the UI; auth is cookie-based via Supabase server client.

4. **Response handling:**  
   - 403 and body contains "business owners" → set `ownerError`, clear `actioningId`, return.  
   - !res.ok → set card error to `data.error` or "Failed to accept", clear `actioningId`, return.  
   - Else → toast "Invitation accepted.", call `load()` (re-fetch GET /api/service/invitations).

**Verification**

- Endpoint called: **Service** `/api/service/engagements/${id}` (not accounting).
- Request URL: Literal string from `item.id` (engagement uuid).
- Credentials: Same-origin fetch sends cookies unless `credentials: 'omit'` (not used).
- No explicit Authorization header; Supabase server client uses `cookies()` from `next/headers` to read session.

---

## SECTION 3 — AUTH SESSION FORENSIC

Both GET invitations and PATCH accept use:

- **Client:** Browser on same origin; fetch from `app/service/invitations/page.tsx` (no credentials override).
- **Server:** `createSupabaseServerClient()` in each route handler → `createServerClient(..., { cookies: { getAll: () => cookieStore.getAll(), setAll: (...) } })` with `cookieStore = await cookies()` from `next/headers`.

So both requests use the same cookie store for the same request context (same user tab/session). Identity should be the same unless the session is refreshed or expires between the GET and the PATCH.

| Request | user.id | session.user.id | Cookie presence | Client creation path |
|---------|---------|------------------|-----------------|------------------------|
| GET /api/service/invitations | supabase.auth.getUser() → data.user.id | getSession() → session?.session?.user?.id | Same-origin fetch sends cookies; cookieStore.getAll() in createSupabaseServerClient | lib/supabaseServer.ts createServerClient(ANON_KEY, { cookies }) |
| PATCH /api/service/engagements/[id] | supabase.auth.getUser() → data.user.id | Not called in this route | Same-origin fetch sends cookies; same cookieStore | Same |

**Conclusion:** No code path difference in auth between the two. If "Engagement not found" occurs, either (1) RLS evaluates differently for the PATCH query than for the GET query, or (2) session/cookie is missing or changed for the PATCH request (e.g. cookie scope, expiry, or different request context).

---

## SECTION 4 — ENGAGEMENT VISIBILITY PROOF

### A. Invitations GET

- **Query:**  
  `resolveServiceBusinessContext(supabase, user.id)` → `businessId`.  
  Then:  
  `SELECT id, accounting_firm_id, status, ... FROM firm_client_engagements WHERE client_business_id = businessId`.
- **Filters:** `.eq("client_business_id", businessId)` (application-level).
- **RLS:** Row visible if **any** of:
  - Firm user: EXISTS (accounting_firm_users WHERE firm_id = accounting_firm_id AND user_id = auth.uid()).
  - Business owner: EXISTS (businesses WHERE id = client_business_id AND owner_id = auth.uid()).
- **Impact:** Owner sees rows where `client_business_id` is a business they own. Invitations list is therefore scoped by **resolver output** (businessId) and then RLS allows those rows for that owner.

### B. Service PATCH (accept)

- **Query:**  
  `SELECT * FROM firm_client_engagements WHERE id = engagementId` (no client_business_id filter).
- **Filters:** `.eq("id", engagementId)` only.
- **RLS:** Same policies. Row visible iff (firm user for that firm **or** owner of `row.client_business_id`). So for an owner, visibility depends on: EXISTS (businesses WHERE id = row.client_business_id AND owner_id = auth.uid()). The **row** is the one with the given id; RLS runs that subquery for that row.
- **Impact:** If RLS returns the row, PATCH then validates owner via `businesses WHERE id = engagement.client_business_id` and `owner_id === user.id`. If RLS returns no row → 404 "Engagement not found".

### C. Accounting PATCH

- **Relevance:** Accept/reject are **rejected with 403** before any engagement fetch. No engagement visibility path is used for accept in accounting route.
- **Query (for firm actions only):** getEngagementById(supabase, engagementId) → `SELECT * FROM firm_client_engagements WHERE id = engagementId`.
- **RLS:** Same as above.

### Comparison matrix

| Route | Query | RLS policy required for owner | Can owner see row? |
|-------|--------|--------------------------------|--------------------|
| Invitations GET | SELECT ... WHERE client_business_id = businessId | "Business owners can view their business engagements" (businesses.id = client_business_id AND owner_id = auth.uid()) | Yes, for rows where they own the business and resolver returned that businessId |
| Service PATCH | SELECT ... WHERE id = engagementId | Same policy (evaluated for the single row by id) | Yes, if for that row businesses.id = client_business_id AND owner_id = auth.uid() |
| Accounting PATCH (accept/reject) | Not used (403 before fetch) | N/A | N/A |

**Critical point:** For the **same** engagement row and **same** auth.uid(), the RLS predicate is the same: ownership of `client_business_id`. So in theory, if the owner sees the row in GET (by client_business_id = businessId), they should see the same row in PATCH (by id). The only way PATCH returns 404 "Engagement not found" is:

1. **RLS hides the row on the id-only SELECT** (policy evaluates FALSE for that row when queried by id), or  
2. **auth.uid() or session differs** on the PATCH request (e.g. no/invalid cookie), or  
3. **Supabase returns an error** (fetchError) and the route returns 404.

RLS policies are per-row and do not depend on the WHERE clause of the query; they only depend on auth.uid() and the row’s columns. So (1) would imply an implementation quirk or bug (e.g. optimizer/plan difference). (2) is the most plausible if logs show different user/session between GET and PATCH.

---

## SECTION 5 — RLS POLICY FULL EVALUATION

### firm_client_engagements — SELECT (migration 146)

**Policy 1: "Firm users can view their firm engagements"**

- **USING:** EXISTS (SELECT 1 FROM accounting_firm_users WHERE firm_id = firm_client_engagements.accounting_firm_id AND user_id = auth.uid()).
- **Effect:** Firm members see all engagements for their firm.

**Policy 2: "Business owners can view their business engagements"**

- **USING:** EXISTS (SELECT 1 FROM businesses WHERE businesses.id = firm_client_engagements.client_business_id AND businesses.owner_id = auth.uid()).
- **Effect:** A row is visible to the current user if they are the owner of the business referenced by client_business_id.

### firm_client_engagements — UPDATE (migration 277)

**Policy 1: "Firm users can update their firm engagements"**

- **USING:** EXISTS (accounting_firm_users with firm_id = accounting_firm_id, user_id = auth.uid(), role IN ('partner','senior')).
- **WITH CHECK:** Same.
- **Effect:** Partners/seniors can update engagements of their firm.

**Policy 2: "Business owners can update their business engagements"**

- **USING:** EXISTS (businesses WHERE id = firm_client_engagements.client_business_id AND owner_id = auth.uid()).
- **WITH CHECK:** Same.
- **Effect:** Owner of the client business can update that engagement (e.g. accept/reject).

### businesses — SELECT (migration 283)

- **"Owners can select own business":** owner_id = auth.uid().
- **"Business members can select their businesses":** EXISTS (business_users WHERE business_id = businesses.id AND user_id = auth.uid()).

### Which policies must be TRUE for Accept to succeed

1. **SELECT firm_client_engagements (by id):**  
   For the engagement row, at least one of:
   - Firm user policy TRUE, or  
   - **Business owners can view their business engagements** TRUE  
   → i.e. EXISTS (businesses WHERE id = engagement.client_business_id AND owner_id = auth.uid()).

2. **SELECT businesses (for ownership check in app):**  
   Row for `engagement.client_business_id` must be visible → **Owners can select own business** (owner_id = auth.uid()) or business_users policy. For a pure owner, owner_id = auth.uid() is required.

3. **UPDATE firm_client_engagements:**  
   **Business owners can update their business engagements** must be TRUE for that row (same EXISTS as above).

So for Accept to succeed:

- auth.uid() must equal the owner of the business with id = engagement.client_business_id.
- That business row must be visible (owner or member).
- RLS on firm_client_engagements must allow SELECT and UPDATE for that row for that user.

### Evaluation tree (Accept flow)

```
PATCH /api/service/engagements/[id] (action: accept)
├── Auth: getUser() → user.id
├── SELECT firm_client_engagements WHERE id = engagementId
│   └── RLS: "Business owners can view their business engagements"
│       └── EXISTS (businesses WHERE id = row.client_business_id AND owner_id = auth.uid())
│           └── If FALSE → 0 rows → 404 "Engagement not found"
├── SELECT businesses WHERE id = engagement.client_business_id
│   └── RLS: "Owners can select own business" (owner_id = auth.uid())
│       └── If 0 rows → business?.owner_id !== user.id → 403
├── UPDATE firm_client_engagements SET status, accepted_at, accepted_by WHERE id = engagementId
│   └── RLS: "Business owners can update their business engagements"
│       └── Same EXISTS as above; if FALSE → update affects 0 rows → 500 or 404 after update
└── Return 200 + engagement
```

**Root cause (404 "Engagement not found"):** The only place that returns that message in the Service PATCH is when `fetchError || !engagement` after the id-only SELECT. So either:

- **RLS made the SELECT return 0 rows** (policy "Business owners can view their business engagements" evaluated FALSE for that row with the current auth.uid()), or  
- **Supabase returned an error** (fetchError set).

Given the same RLS predicate as the invitations GET (ownership of client_business_id), the most likely explanation for 404 despite the engagement appearing in the list is **different auth.uid() or missing session on the PATCH request** (e.g. cookie not sent or different request context), not a difference in RLS logic between “query by client_business_id” and “query by id.”

---

## SUMMARY

- **Route map:** Service invitations GET and Service engagements PATCH are the only routes used for listing and accepting; Accounting PATCH rejects accept/reject with 403.
- **UI:** Accept calls PATCH `/api/service/engagements/${id}` with `{ action: "accept" }`; same-origin fetch sends cookies; no explicit Authorization header.
- **Auth:** Same Supabase server client and cookie source for both GET and PATCH; no middleware in the path. Any identity difference would be due to cookie/session not being sent or not matching.
- **Visibility:** Invitations GET uses resolver + client_business_id filter; Service PATCH uses id-only. RLS for owner is the same (ownership of client_business_id). So in principle, if the owner sees the row in GET, they should see it in PATCH unless auth or error differs.
- **RLS:** Accept requires the owner SELECT and UPDATE policies on firm_client_engagements to pass (ownership of client_business_id) and the businesses row to be visible.

**Proven root cause for 404:** Either (1) **session/auth differs** on the PATCH request (auth.uid() different or missing so RLS hides the row or Supabase errors), or (2) **Supabase returns an error** on the id-only SELECT and the handler maps it to 404. To fully prove which, server logs for both requests (user.id, session?.session?.user?.id, and for PATCH: fetchError, and whether the SELECT returned 0 rows or an error) are required.
