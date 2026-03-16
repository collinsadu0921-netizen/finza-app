# FINZA AUDIT — Pending Engagement Visible in Firm Workspace But Missing in Service Invitations

**MODE:** Read-only forensic audit. No fixes, no migrations, no UI changes.  
**GOAL:** Explain why an engagement shows as "pending" in Accounting (firm) workspace but does NOT appear in Service workspace invitations for the same business owner.

---

## SECTION A — Identify Canonical Entities

Trace these exact records using DB queries (run in Supabase SQL or client).

### 1️⃣ Engagement row

```sql
SELECT *
FROM firm_client_engagements
WHERE status = 'pending'
ORDER BY created_at DESC;
```

**Record and verify:**
- `id`
- `accounting_firm_id`
- `client_business_id`
- `status`
- `accepted_at`
- `effective_from`
- `effective_to`

**Evidence (code):** Engagements are stored in `firm_client_engagements` (migration 146). Status `pending` is valid (migration 279: status IN ('pending', 'accepted', 'active', 'suspended', 'terminated')).

---

### 2️⃣ Business row linked to that engagement

```sql
SELECT *
FROM businesses
WHERE id = <client_business_id>;
```

**Verify:**
- `owner_id` — **Critical:** If NULL, service context will never resolve to this business (see Section C).
- `onboarding_source` — Not used by invitations API or service resolver.
- `onboarding_status` — Not used by invitations API or service resolver.
- `archived_at` — Must be NULL for resolver to consider the business.

**Evidence (code):** `lib/serviceBusinessContext.ts` owner path: `.eq("owner_id", userId).is("archived_at", null)`. No check of onboarding_source/onboarding_status.

---

### 3️⃣ Confirm user ownership

```sql
SELECT *
FROM businesses
WHERE owner_id = <current_user_id>;
```

**Confirm:** User truly owns the business. If the user owns **multiple** businesses, note all `id` values. Service context returns **exactly one** business (see Section C); which one is undefined when multiple exist (no ORDER BY in resolver).

**Evidence (code):** `lib/serviceBusinessContext.ts` lines 22–27: one row returned with `.limit(1)` and **no `.order()`**. `lib/business.ts` uses `.order("created_at", { ascending: false }).limit(1)` for owner path — **different contract**.

---

### 4️⃣ Confirm business_users relationship

```sql
SELECT *
FROM business_users
WHERE user_id = <current_user_id>;
```

**Detect:** Is the user accessing the ledger company as owner vs employee/accountant? If the user has **no** row in `business_users` for `client_business_id` but **is** `businesses.owner_id` for that business, the **owner path** of the resolver applies (first query). If the user is only in `business_users` (not owner), the second path applies and requires `owner_id IS NOT NULL` on that business.

**Evidence (code):** `lib/serviceBusinessContext.ts` lines 34–52: fallback path uses `.in("role", ["admin", "accountant", "manager", "employee"])` and then `.not("owner_id", "is", null)` on businesses — so firm-created unclaimed businesses (owner_id NULL) never qualify.

---

### 5️⃣ Confirm firm membership

```sql
SELECT *
FROM accounting_firm_users
WHERE user_id = <current_user_id>;
```

**Evidence (code):** Firm clients API (`app/api/accounting/firm/clients/route.ts` lines 34–51) uses `accounting_firm_users` to get `firm_id` list, then loads engagements for those firms. So the same user can see the engagement in the firm list (as firm member) and be the owner of `client_business_id` (as owner). Visibility in each workspace is independent of the other.

---

## SECTION B — Invitations API Trace

**File:** `app/api/service/invitations/route.ts`

### Exact filtering logic

| Step | Code lines | Behavior |
|------|------------|----------|
| Auth | 28–35 | `createSupabaseServerClient()`, `getUser()`. No user → 401. |
| Context | 37–43 | `resolveServiceBusinessContext(supabase, user.id)`. If `"error" in ctx` → 200 with `{ businessId: null, pending: [], active: [] }`. **No engagement query.** |
| businessId | 45 | `const businessId = ctx.businessId` — **only** source of business for this API. |
| Engagement query | 47–52 | `from("firm_client_engagements").select(...).eq("client_business_id", businessId)`. **Filter: only rows where client_business_id equals resolved businessId.** |
| Status split | 110–126 | `row.status === "pending"` → pending array. `isEffective(row.status, row.effective_from, row.effective_to)` → active (status IN accepted/active + date window). **No other status filter; pending are included if they are in `list`.** |
| Date effectiveness | 15–25 | `isEffective()` used **only for active**. Pending list has **no** date filter. |
| onboarding_status | — | **Not checked.** |
| owner_id | — | **Not checked in API.** Owner requirement is enforced only indirectly: `resolveServiceBusinessContext` returns a business only when user is owner (or employee of claimed business). |

