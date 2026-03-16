# GLOBAL FORENSIC AUDIT — "Engagement not found" on Accept

**Mode:** Read-only. No fixes. No refactors. No migrations.  
**Goal:** Explain why PATCH /api/accounting/firm/engagements/[id] returns "Engagement not found" when the engagement exists and is visible in firm list and invitations.

---

## SECTION 1 — Trace Accept Request Flow

**File:** `app/api/accounting/firm/engagements/[id]/route.ts`

### 1. How engagement is fetched

- **Query used:** `getEngagementById(supabase, engagementId)` (line 126).
- **Implementation** (`lib/firmEngagements.ts` lines 191–212):

```ts
const { data, error } = await supabase
  .from("firm_client_engagements")
  .select("*")
  .eq("id", engagementId)
  .maybeSingle()
```

- **Filters applied:** Only `.eq("id", engagementId)`. No filter on status, accounting_firm_id, client_business_id, or anything else.
- **RLS involvement:** Yes. The request runs with the authenticated user’s Supabase client (anon key + user JWT). SELECT on `firm_client_engagements` is subject to RLS. Both SELECT policies are evaluated (OR); if neither allows the row, the query returns 0 rows and `maybeSingle()` yields null.

### 2. Does handler fetch engagement BEFORE checking owner authorization?

**Yes.** Lines 125–133: engagement is fetched first; if `!engagement`, the handler returns 404 "Engagement not found" immediately. Owner (and firm) checks run only after a non-null engagement (lines 144–154).

### 3. Patterns used

- `.eq("id", engagementId)`  
- `.maybeSingle()` (so 0 rows → null, no error)

No `.single()` (which would throw on 0 rows). So when RLS hides the row, the result is null and the handler returns 404.

### 4. Can RLS cause SELECT to return zero rows even when the row exists?

**Yes.** If no RLS policy on `firm_client_engagements` allows the current user to see that row, Postgres returns 0 rows for that id. The row can exist and be visible to other roles (e.g. firm users) or in other contexts (e.g. invitations API using a different effective “current business”), but for this SELECT with this `auth.uid()` neither policy passes → 0 rows → getEngagementById returns null → 404.

**Exact query + filters:**  
`SELECT * FROM firm_client_engagements WHERE id = <params.id>` with RLS applied. Only filter is `id`; visibility is determined entirely by RLS.

---

## SECTION 2 — Owner Authorization Check

### 1. How owner is validated

- After engagement is loaded (lines 144–148): business is loaded by `engagement.client_business_id`:

```ts
const { data: business } = await supabase
  .from("businesses")
  .select("owner_id")
  .eq("id", engagement.client_business_id)
  .maybeSingle()
```

- Comparison: `const isBusinessOwner = business?.owner_id === user.id` (line 150).

### 2. Does accept handler require business.owner_id == auth.uid()?

**Yes.** For `action === "accept"` (lines 161–166): if `!isBusinessOwner`, the handler returns 403 "Only business owners can accept engagements."

### 3. Handler load chain

- Engagement is loaded by id only (getEngagementById).
- Then business is loaded via `engagement.client_business_id` → `businesses` → `owner_id`.
- So: **engagement → client_business_id → businesses.owner_id**. Owner check uses that business row.

**Full authorization chain:**  
Auth user → getEngagementById (must return row) → engagement.client_business_id → SELECT businesses.owner_id → isBusinessOwner = (business?.owner_id === user.id). Accept requires isBusinessOwner.

---

## SECTION 3 — RLS Validation

### firm_client_engagements

**SELECT (migration 146):**

1. **"Firm users can view their firm engagements"**  
   USING: EXISTS (SELECT 1 FROM accounting_firm_users WHERE firm_id = firm_client_engagements.accounting_firm_id AND user_id = auth.uid()).

2. **"Business owners can view their business engagements"**  
   USING: EXISTS (SELECT 1 FROM businesses WHERE businesses.id = firm_client_engagements.client_business_id AND businesses.owner_id = auth.uid()).

**UPDATE (migration 277):**

1. **"Firm users can update their firm engagements"**  
   USING/WITH CHECK: user in accounting_firm_users for that firm_id with role IN ('partner','senior').

2. **"Business owners can update their business engagements"**  
   USING/WITH CHECK: EXISTS (SELECT 1 FROM businesses WHERE id = client_business_id AND owner_id = auth.uid()).

### businesses

- No migration in the audited set defines a policy **ON** the `businesses` table (no "CREATE POLICY ... ON businesses" found). So either RLS is not enabled on `businesses`, or policies live in an unexamined migration.
- **If RLS is enabled on businesses** and the owner is not allowed to SELECT their own row (e.g. no policy with owner_id = auth.uid()), then the subquery in the firm_client_engagements policy (SELECT 1 FROM businesses WHERE id = client_business_id AND owner_id = auth.uid()) is subject to RLS on `businesses`. That subquery would then return 0 rows for the owner → the "Business owners can view their business engagements" USING is false → the engagement row is not visible to the owner → getEngagementById returns null.

### Can owner SELECT pending engagement?

- **By policy text:** Yes. The second SELECT policy does not filter by status; it only requires a matching businesses row with owner_id = auth.uid(). So pending engagements are allowed for the owner **if** the businesses subquery returns a row.
- **In practice:** Only if the owner can see that business row. If RLS on `businesses` blocks that SELECT, the owner cannot see the engagement.

