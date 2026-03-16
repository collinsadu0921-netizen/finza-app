# Audit: Hybrid Period Close — RLS Bypass Risk for business_has_active_engagement

## 1) Current RLS policy findings on firm_client_engagements

**Table:** `firm_client_engagements`  
**RLS:** Enabled (migration 146).

**SELECT policies (who can read rows):**

| Policy name | Migration | Condition |
|-------------|-----------|-----------|
| **Firm users can view their firm engagements** | 146 | `EXISTS (SELECT 1 FROM accounting_firm_users WHERE accounting_firm_users.firm_id = firm_client_engagements.accounting_firm_id AND accounting_firm_users.user_id = auth.uid())` |
| **Business owners can view their business engagements** | 146 | `EXISTS (SELECT 1 FROM businesses WHERE businesses.id = firm_client_engagements.client_business_id AND businesses.owner_id = auth.uid())` |

No later migration drops or narrows these SELECT policies. UPDATE/INSERT policies exist separately (277, 155) and do not affect SELECT.

---

## 2) Can a business owner SELECT from firm_client_engagements?

**Yes.** The policy **"Business owners can view their business engagements"** allows SELECT when:

- `businesses.id = firm_client_engagements.client_business_id`  
- `businesses.owner_id = auth.uid()`

So for any row where `client_business_id` is a business owned by the current user, that row is visible. When an owner calls the API (and thus the RPC runs with their JWT via `createSupabaseServerClient()` + anon key + cookies), `auth.uid()` is the owner. For `business_has_active_engagement(owner_business_id)` the only rows considered have `client_business_id = owner_business_id`, and the owner owns that business, so RLS allows those rows. The function can therefore see existing engagements for the owner’s business.

---

## 3) In-app reproduction (expected result)

- **Actor:** Owner of a business that has an active firm engagement.  
- **Call:** `GET /api/accounting/periods/has-active-engagement?business_id=<that_business_id>`  
- **Expected:** `has_active_engagement: true` (engagement exists and owner is allowed to see it under RLS).  
- If you observe **false** in production, possible causes are: different RLS state (e.g. policy missing), session not owner (e.g. wrong client/role), or engagement not actually effective (status/dates). Under the current codebase and migrations, the intended behavior is **true** when an effective engagement exists.

---

## 4) Is bypass possible today?

**No, under current RLS.**  

- **UI:** Owner sees “Soft close” only when `has_active_engagement === false`; with an engagement, they get “Request close”.  
- **API (has-active-engagement):** Returns true when the invoker (owner) can see at least one effective engagement row; RLS allows that for the owner’s business.  
- **Close route:** Before performing `soft_close`, it calls `business_has_active_engagement(business_id)` with the same user’s Supabase client. For an owner with an engagement, that returns true and the route returns 400, so `soft_close` cannot be used to bypass the firm workflow.  

So the engagement check is consistent for owners and bypass is not possible when RLS is as defined in the migrations.

---

## 5) Smallest fix option (if you want the check to be RLS-independent)

If you want the engagement existence check to be **authoritative** and not depend on RLS (e.g. defense in depth or to avoid any future policy change breaking it), use one of the following.

### Option A (recommended): SECURITY DEFINER, single-parameter function

Keep the function taking only `p_business_id`. Run it with **SECURITY DEFINER** so it reads `firm_client_engagements` with definer rights and RLS is bypassed. The function already restricts by `client_business_id = p_business_id`; it does not expose other businesses’ data. Restrict execution to authenticated callers (e.g. grant EXECUTE to `authenticated` or to a role your API uses).

**New migration (e.g. 304):**

```sql
-- Make engagement check authoritative: no dependency on caller's RLS.
-- Caller still identified by API (checkAccountingAuthority); this only fixes the read.
CREATE OR REPLACE FUNCTION business_has_active_engagement(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM firm_client_engagements e
    WHERE e.client_business_id = p_business_id
      AND e.status IN ('accepted', 'active')
      AND e.effective_from <= CURRENT_DATE
      AND (e.effective_to IS NULL OR e.effective_to >= CURRENT_DATE)
  );
$$;

COMMENT ON FUNCTION business_has_active_engagement(UUID) IS 'Returns true if business has any effective firm engagement. SECURITY DEFINER so result is authoritative regardless of RLS; only exposes existence for the given business_id.';
```

No change to API or close route; they keep calling the same RPC. The result no longer depends on the owner (or any user) having SELECT on `firm_client_engagements`.

### Option B: Service role only for the engagement check

Use a Supabase client with the **service role** key only inside the close route (and optionally the has-active-engagement route) to run a single query or RPC for “does this business have an active engagement?”. No RLS is applied. You must not use that client for any other data. This is more invasive (two code paths, key handling) and not recommended if Option A is acceptable.

---

## Summary

| Question | Answer |
|----------|--------|
| **Current RLS on firm_client_engagements** | SELECT: firm users (by firm membership), business owners (by `businesses.owner_id = auth.uid()` and `businesses.id = client_business_id`). |
| **Can owner see engagements for their business?** | Yes. Policy "Business owners can view their business engagements" allows it. |
| **Bypass possible today?** | No. Owner gets correct `has_active_engagement` and close route blocks `soft_close` when engagement exists. |
| **Smallest fix if you want RLS-independent check** | Option A: make `business_has_active_engagement` SECURITY DEFINER (single migration, no API/route changes). |
