# FORENSIC AUDIT — "Engagement not found" on Accept while GET invitations shows it

**Mode:** Read-only. No migrations. No UI changes. No refactors.  
**Goal:** Find why PATCH cannot see the engagement row while GET can.

**Target engagement id:** `6896b6e6-50ad-441c-a4d8-972ca8f98330`  
**Target business id (Ledger):** `8aa623a8-9536-47b9-8f0f-791cb8750b0e`

---

## 1) Accept button — endpoint and payload

**File:** `app/service/invitations/page.tsx`

| Check | Result |
|-------|--------|
| **Fetch URL** | `/api/accounting/firm/engagements/${id}` — exact. `id` is `item.id` from the pending list (engagement id). |
| **Method** | `PATCH` |
| **Body** | `JSON.stringify({ action: "accept" })` — handler expects `action` in body; value is `"accept"`. |
| **Wrong route / wrong id / missing body?** | No. Same engagement id as in the list; correct route and body. |

**Relevant code (lines 77–85):**

```ts
const res = await fetch(`/api/accounting/firm/engagements/${id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "accept" }),
})
```

So the Accept button calls the right endpoint with the right method and payload; the only variable is `id` from the list (and cookies/session for the same user).

---

## 2) TEMP server logs added (PATCH) — identity + row visibility

**File:** `app/api/accounting/firm/engagements/[id]/route.ts` (PATCH handler)

**Logged (run in order, then remove after diagnosis):**

- **user.id** from `supabase.auth.getUser()`
- **params.id**
- **SELECT firm_client_engagements WHERE id = params.id** — raw `data` (row vs null) and `error`
- **SELECT firm_client_engagements WHERE client_business_id = Ledger id** — count and `error`
- **SELECT businesses WHERE id = Ledger id** — `owner_id` and `error`

**Log prefix:** `[PATCH ENGAGEMENT FORENSIC]`

So you get: same user as GET or not, same `params.id`, whether the row is visible by id, whether any rows exist for Ledger, and who owns Ledger.

---

## 3) TEMP log added (GET invitations) — identity for comparison

**File:** `app/api/service/invitations/route.ts` (GET)

**Logged:**

- **user.id**
- **resolved businessId** (from resolveServiceBusinessContext)
- **engagementCount** (length of list returned for that business)

**Log prefix:** `[INVITATIONS GET FORENSIC]`

Compare this user.id and resolvedBusinessId with the PATCH logs; engagementCount confirms how many engagements GET sees for that business.

---

## 4) Hypothesis to confirm/deny

| Hypothesis | How to confirm/deny from logs |
|------------|------------------------------|
| **A) PATCH runs under a different session/user than GET** (e.g. cookie overwritten by firm account in another tab) | GET log shows user.id = X, PATCH log shows user.id = Y ≠ X → **A confirmed**. |
| **B) Accept calls wrong route / wrong id / missing body** | Already verified in (1): route and body are correct. If params.id in PATCH is wrong or undefined → **B** (wrong id). |
| **C) RLS/policies differ by request context** (same user + same project) | Same user.id on GET and PATCH, but SELECT by id returns null in PATCH and GET returns engagements for Ledger → **C** (same user, different visibility; then check businesses.owner_id vs user.id and RLS on businesses). |

---

## Output required (fill from server logs after one GET invitations + one PATCH accept)

| Field | Source | Example |
|-------|--------|--------|
| **GET user.id** | `[INVITATIONS GET FORENSIC] user.id:` | … |
| **PATCH user.id** | `[PATCH ENGAGEMENT FORENSIC] user.id:` | … |
| **params.id** | `[PATCH ENGAGEMENT FORENSIC] params.id:` | 6896b6e6-50ad-441c-a4d8-972ca8f98330 |
| **SELECT by id returns row in PATCH?** | `[PATCH ENGAGEMENT FORENSIC] SELECT by id — data:` | row | null |
| **SELECT by business_id returns row(s) in PATCH?** | `[PATCH ENGAGEMENT FORENSIC] SELECT by client_business_id — count:` | 0 or ≥1 |
| **business.owner_id for Ledger** | `[PATCH ENGAGEMENT FORENSIC] SELECT businesses (Ledger) — owner_id:` | … |

**Interpretation:**

- If **GET user.id ≠ PATCH user.id** → **A** (different session/user).
- If **params.id** is wrong or undefined → **B** (wrong id).
- If **GET user.id = PATCH user.id**, **SELECT by id = null** in PATCH, **SELECT by business_id count ≥ 1** in PATCH → RLS hides the row for this user when querying by id (e.g. businesses subquery fails for owner).
- If **SELECT by id = null** and **SELECT by business_id count = 0** in PATCH → RLS hides all engagements for Ledger for this user (owner policy failing).
- **business.owner_id** should equal **PATCH user.id** for the owner; if not, the acting user is not the owner of Ledger.

No fixes in this pass. Remove the TEMP log lines after capturing the output.
