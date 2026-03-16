# CURSOR PROMPT — NEW BUSINESS ACCOUNTING TEST + LIVE DB VERIFICATION

## Goal
I created a NEW business. I need an exact test script + LIVE DB SQL verification for:
- Posting idempotency (payments, sale/refund/void)
- Supplier payments AP mapping (control key 'AP')
- Reconciliation posting duplicate-safety (proposal_hash deterministic + advisory lock)
- Balance sheet correctness (AP movement + snapshot vs ledger)

## Constraints
- Ledger immutable.
- No post_journal_entry contract changes.
- Minimal diffs only to fix verification blockers.

---

# A) LIVE DB — Confirm deployed function definitions

## A1) Payment posting (idempotency + advisory lock)
Run:
```sql
SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args, pg_get_functiondef(p.oid) AS def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('post_payment_to_ledger','post_invoice_payment_to_ledger');
```

PASS: In BOTH payment functions, def contains:

* pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_payment_id::text))
* SELECT ... FROM journal_entries WHERE reference_type='payment' AND reference_id = p_payment_id ... RETURN existing id

## A2) Sale / Refund / Void posting (idempotency + advisory lock)

Run:

```sql
SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args, pg_get_functiondef(p.oid) AS def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('post_sale_to_ledger','post_sale_refund_to_ledger','post_sale_void_to_ledger');
```

PASS:

* Each function contains pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_sale_id::text))
* Each re-checks journal_entries under lock for reference_type in ('sale','refund','void') and reference_id = p_sale_id and returns existing JE id

## A3) Supplier payment AP mapping (must use control mapping)

Run:

```sql
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='post_supplier_payment_to_ledger';
```

PASS: contains:

* get_control_account_code(business_id_val, 'AP')
* get_account_by_control_key(business_id_val, 'AP')
  FAIL if AP resolution uses hardcoded '2000'.

## A4) Reconciliation posting lock key (MUST use business_id, not scope_id)

Run:

```sql
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='post_reconciliation_journal_entry';
```

PASS:

* pg_advisory_xact_lock(hashtext(p_business_id::text), hashtext(p_proposal_hash))
  FAIL:
* lock uses p_scope_id in the first key.

If FAIL, create a minimal migration that ONLY changes the lock line to use p_business_id and keeps idempotency SELECT/early return intact.

---

# B) NEW BUSINESS — Manual test script (UI)

1. Confirm AP control map exists:

* chart_of_accounts_control_map row where control_key='AP' for this business.

2. Create a Bill (bills module)

* Set to Open/Posted so trigger fires.
  Expected JE: reference_type='bill', reference_id=bill_id
  Lines: Dr expense (+tax), Cr AP(control)

3. Pay the Bill (bill_payments module)
   Expected JE: reference_type='bill_payment'
   Lines: Dr AP(control), Cr payment account

4. Create a Supplier Payment (supplier_payments module)
   Expected JE: reference_type='supplier_payment'
   Lines: Dr AP(control), Cr payment account

5. Balance Sheet for the period
   Expected: AP increases after bill, decreases after payments, matches trial balance.

---

# C) LIVE DB — Proof queries (PASS criteria)

## C1) Duplicate JE proofs (PASS = 0 rows)

```sql
-- payment duplicates
SELECT reference_id, COUNT(*) cnt
FROM journal_entries
WHERE reference_type='payment'
GROUP BY reference_id HAVING COUNT(*)>1;

-- sale/refund/void duplicates
SELECT reference_type, reference_id, COUNT(*) cnt
FROM journal_entries
WHERE reference_type IN ('sale','refund','void')
GROUP BY reference_type, reference_id HAVING COUNT(*)>1;

-- reconciliation duplicates
SELECT reference_id, COUNT(*) cnt
FROM journal_entries
WHERE reference_type='reconciliation'
GROUP BY reference_id HAVING COUNT(*)>1;
```

## C2) Supplier_payment debits AP(control) (PASS = 0 rows)

```sql
WITH ap AS (
  SELECT business_id, account_code AS ap_code
  FROM chart_of_accounts_control_map
  WHERE control_key='AP'
),
spd AS (
  SELECT je.business_id, je.reference_id, a.code AS debit_code
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.journal_entry_id=je.id AND jel.debit>0
  JOIN accounts a ON a.id=jel.account_id
  WHERE je.reference_type='supplier_payment'
)
SELECT spd.*, ap.ap_code
FROM spd JOIN ap USING (business_id)
WHERE spd.debit_code IS DISTINCT FROM ap.ap_code;
```

## C3) Snapshot vs ledger AP for a period (PASS diff ~ 0)

Replace `:business_id` and `:period_id` as needed.

```sql
WITH ap_code AS (
  SELECT business_id, account_code
  FROM chart_of_accounts_control_map
  WHERE control_key='AP' AND business_id = :business_id
),
ledger_ap AS (
  SELECT SUM(COALESCE(jel.credit, 0) - COALESCE(jel.debit, 0)) AS bal
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounting_periods ap ON ap.id = :period_id AND ap.business_id = je.business_id
  JOIN ap_code ac ON ac.business_id = je.business_id
  JOIN accounts a ON a.id = jel.account_id AND a.business_id = ac.business_id AND a.code = ac.account_code
  WHERE je.date >= ap.period_start AND je.date <= ap.period_end
),
snapshot_ap AS (
  SELECT (elem->>'closing_balance')::NUMERIC AS bal
  FROM trial_balance_snapshots tbs,
       jsonb_array_elements(tbs.snapshot_data) AS elem
  WHERE tbs.period_id = :period_id
    AND tbs.business_id = :business_id
    AND elem->>'account_code' = (SELECT account_code FROM ap_code LIMIT 1)
)
SELECT l.bal AS ledger_ap_balance, s.bal AS snapshot_ap_balance,
       ABS(COALESCE(l.bal, 0) - COALESCE(s.bal, 0)) AS diff
FROM ledger_ap l
CROSS JOIN snapshot_ap s;
```

**PASS:** diff = 0 (or &lt; 0.01). If snapshot is missing, run `SELECT generate_trial_balance(:period_id, NULL);` then re-run.

---

# D) Fix-only-if-failing

* If A4 fails (lock uses scope_id): create minimal migration to replace ONLY the lock line.
* If AP consistency fails: ensure migration 264 applied; do not redesign.
* If balance sheet mismatch: determine if snapshot stale; if so, regenerate snapshot for the period and re-check.
  Return failing evidence + minimal diff only.

---

## One instruction (important)

When you run the reconciliation function check, you already proved the DB currently uses **scope_id** in the lock. So expect **A4 to fail** until you deploy the migration that swaps it to **business_id**.