### Confirmed API requirements

- **resolveServiceBusinessContext()** — **Required.** Line 37. If it returns `NO_CONTEXT`, API returns empty payload (line 40–42) and **never queries engagements**.
- **owner_id IS NOT NULL** — **Required by resolver**, not by API. Resolver’s fallback path (business_users) filters businesses with `.not("owner_id", "is", null)` (line 46). Owner path returns any business where `owner_id = userId` (no explicit claim check).
- **Effective engagement filter** — Applied **only to active**. Pending are included if `status === "pending"` and row is in `list` (i.e. engagement query returned it). Engagement query is filtered **only** by `client_business_id = businessId`.

### Why a pending engagement can be missing

1. **businessId resolved ≠ engagement.client_business_id** — e.g. resolver returns business A; engagement has `client_business_id = B`. Then `.eq("client_business_id", businessId)` returns no rows for that engagement.
2. **NO_CONTEXT** — Resolver returns error (no owned business, no claimed membership). API never queries engagements.
3. **RLS** — Supabase client runs as authenticated user; RLS on `firm_client_engagements` must allow SELECT for that (businessId, user). Policy "Business owners can view their business engagements" (146) allows SELECT where `businesses.id = client_business_id AND businesses.owner_id = auth.uid()`. So if the **resolved** businessId is not the one with the engagement, the query is still by businessId; RLS does not hide the engagement for the “other” business — the engagement is simply not in the query filter (client_business_id = resolved id). So the primary cause is **resolver returning a different businessId** or **NO_CONTEXT**.

---

## SECTION C — Service Context Resolver

**File:** `lib/serviceBusinessContext.ts`

### How business is chosen

1. **First path (owner):** Query `businesses` where `owner_id = userId`, `archived_at` IS NULL, `.limit(1)`, `.maybeSingle()`. **No `.order()`.** Returns **one** row; which row is **database-dependent** when user owns multiple businesses.
2. **Second path (member):** Query `business_users` where `user_id = userId`, `role IN ('admin','accountant','manager','employee')`, limit 50. Then query `businesses` where `id IN (ids)`, `owner_id IS NOT NULL`, `archived_at` IS NULL, `.limit(1)`, `.maybeSingle()`. **No `.order()`.** Returns one claimed business the user is a member of.

### Multiple businesses

- If the user **owns more than one** business: first path returns **one** of them (undefined which). That may **not** be the business that has the pending engagement.
- If the user is **only** a member (business_users) of the engagement’s business and that business has **owner_id IS NULL**: second path excludes it (`.not("owner_id", "is", null)`). Resolver returns NO_CONTEXT for that business.

### Wrong business selection

- **True.** Resolver can return a different business than the one the engagement is linked to: when the user owns multiple businesses, the resolver’s owner path has **no ordering**, so it can return business A while the pending engagement is on business B.
- **Evidence:** `serviceBusinessContext.ts` lines 22–27: no `.order()`. `lib/business.ts` lines 8–14: `.order("created_at", { ascending: false })`. So **getCurrentBusiness** (used elsewhere) returns the most recently created owned business; **resolveServiceBusinessContext** does not guarantee the same.

### Firm-created unclaimed businesses

- **Ignored in service mode.** Second path requires `owner_id IS NOT NULL`. Owner path only returns businesses where `owner_id = userId` — so unclaimed (owner_id NULL) are never returned. Engagement linked to an unclaimed business will never appear in invitations for that business because context never resolves to it.

### owner_id requirement

- **Owner path:** Does not require owner_id IS NOT NULL explicitly; it selects by owner_id = userId, so returned businesses are always “owned” by the user.
- **Member path:** Explicitly requires `.not("owner_id", "is", null)` — claimed businesses only.

### Arbitrary first business

- **True.** Both paths use `.limit(1)` with **no ORDER BY**. Which business is returned is undefined when multiple match.

### Simulated resolution

- **Which businessId service workspace resolves:** The single row returned by the first query (owner) or the single row from the second (claimed membership). When the user owns N businesses, it is **one** of them, not necessarily the one with the engagement.
- **Match with engagement.client_business_id:** Only if that one chosen business’s id equals `engagement.client_business_id`. Otherwise invitations API will not include that engagement.

---

## SECTION D — Accounting Workspace Client List

**File:** `app/api/accounting/firm/clients/route.ts`

### Does it include pending / accepted / active?

