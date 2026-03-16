# AUDIT + GLOBAL FIX — accounting_firms.contact_email Missing at Runtime

**Symptom:** `GET /api/service/invitations` → `{"error":"column accounting_firms.contact_email does not exist"}`  
**Goal:** Make live DB match canonical repo contract (migration 275). Global schema fix; no route patch.

---

## STEP 1 — Prove Actual DB State (SQL)

Run these in the **failing environment** DB (Supabase SQL Editor or psql).

### (1) Confirm column existence

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'accounting_firms'
ORDER BY ordinal_position;
```

**Paste results here:**  
If `contact_email` appears → column exists (symptom may be wrong DB or cache).  
If `contact_email` is missing → column absent; proceed to (2) and remediation.

---

### (2) Confirm migration 275 (or equivalent) was applied

Supabase typically stores migration history in one of:

- `supabase_migrations.schema_migrations` (version = migration filename)
- Dashboard: **Database → Migrations** (list of applied versions)

```sql
-- Try Supabase migration table (name may vary)
SELECT *
FROM supabase_migrations.schema_migrations
WHERE version LIKE '%275%'
ORDER BY inserted_at DESC;
```

If that table/column names differ, use Dashboard **Database → Migrations** and check whether **275_accounting_firms_visible_to_engaged_clients** (or equivalent) is listed as applied.

**Paste results here:**  
- Row found for 275 → migration recorded; possible table recreate (C).  
- No row for 275 → migration not applied (A) or migration table out of sync (B).

---

### (3) Repo: migration file exists and contains ADD COLUMN contact_email

**Result (from repo):**

- **File:** `supabase/migrations/275_accounting_firms_visible_to_engaged_clients.sql`
- **Contents (relevant lines):**

```sql
ALTER TABLE accounting_firms
  ADD COLUMN IF NOT EXISTS contact_email TEXT;
COMMENT ON COLUMN accounting_firms.contact_email IS 'Optional contact email shown to clients (partner sets in firm settings).';
```

Full file also contains RLS policy "Clients can view firm with active engagement". The canonical repo contract is: **contact_email exists on accounting_firms** (migration 275).

---

## STEP 2 — Root Cause Classification (choose ONE)

| Result pattern | Classification | Evidence |
|----------------|----------------|----------|
| (1) contact_email **missing**; (2) **no** row for 275 | **A) Migration 275 not applied to this DB** | Column list has no contact_email; schema_migrations has no 275. |
| (1) contact_email **missing**; (2) **has** row for 275 | **B) Migration table out of sync / wrong branch / partial deploy** OR **C) Table recreated or drifted after 275** | Migration recorded but column absent. |
| (1) contact_email **missing**; (2) unknown / no access | **C) Table recreated manually / drifted outside migrations** | Assume schema was reset or recreated without 275. |
| (1) contact_email **present** but API still errors | **D) Different DB is being hit at runtime** | Schema correct in one DB; app may be using different project/URL. |

**Return:** One of **A | B | C | D** + one-line evidence from your (1) and (2) results.

---

## STEP 3 — Canonical Remediation Plan (GLOBAL)

### If (A) or (B): Apply missing migration(s) in order

- **Do not** run ad-hoc SQL only for contact_email; apply the **full migration 275** so RLS and column stay in sync.
- From repo root (or Supabase CLI linked to the project):
  - `supabase db push` to apply all pending migrations, or
  - Apply `275_accounting_firms_visible_to_engaged_clients.sql` in order (after 274, before 276).
- **Verify:** Run STEP 4 SQL and API check.

### If (C): Restore column via new idempotent migration

- Add a **new** migration that restores the canonical column so migration history stays consistent and future deploys are safe.
- **Action:** A new migration file has been added: **282_restore_accounting_firms_contact_email.sql** (see below). It is idempotent (`ADD COLUMN IF NOT EXISTS`) and does not alter RLS.
- Apply it in the failing environment (e.g. `supabase db push` or run the migration file).
- **Verify:** Run STEP 4.

### If (D): Point app at correct DB

- Audit **NEXT_PUBLIC_SUPABASE_URL**, **SUPABASE_SERVICE_ROLE_KEY** (or anon key), and deployment config so the app and any server-side Supabase client use the **same** project where you ran (1).
- Re-run (1) in the DB that the app actually uses; confirm contact_email there. Then run STEP 4.

---

## STEP 4 — Post-Fix Verification

### SQL (run in same DB the app uses)

```sql
SELECT contact_email FROM public.accounting_firms LIMIT 1;
```

- **Expected:** Query succeeds; one row (possibly NULL). No “column does not exist”.

### API

- **Request:** `GET /api/service/invitations` (authenticated as a user with a service business).
- **Expected:** 200; JSON with `businessId`, `pending`, `active`. No `{"error":"column accounting_firms.contact_email does not exist"}`.

---

## Deliverable Summary

| Item | Content |
|------|--------|
| **STEP 1 evidence** | (1) and (2): run the SQL above in failing DB and paste results. (3): repo proof above. |
| **Root cause** | A | B | C | D from STEP 2 table. |
| **Remediation** | A/B: apply full 275 (or pending migrations). C: apply 282_restore_accounting_firms_contact_email.sql. D: fix env/deploy to correct DB. |
| **Verification** | SELECT contact_email; then GET /api/service/invitations → no schema error. |

---

## New Migration for Case (C): 282_restore_accounting_firms_contact_email.sql

File created in repo: `supabase/migrations/282_restore_accounting_firms_contact_email.sql`.  
Apply this migration when root cause is **(C)** (table recreated/drifted) so the column exists without re-running 275’s RLS changes.
