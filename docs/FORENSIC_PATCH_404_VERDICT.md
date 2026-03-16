# PATCH 404 ENGAGEMENT — Forensic verdict

**Mode:** Read-only. No fixes. No refactors. No migrations.  
**Target engagement:** `6896b6e6-50ad-441c-a4d8-972ca8f98330`  
**Target business:** `8aa623a8-9536-47b9-8f0f-791cb8750b0e`

---

## Capture steps (you run, then paste back)

1. Open `/service/invitations`, click **Accept** once.
2. Capture **both** server log blocks (GET then PATCH).

---

## STEP 1 — Auth identity mismatch

**Return only these values:**

| Log line | Value |
|----------|--------|
| [GET FORENSIC] user.id | |
| [PATCH FORENSIC] user.id | |

---

## STEP 2 — Cookie mismatch

**Return full cookie names** from both logs:

| Log line | Cookie names (list) |
|----------|---------------------|
| [GET FORENSIC] cookies | |
| [PATCH FORENSIC] cookies | |

**Compare:** presence of `sb-access-token`, `sb-refresh-token` in GET vs PATCH.

---

## STEP 3 — Row visibility in PATCH

**Return:**

| Log line | Value (row object OR null) |
|----------|----------------------------|
| [PATCH FORENSIC] row visible? | |

---

## STEP 4 — Owner relationship in PATCH

**Return:**

| Log line | Value |
|----------|--------|
| [PATCH FORENSIC] ownerCheck → owner_id | ownerCheck.owner_id |

---

## STEP 5 — Session tokens (getSession) in both routes

**Return:**

| Log line | Value |
|----------|--------|
| [GET FORENSIC] session.user.id | |
| [PATCH FORENSIC] session.user.id | |

---

## STEP 6 — Final verdict table

Fill from the values above, then apply the decision rule below.

| Check | Result |
|-------|--------|
| Same user.id GET vs PATCH | YES / NO |
| Same session token GET vs PATCH | YES / NO |
| PATCH can SELECT engagement row | YES / NO |
| PATCH owner matches business owner | YES / NO |

---

## ROOT CAUSE DECISION RULE

Choose **exactly one** from the verdict table:

| Id | Root cause | When to choose |
|----|------------|----------------|
| **A** | **Dual login cookie overwrite** — GET and PATCH run as different users/sessions. | GET user.id ≠ PATCH user.id **OR** GET session.user.id ≠ PATCH session.user.id **OR** cookies (e.g. sb-*-token) differ between GET and PATCH. |
| **B** | **Session context isolation in App Router** — request context or cookie handling differs so session differs even though cookies look the same. | Same cookie names/values (or both present) but session.user.id or user.id differs between GET and PATCH. |
| **C** | **RLS evaluation mismatch** — same user and session but PATCH cannot SELECT the engagement row (e.g. owner policy subquery on `businesses` fails). | Same user.id and same session.user.id for GET and PATCH; **[PATCH FORENSIC] row visible?** = null; ownerCheck.owner_id = PATCH user.id (owner matches). So identity is correct but RLS hides the row in PATCH. |

**Decision:**  
- If GET and PATCH identity/session/cookies differ → **A** or **B**.  
- If identity and session match but PATCH row visible? = null → **C**.