**Policies affecting SELECT and UPDATE:**  
As above. SELECT for owner depends on EXISTS (businesses ... owner_id = auth.uid()). UPDATE for owner depends on the same EXISTS for USING and WITH CHECK.

---

## SECTION 4 — Status Lifecycle Guards

### pending → accepted

- **Allowed.** Handler (lines 167–174) sets `newStatus = "accepted"`, `updateData.status = "accepted"`, `accepted_at`, `accepted_by`. No guard blocks this in the route.

### pending → active

- **Blocked by trigger (migration 279).** `enforce_engagement_status_transition`: IF OLD.status = 'pending' AND NEW.status = 'active' THEN RAISE EXCEPTION. Accept flow sets status to 'accepted', not 'active', so this trigger is not hit on accept.

### Other constraints (279)

- `firm_client_engagements_status_check`: status IN ('pending','accepted','active','suspended','terminated').
- `firm_client_engagements_accepted_at_required`: when status IN ('accepted','active'), accepted_at must be NOT NULL.
- `enforce_accepted_requires_timestamp` trigger: blocks INSERT/UPDATE with status accepted/active if accepted_at IS NULL.

**Enforcement rules:** pending → accepted allowed (and handler sets accepted_at). pending → active blocked by trigger. No CHECK or guard in the route blocks accept.

---

## SECTION 5 — ID / Param Mismatch

### Is params.id the same UUID as engagement.id?

- **In code:** Yes. The handler uses `params.id` as `engagementId` and passes it to getEngagementById(supabase, engagementId). The same value is used in the UPDATE (line 329): `.eq("id", engagementId)`.
- **No encoding/trim/transform:** params come from the dynamic segment `[id]`; no explicit trim or encoding in the handler. Next.js passes the segment as-is.

**Param vs DB id:** If the client sends the same UUID that appears in the invitations list (engagement.id), then params.id matches the row. Mismatch would only occur if the client sent a different id (e.g. wrong engagement, or corruption in the request). The code does not alter the id.

---

## SECTION 6 — Supabase Client Context

### Which client is used

- **createSupabaseServerClient()** (line 106). Same as GET and as other server routes.
- **Implementation** (`lib/supabaseServer.ts`): createServerClient with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and cookies (getAll/setAll). So the same project and anon key; auth comes from the session (cookies). auth.uid() is the logged-in user.

### auth.uid() vs business.owner_id

- **Comparison:** isBusinessOwner = (business?.owner_id === user.id). user comes from supabase.auth.getUser(); user.id is the same as auth.uid() in RLS for that request.
- So for the owner to pass both (1) see the engagement and (2) pass the accept check, auth.uid() must equal the owner_id of the business that backs the engagement (client_business_id). If the engagement is for business B and the current user is the owner of B, auth.uid() === business.owner_id. If the user is not the owner of B (or businesses row is not visible), either RLS hides the engagement or the 403 owner check fails.

**auth.uid() vs business.owner_id:** They are compared explicitly; they must match for accept. The same auth.uid() is used in RLS for firm_client_engagements and in any subquery on businesses.

---

## SECTION 7 — Logical Failure Verdict

### Exact reason engagement cannot be fetched

**Primary: A. RLS blocks SELECT**

- The 404 is returned when getEngagementById returns null (lines 127–132), i.e. when the SELECT on firm_client_engagements returns 0 rows for that id.
- The only filter in code is id; the row exists. So visibility is determined by RLS.
- For the **business owner**, the only way to see the row is the policy "Business owners can view their business engagements", which requires:  
  EXISTS (SELECT 1 FROM businesses WHERE businesses.id = firm_client_engagements.client_business_id AND businesses.owner_id = auth.uid()).
- That subquery reads from `businesses`. In Postgres, RLS applies to that subquery. **If the `businesses` table has RLS enabled and no policy grants the owner SELECT on their own row**, the subquery returns 0 rows → the USING clause is false → the engagement row is not visible → getEngagementById returns null → 404 "Engagement not found".

**Evidence:**

- Handler returns 404 only when `!engagement` after getEngagementById (route.ts 126–132).
- getEngagementById uses only `.eq("id", engagementId).maybeSingle()` (firmEngagements.ts 196–201).
- SELECT policies on firm_client_engagements (146): owner path depends on EXISTS (businesses WHERE id = client_business_id AND owner_id = auth.uid()).
- No policy **on** table `businesses` was found in the audited migrations; if RLS is on and restrictive, that EXISTS fails for the owner.

**Alternative (secondary): F. Engagement exists but wrong business context**

- If the invitations UI shows the engagement because the **service** context resolved to business B (and the engagement is for B), but the **PATCH** request is made with a session where auth.uid() is the owner of a different business A, then the "Business owners can view their business engagements" policy would require a business row with id = B and owner_id = auth.uid(). That is false (owner of A ≠ owner of B), so the engagement would be hidden. So the engagement “exists” but the current user is not the owner of the business that backs it → same RLS outcome: SELECT returns 0 rows. This is still RLS (policy correctly hiding the row), but the root cause can be described as wrong business context (user is owner of A, engagement is for B).

**Verdict:** **A. RLS blocks SELECT** — the business-owner SELECT policy on firm_client_engagements depends on a subquery on `businesses`; if RLS on `businesses` prevents the owner from reading that row (or if the current user is not the owner of the engagement’s business), the engagement is not visible and the handler returns "Engagement not found".
