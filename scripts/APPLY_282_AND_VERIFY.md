# APPLY MIGRATION 282 + VERIFY — DATA/RESULTS ONLY

## Step 1 — BEFORE (run in DB the app uses)

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='accounting_firms'
  AND column_name='contact_email';
```

**Expected if column missing:** 0 rows.

**Paste result:** _______________

---

## Step 2 — APPLY migration 282

### Command run (Supabase CLI)

```
cd c:\projects\finza-web\finza-web; npx supabase db push 2>&1
```

### Result

- **Exit code:** 1 (failed)
- **Reason:** Remote DB has different migration history. "Found local migration files to be inserted before the last migration on remote database." CLI suggests `--include-all` (ordering risk).
- **282 not applied** via `db push` in this run.

### Manual apply (same DB the app uses)

Run this in **Supabase SQL Editor** (or psql) against the project the Next app connects to:

```sql
ALTER TABLE public.accounting_firms
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

COMMENT ON COLUMN public.accounting_firms.contact_email IS
  'Optional contact email shown to clients (partner sets in firm settings).';
```

---

## Step 3 — AFTER: verify column exists

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='accounting_firms'
  AND column_name='contact_email';
```

**Expected:** 1 row: `contact_email | text`

**Paste result:** _______________

---

## Step 4 — SMOKE: select works

```sql
SELECT id, name, contact_email
FROM public.accounting_firms
LIMIT 5;
```

**Expected:** No error; up to 5 rows (contact_email may be NULL).

**Paste result:** _______________

---

## Step 5 — API: invitations endpoint

**Request:** `GET /api/service/invitations` (authenticated, same env as app).

**Expected:** 200; JSON with `businessId`, `pending`, `active`. No `"column accounting_firms.contact_email does not exist"`.

**Paste status + response snippet:** _______________
