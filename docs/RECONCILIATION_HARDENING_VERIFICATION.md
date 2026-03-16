# Reconciliation Hardening Verification

Prove reconciliation resolve is duplicate-safe. Run all steps against the **live database** (source of truth). No redesign; minimal diffs; only fix what blocks verification.

---

## A) Confirm DB has the hardened function (source-of-truth = database)

### A1) Fetch live definitions

Run in SQL (e.g. Supabase SQL Editor):

```sql
-- post_reconciliation_journal_entry (full definition)
SELECT pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'post_reconciliation_journal_entry'
  AND array_length(p.proargtypes::oid[], 1) = 9;

-- reconciliation_reference_id_from_hash (full definition)
SELECT pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'reconciliation_reference_id_from_hash';
```

### A2) Verify post_reconciliation_journal_entry contains

In the definition string from A1, confirm:

| Requirement | Search for in definition |
|-------------|---------------------------|
| Advisory lock | `pg_advisory_xact_lock(hashtext(p_business_id::text), hashtext(p_proposal_hash))` |
| Existing JE lookup | `journal_entries` and `reference_type = 'reconciliation'` and `reference_id = v_ref_id` |
| Early return under lock | `existing_je_id IS NOT NULL` and `RETURN NEXT` / `RETURN` before any `post_journal_entry` call |

### A3) Verify reconciliation_reference_id_from_hash uses extensions schema

In the definition from A1 for `reconciliation_reference_id_from_hash`, confirm:

- Contains `extensions.uuid_generate_v5` (not `uuid_ossp.uuid_generate_v5`).

---

## B) Prove no duplicates exist

```sql
SELECT reference_id, COUNT(*)
FROM journal_entries
WHERE reference_type = 'reconciliation'
GROUP BY reference_id
HAVING COUNT(*) > 1;
```

**Pass:** Query returns **0 rows**.

---

## C) Verify optional unique index status

### C1) Check whether uniq_reconciliation_reference exists and is valid

```sql
SELECT
  c.relname AS index_name,
  i.indisunique AS is_unique,
  pg_get_expr(i.indpred, i.indrelid) AS partial_condition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'uniq_reconciliation_reference';
```

**If the index exists:**

- `is_unique` should be `true`.
- `partial_condition` should be `(reference_type = 'reconciliation'::text)` (or equivalent), confirming it is partial.

### C2) If index does not exist: show whether duplicates prevented creation

```sql
-- Duplicates that would prevent migration 262 from creating the index
SELECT reference_id, COUNT(*) AS cnt
FROM journal_entries
WHERE reference_type = 'reconciliation'
GROUP BY reference_id
HAVING COUNT(*) > 1;
```

If this returns any rows, migration 262 correctly **skipped** creating the index (condition in 262 only creates when this query returns no rows).

---

## D) Endpoint double-call smoke test (idempotency at API surface)

1. **Setup:** One business/scope with a reconciliation mismatch; obtain a valid `proposal_hash` (e.g. from `GET /api/accounting/reconciliation/mismatches` or resolve flow).
2. **First call:** `POST /api/accounting/reconciliation/resolve` with body including that `proposal_hash` (and required businessId, scopeType, scopeId, proposed_fix, clientSeen, approvals as needed). Note the response `journal_entry_id` and, if exposed, `reference_id` (or derive it from the resolution record).
3. **Second call:** Same request again (same `proposal_hash`, same context).
4. **Confirm:**
   - Both responses return the **same** `journal_entry_id`.
   - Only **one** row in `journal_entries` for that reconciliation.

### Evidence query after double-call

Use the `journal_entry_id` (or `reference_id`) from the response:

```sql
-- Replace <journal_entry_id> with the id returned by both calls
SELECT id, reference_type, reference_id, business_id, date, description
FROM journal_entries
WHERE id = '<journal_entry_id>';

-- Count rows for this reference_id (must be 1)
SELECT reference_id, COUNT(*) AS cnt
FROM journal_entries
WHERE reference_type = 'reconciliation'
  AND reference_id = (SELECT reference_id FROM journal_entries WHERE id = '<journal_entry_id>')
GROUP BY reference_id;
```

**Pass:** One row for that `id`; `cnt = 1` for that `reference_id`.

---

## E) PASS/FAIL checklist (evidence snippets)

Fill after running the steps above.

| # | Check | Pass/Fail | Evidence snippet |
|---|--------|-----------|-------------------|
| 1 | **Lock present** | ☐ PASS / ☐ FAIL | Definition contains: `pg_advisory_xact_lock(hashtext(p_business_id::text), hashtext(p_proposal_hash))` |
| 2 | **Deterministic ref_id** | ☐ PASS / ☐ FAIL | `reconciliation_reference_id_from_hash` definition contains: `extensions.uuid_generate_v5` |
| 3 | **Re-check + early return** | ☐ PASS / ☐ FAIL | Definition contains: `existing_je_id`, `journal_entries` + `reference_type = 'reconciliation'` + `reference_id = v_ref_id`, and return before `post_journal_entry` |
| 4 | **Duplicates query = 0 rows** | ☐ PASS / ☐ FAIL | Result of B query: _____ rows |
| 5 | **Unique index** | ☐ PASS / ☐ FAIL | Index exists and is partial **OR** intentionally skipped (duplicates present: _____) |
| 6 | **Double-call same JE id** | ☐ PASS / ☐ FAIL | Both calls returned journal_entry_id = _____, count for that reference_id = 1 |

**Overall:** All six checks must be PASS for verification to succeed.