- **Yes.** Line 55–59: `.in("status", ["pending", "accepted", "active", "suspended", "terminated"])`. All statuses are fetched.
- **Filter after fetch (lines 103–108):** Only **accepted/active** engagements are filtered by effectiveness (date window). If status is accepted/active and **not** effective, the row is dropped (return null). **Pending are never dropped** — they are always included in `clientsWithStatus` and then in `validClients`.

### Does it filter by onboarding_status / effective dates / owner claim?

- **Effective dates:** Only for accepted/active (lines 96–108). Pending are not filtered by dates.
- **onboarding_status:** Not used.
- **Owner claim state:** Not used. Client list is **firm-centric**: engagements for the user’s firms (`accounting_firm_id IN firmIds`). No check that the client business has an owner or is claimed.

### Why firm dashboard can see pending engagement

- API loads engagements by **firm** (`accounting_firm_id IN firmIds`), not by “current service business”. So every engagement for the firm is included. Pending engagements are included and not removed by the effective-date logic. So the firm view shows all clients (including pending) for the firms the user belongs to.

---

## SECTION E — RLS Visibility Conflict

### firm_client_engagements

**Policy (migration 146):** "Business owners can view their business engagements"  
- FOR SELECT  
- USING: EXISTS (SELECT 1 FROM businesses WHERE businesses.id = firm_client_engagements.client_business_id AND businesses.owner_id = auth.uid())

**Evidence:** Owner can SELECT any engagement row whose `client_business_id` is a business they own. **RLS does NOT hide pending engagements** for the owner; status is not in the policy.

**Policy (migration 277):** UPDATE for owners — same USING. Accept/reject allowed.

### accounting_firms

**Policy (migration 279):** "Clients can view firm with active engagement"  
- USING: owner + engagement status IN ('accepted','active') + date window.  
- Pending engagements do **not** satisfy this policy.

**Policy (migration 281):** "Accounting firms visible for owner engagements"  
- USING: EXISTS (fce JOIN businesses b ON b.id = fce.client_business_id AND b.owner_id = auth.uid() WHERE fce.accounting_firm_id = accounting_firms.id).  
- **No status filter** — any engagement (including pending) for a business the user owns allows SELECT on that firm row.

**Verdict:** After 281, owner can see firm rows for pending engagements. RLS does **not** hide pending engagements from the owner on `firm_client_engagements`. So the missing invitation is **not** due to RLS hiding rows, provided the **same** businessId is used in the invitations API as the engagement’s `client_business_id`. If the API uses a **different** businessId (resolver returning another business), the query `.eq("client_business_id", businessId)` never sees the engagement.

---

## SECTION F — Multi-Session / Dual Workspace State

### Resolvers and business returned

| Workspace | Resolver / source | Business returned |
|-----------|------------------|-------------------|
| **Accounting (firm list)** | Not a single “context” — API uses `accounting_firm_users` → firm_ids → all engagements for those firms | N/A (list is per firm, not per “current business”) |
| **Accounting (when viewing a client)** | `resolveAccountingBusinessContext`: (1) URL `business_id`, (2) `getActiveClientBusinessId()` (sessionStorage), (3) `getCurrentBusiness(supabase, userId)` | URL or session client or **first owned business** (getCurrentBusiness orders by created_at desc) |
| **Service (invitations)** | `resolveServiceBusinessContext(supabase, user.id)`: (1) one business where owner_id = userId (no order), (2) else one claimed business from business_users (no order) | **One** business; which one undefined when multiple |

### State matrix (same user, two workspaces)

| Workspace | Resolver | Business returned |
|-----------|----------|-------------------|
| Service (invitations) | resolveServiceBusinessContext | Single business: either arbitrary owned or first claimed member business |
| Accounting (client dropdown / URL) | resolveAccountingBusinessContext | URL business_id, or sessionStorage active client, or getCurrentBusiness (most recent owned) |

**Conflict:** If the user has **multiple** owned businesses:
- **getCurrentBusiness** (used by accounting fallback and elsewhere): returns **most recently created** (order created_at desc).
- **resolveServiceBusinessContext**: returns **one** owned business with **no order** — can be a different one.

So the **same user** in Service can have context = business A and in Accounting (with no URL/session client) can have context = business B. The pending engagement on business B would show in the firm list (which lists all clients of the firm) but **would not** show in Service invitations (which query only by business A).

---

## SECTION G — Known Architectural Failure Patterns

