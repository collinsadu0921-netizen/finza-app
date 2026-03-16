# Forensic verification — archived exclusion verification result

## How to run the verification

**Option A — Script (recommended)**  
With Supabase env set (e.g. from `.env.local`):

```bash
cd finza-web
# Load env if needed: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npx ts-node scripts/verify-forensic-archived-exclusion.ts
```

The script will:
1. Create a run in `accounting_invariant_runs`
2. Call `run_forensic_accounting_verification(p_run_id)` (same as cron endpoint)
3. Update the run with summary
4. Check that every failure row’s `business_id` belongs to a business with `archived_at IS NULL`
5. Print **PASS** (exit 0) or **FAIL** (exit 1) and the summary below

**Option B — Manual SQL**  
In Supabase SQL Editor (or psql):

```sql
-- 1) Create run and get run_id
INSERT INTO accounting_invariant_runs (status) VALUES ('running') RETURNING id;
-- Use the returned id as <run_id> below.

-- 2) Execute runner
SELECT run_forensic_accounting_verification('<run_id>');

-- 3) Update run (paste the JSON returned above into summary)
UPDATE accounting_invariant_runs
SET finished_at = NOW(), status = 'success', summary = '<paste_json_here>'
WHERE id = '<run_id>';

-- 4) Validate: failures must only reference non-archived businesses
SELECT f.business_id, b.archived_at, COUNT(*)
FROM accounting_invariant_failures f
JOIN businesses b ON b.id = f.business_id
WHERE f.run_id = '<run_id>'
GROUP BY f.business_id, b.archived_at;
```

**PASS:** The query in step 4 returns no rows, or every row has `archived_at IS NULL`.  
**FAIL:** Any row has `archived_at IS NOT NULL` — list those `business_id`s.

---

## Step 5 — Output summary (template)

After running the job and validation:

| Field | Value |
|-------|--------|
| **Latest run_id** | `<from step 1>` |
| **Total failures** | `<summary.total_failures>` |
| **Alertable failures** | `<summary.alertable_failures>` |
| **Archived tenants still appear in failures?** | YES / NO |
| **Conclusion** | **PASS** or **FAIL** |

If **FAIL**: report each `business_id` that has `archived_at IS NOT NULL` and still appears in `accounting_invariant_failures` for this run.

---

## Automated run (this environment)

In this environment, Supabase URL and service role key were not available, so the script exited before calling the DB. Run the script or manual SQL in an environment where Supabase is configured to get the actual summary and PASS/FAIL.
