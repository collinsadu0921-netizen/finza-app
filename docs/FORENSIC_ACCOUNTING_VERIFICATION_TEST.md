# Forensic accounting verification — test instructions

## 1. Apply migration

```bash
cd finza-web && npx supabase db push
# Or: supabase migration up
```

## 2. Set CRON_SECRET

In `.env.local` (or deployment env):

```
CRON_SECRET=your-secret-token
```

## 3. Call the endpoint

**Authorized (200):**

```bash
curl -X POST http://localhost:3000/api/cron/forensic-accounting-verification \
  -H "Authorization: Bearer your-secret-token"
```

Expected: `{ "run_id": "<uuid>", "summary": { "total_failures", "alertable_failures", "check_counts" } }`

**Unauthorized (401):**

```bash
curl -X POST http://localhost:3000/api/cron/forensic-accounting-verification
# No header or wrong token → 401
```

## 4. Inspect results

- **Runs:** `SELECT * FROM accounting_invariant_runs ORDER BY started_at DESC LIMIT 5;`
- **Failures:** `SELECT * FROM accounting_invariant_failures WHERE run_id = '<run_id>';`

## 5. Optional: trigger an alertable failure

- **period_id_null:** Insert a row into `journal_entries` with `period_id = NULL` (if allowed by constraints), then run verification; expect one failure for `period_id_null`.
- **je_imbalanced:** Manually insert into `journal_entry_lines` a line that makes one journal entry’s sum(debit) ≠ sum(credit) (requires bypassing app constraints or using SQL), then run verification; expect one failure for `je_imbalanced`.

After testing, fix or remove the test data and re-run to confirm clean run.