| Pattern | TRUE / FALSE | Evidence |
|---------|--------------|----------|
| Engagement linked to different businessId than service context | **TRUE** (possible) | Resolver returns one business (no order); engagement has client_business_id; if they differ, API filters it out. |
| Duplicate businesses with same name | **FALSE** (not required) | Would only matter if resolver picked the “wrong” duplicate; root cause is resolver picking one of N businesses. |
| Unclaimed firm-created business | **TRUE** (possible) | If client_business_id points to business with owner_id NULL, service context never resolves to it (owner path: owner_id = userId; member path: owner_id IS NOT NULL). |
| Service resolver picking wrong business | **TRUE** (possible) | No ORDER BY in owner or member path; multiple businesses → arbitrary one. |
| Invitations API filtering out pending | **FALSE** | API includes pending (line 123: `if (row.status === "pending") pending.push(...)`). No filter that removes pending. |
| RLS hiding pending engagements | **FALSE** | Owner SELECT policy on firm_client_engagements has no status condition. 281 allows owner to read firm for any engagement. |
| Effective-date filter hiding invitation | **FALSE** | Effective-date is used only for **active** list. Pending list has no date filter. |
| Dual login identity conflict | **FALSE** (for “same user”) | Same auth.uid(); conflict is which **business** is chosen, not which user. |

---

## SECTION H — Root Cause Verdict

**Primary root cause:** **Service context resolves to a different business than the one the pending engagement is linked to, so the invitations API never queries that engagement.**

**Supporting evidence:**

1. **Data:** Engagement row has `client_business_id = B`. Resolver returns `businessId = A`. API runs `.eq("client_business_id", businessId)` → `.eq("client_business_id", A)`. Row with client_business_id B is not returned.
2. **Code path:**  
   - `app/api/service/invitations/route.ts` line 37: `resolveServiceBusinessContext(supabase, user.id)`  
   - Line 45: `businessId = ctx.businessId`  
   - Line 52: `.eq("client_business_id", businessId)`  
   So the only business used is the one from the resolver. No fallback, no “all businesses the user owns.”
3. **Resolver path:** `lib/serviceBusinessContext.ts` lines 22–27: owner path returns one business, **no ORDER BY**. So when the user owns more than one business, the returned business is undefined. It can be business A while the engagement is on business B (e.g. firm-created client B, later claimed by same user who also owns A; or user owns A and B, engagement on B, resolver returns A).
4. **Alternative root cause (same contract):** Engagement’s business has **owner_id NULL** (unclaimed). Resolver returns NO_CONTEXT or another business; invitations API returns empty pending.

**Exact code path (summary):**

1. GET /api/service/invitations  
2. resolveServiceBusinessContext(supabase, user.id) → { businessId: X } or NO_CONTEXT  
3. If X, query firm_client_engagements where client_business_id = X  
4. Engagement with client_business_id = Y (Y ≠ X) is never in the result set  
5. Pending list is built only from that result set → engagement does not appear  

---

## SECTION I — Architecture-Level Fix Direction (NO CODE)

**Broken architectural contract:** **Context selection model for Service workspace.**

- **Contract assumed by invitations feature:** “Current service business” is the business the user is acting in, and that business is the same as the one that has the pending engagement when the user is the owner of the engagement’s business.
- **Actual contract:** Service context returns **one** business with **no defined ordering** when the user owns multiple or has multiple memberships. That single business is used for all service-scoped APIs (e.g. invitations). There is no “client picker” or “business switch” in Service; the resolver’s single choice is the only businessId.
- **Ownership claim model:** Correct at the DB level (owner_id, RLS). The failure is not that the user doesn’t own the business; it is that the **resolver’s single-business choice** can differ from the business that has the engagement.
- **Engagement lifecycle model:** Correct (pending vs accepted/active, effective dates). Not the cause.
- **RLS engagement visibility model:** Correct; owner can see engagements for businesses they own. Not the cause.
- **Invitations API contract:** Correct: it returns pending and active for the **resolved** businessId. The contract is “one business per request”; the break is that the resolved business is not guaranteed to be the one with the pending engagement.

**Fix direction (architectural only):**

- **Context selection model:** Define a **canonical** way to choose “the” service business when the user has multiple (e.g. same as getCurrentBusiness: order by created_at desc, or explicit “current business” in session). Align resolveServiceBusinessContext with that so that Service and any other code using “current business” agree.
- **Or:** Allow invitations (or service workspace) to be **multi-business**: resolve to all businesses the user owns (or can act in), and aggregate pending/active across them, or show a business switcher and then pending/active for the selected business. That would require an explicit “current business” or “invitations scope” instead of a single implicit resolver result.

No patch fixes; only architectural clarification of “current service business” and, if needed, multi-business or explicit selection.
