# Engage Accept 404 (Owner) — Prove A/B/C/D (NO FIX YET)

## Goal

Find why PATCH `/api/accounting/firm/engagements/:id` returns 404 "Engagement not found" while GET `/api/service/invitations` shows the engagement.

**Target engagement:** `6896b6e6-50ad-441c-a4d8-972ca8f98330`  
**Target business:** `8aa623a8-9536-47b9-8f0f-791cb8750b0e`

## Constraints

- DO NOT fix anything yet
- TEMP debug routes + TEMP logs only
- Output ONLY the final block (Root Cause / Evidence / Verified RLS state / Verified Engagement Visibility / Session Identity)

---

## STEP 1 — DB RLS state (run in the SAME DB the app uses)

Run in Supabase SQL editor for the project the app is connected to:

**1) Is RLS enabled on businesses?**

```sql
SELECT relrowsecurity
FROM pg_class
WHERE relname = 'businesses';
```

**2) Which policies exist on businesses?**

```sql
SELECT policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'businesses'
ORDER BY policyname;
```

---

## STEP 2 — TEMP debug endpoints (already added)

- **GET /api/debug/business-visibility** — Returns `{ userId, businessId, row, error }`. Query: `id, name, owner_id` from `businesses` where `id = target_business_id`.
- **GET /api/debug/engagement-visibility** — Returns `{ userId, engagementId, row, error }`. Query: `id, client_business_id, accounting_firm_id, status` from `firm_client_engagements` where `id = target_engagement_id`.

Both use `createSupabaseServerClient()`; target IDs are hardcoded.

---

## STEP 3 — TEMP logs (already added)

- **GET /api/service/invitations:** `[GET_INVITATIONS_ID]` — logs `user.id`, `session.user.id` (no cookies/tokens).
- **PATCH /api/accounting/firm/engagements/[id]:** `[PATCH_ACCEPT_ID]` — logs `user.id`, `session.user.id`, `params.id` (no cookies/tokens).

---

## STEP 4 — Run while logged in as OWNER

1. Open `/service/invitations` (triggers GET).
2. In browser, call:
   - `/api/debug/business-visibility`
   - `/api/debug/engagement-visibility`
3. Click Accept once (triggers PATCH).

Capture:

- SQL results from STEP 1 (both queries).
- JSON from both debug routes.
- Server log lines for `[GET_INVITATIONS_ID]` and `[PATCH_ACCEPT_ID]`.

---

## STEP 5 — Decide root cause (exactly one)

| Id | Root cause |
|----|------------|
| **A** | `businesses` relrowsecurity = false |
| **B** | `businesses` relrowsecurity = true but missing owner SELECT policy |
| **C** | business debug row ≠ null AND engagement debug row = null (same user) |
| **D** | GET user/session ≠ PATCH user/session |

---

## OUTPUT (fill from your run, then paste)

```
Root Cause: <A|B|C|D>
Evidence: <one line>
Verified RLS state: <relrowsecurity + policy names>
Verified Engagement Visibility: <business row null/not-null + engagement row null/not-null + userId>
Session Identity: <GET userId/sessionId vs PATCH userId/sessionId>
```
