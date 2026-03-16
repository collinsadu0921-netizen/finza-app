# Engagement 404 After Owner Accept — Forensic Output

**Target engagement:** `6896b6e6-50ad-441c-a4d8-972ca8f98330`  
**Target business:** `8aa623a8-9536-47b9-8f0f-791cb8750b0e`

---

## STEP 5 — Owner policy chain (verified from migrations)

Engagement **SELECT** policy (migration 146) for business owners:

```sql
EXISTS (
  SELECT 1
  FROM businesses
  WHERE businesses.id = firm_client_engagements.client_business_id
    AND businesses.owner_id = auth.uid()
)
```

If `businesses` RLS blocks the owner from selecting their business row, this subquery returns no row → engagement row is invisible to the owner → PATCH returns 404.

Engagement **UPDATE** policy (migration 277) for business owners uses the same subquery on `businesses` for both USING and WITH CHECK.

---

## STEP 7 — firm_client_engagements RLS (audit from migrations)

| Policy | Command | Condition |
|--------|---------|-----------|
| Firm users can view their firm engagements | SELECT | EXISTS (accounting_firm_users where firm_id + user_id) |
| Business owners can view their business engagements | SELECT | EXISTS (businesses where id = client_business_id AND owner_id = auth.uid()) |
| Firm users can update their firm engagements | UPDATE | USING/WITH CHECK: firm user (partner/senior) |
| Business owners can update their business engagements | UPDATE | USING/WITH CHECK: same businesses subquery as above |

Owner visibility for both SELECT and UPDATE depends on the `businesses` subquery. No other engagement policies grant owner access.

---

## STEP 8 — Root cause classification (choose exactly one)

| Id | Root cause |
|----|------------|
| **A** | Businesses RLS not active in runtime DB (`relrowsecurity` = false) |
| **B** | Businesses RLS active but missing owner policy (policy list missing "Owners can select own business") |
| **C** | Engagement RLS policy mis-evaluating subquery (business SELECT works via debug route but engagement SELECT returns null) |
| **D** | Session mismatch GET vs PATCH (user.id or getSession() differs between GET invitations and PATCH handler) |

---

## STEP 9 — Output format

Fill after running STEP 1–4 and (optionally) STEP 6. Return only:

```
Root Cause:
Evidence:
Verified RLS state:
Verified Engagement Visibility:
Session Identity:
```

- **Root Cause:** A, B, C, or D (from STEP 8).
- **Evidence:** e.g. "relrowsecurity = false" / "policy list missing X" / "GET /api/debug/business-visibility row non-null, GET /api/debug/engagement-visibility row null" / "GET user.id ≠ PATCH user.id".
- **Verified RLS state:** Result of STEP 1 (true/false) and STEP 2 (policy names).
- **Verified Engagement Visibility:** Result of GET /api/debug/business-visibility and GET /api/debug/engagement-visibility (row or null, userId).
- **Session Identity:** GET invitations user.id and PATCH handler user.id (and session.user.id if logged); same or different.
