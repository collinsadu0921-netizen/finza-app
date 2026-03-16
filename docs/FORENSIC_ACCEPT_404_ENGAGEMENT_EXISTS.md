# FORENSIC AUDIT — Accept returns 404 but engagement exists

**Mode:** Read-only. No fixes. No refactors. No migrations.  
**Goal:** Explain why GET invitations shows the engagement but PATCH returns "Engagement not found" when DB, ownership, and linkage are correct.

**Target engagement:** `6896b6e6-50ad-441c-a4d8-972ca8f98330`

---

## STEP 1 & 2 — TEMP logs added (PATCH)

**File:** `app/api/accounting/firm/engagements/[id]/route.ts`

- Immediately after `getUser()`: `[PATCH FORENSIC] user.id`, `[PATCH FORENSIC] cookies`, `[PATCH FORENSIC] params.id`.
- Before any owner check: raw `SELECT firm_client_engagements WHERE id = params.id` → `[PATCH FORENSIC] row visible?`, `[PATCH FORENSIC] row error?`.

Behaviour unchanged; logs only.

---

## STEP 3 — TEMP logs added (GET invitations)

**File:** `app/api/service/invitations/route.ts`

- After `getUser()`: `[GET FORENSIC] user.id`, `[GET FORENSIC] cookies`.

Behaviour unchanged; logs only.

---

## STEP 4 — Supabase client creation

**File:** `lib/supabaseServer.ts`

| Check | Result |
|-------|--------|
| **Creation** | Single `createSupabaseServerClient()`; no separate “PATCH client” vs “GET client”. |
| **Implementation** | `createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll, setAll } })`. |
| **Cookie adapter** | Same: `cookieStore = await cookies()` then `getAll()` / `setAll(cookieStore)`. |
| **Env** | Same URL and anon key for all server routes. |
| **Conditional auth override** | None. |
| **Service role** | Not used; anon key only. |

**PATCH client config:** createSupabaseServerClient() → createServerClient(url, anon key, cookie adapter).  
**GET client config:** createSupabaseServerClient() → createServerClient(url, anon key, cookie adapter).  
**Verdict:** **MATCH** — same function, same config.

---

## STEP 5 — ProtectedLayout session

**File:** `components/ProtectedLayout.tsx`

| Check | Result |
|-------|--------|
| **Session refresh** | Uses `supabase.auth.getSession()` (client-side `supabase` from `supabaseClient`) for access check only; does not call `refreshSession` or overwrite server cookies. |
| **Role switching** | None; only `resolveAccess()` and redirect. |
| **Firm mode session override** | None; no firm-specific auth or cookie write. |
| **supabase signIn / signOut** | Not called in this component. |
| **Cookie mutations** | None; no direct `cookies().set()` or document.cookie. |

**Verdict:** **ProtectedLayout does NOT switch or overwrite session.** It reads session client-side for redirect logic only.

---

## STEP 6 — Accept handler (browser)

**File:** `app/service/invitations/page.tsx` (handleAccept)

| Check | Result |
|-------|--------|
| **URL** | `fetch(\`/api/accounting/firm/engagements/${id}\`)` — correct. |
| **credentials: "omit"** | Not set; default `same-origin` → cookies sent. |
| **Custom Authorization header** | None. |
| **Session** | Relies on cookie session (same-origin fetch sends cookies). |

**Verdict:** Accept uses cookie session; no omission of credentials or custom auth that would change identity.

---

## STEP 7 — Middleware

**Search:** `middleware.ts` in project.

**Result:** No `middleware.ts` (or `middleware.js`) in repo.

**Verdict:** No middleware; no route-based session rewrite or auth cookie override.

---

## STEP 8 — Output comparison table (fill from server logs)

Run as business owner of Ledger: (1) GET /service/invitations, (2) PATCH accept on engagement. Then fill from console:

| Field | GET | PATCH |
|-------|-----|--------|
| **user.id** | _(from [GET FORENSIC] user.id)_ | _(from [PATCH FORENSIC] user.id)_ |
| **cookies present** | _(from [GET FORENSIC] cookies)_ | _(from [PATCH FORENSIC] cookies)_ |
| **engagement visible via SELECT** | _(invitations returns list containing target)_ | _(from [PATCH FORENSIC] row visible? — row vs null)_ |
| **supabase client config** | createSupabaseServerClient (same) | createSupabaseServerClient (same) |
| **middleware mutation** | NO (no middleware) | NO |
| **ProtectedLayout session mutation** | NO | NO |

**Interpretation:**

- If **GET user.id ≠ PATCH user.id** → different session (e.g. **A — dual login / cookie overwrite**).
- If **same user.id**, **GET shows engagement**, **PATCH row visible? = null** → RLS: same user sees row when query is by `client_business_id` (invitations) but not by `id` (PATCH). That would point at policy/RLS behaviour, not session. Then confirm **businesses** RLS (owner subquery) so owner can see engagement by id.
- If **PATCH row visible? = row** but handler still returns 404 → logic bug (e.g. later code path overwrites or uses wrong id); current code returns 404 only when `getEngagementById` returns null, so if raw SELECT sees row, `getEngagementById` should too unless there are two different SELECTs.

---

## Root cause candidates (confirm ONE from logs)

| Id | Candidate | How to confirm |
|----|-----------|-----------------|
| **A** | **Dual login overwriting cookies** — service as owner, accounting as firm user; Accept request runs with firm user session. | GET user.id = owner; PATCH user.id = different (firm user). Cookies differ between GET and PATCH. |
| **B** | **PATCH route running under different session container** (e.g. App Router request context). | Same code path for both; only difference would be request/cookie at call time. If cookies match and user.id matches → not B. If user.id or cookies differ → session context differs (A or C). |
| **C** | **Supabase client cookie adapter mismatch** — GET uses request cookies, PATCH uses stale/store. | Both call `await cookies()` in the same process; adapter is identical. If PATCH logs show different cookies than GET for same browser flow → cookie store differs by request (could be C or A). |
| **D** | **Middleware rewriting session per route prefix.** | No middleware in project → **D ruled out.** |

**Do not fix.** Use logs to confirm which of A/B/C applies (or that RLS explains visibility difference with same user).
