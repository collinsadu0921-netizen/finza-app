-- ============================================================================
-- Proof: No duplicate JEs for sale / refund / void (run after migration 259 applied)
-- Expect 0 rows from each query. Any row = duplicate(s) for that reference_type.
-- ============================================================================

-- Sale duplicates (one sale_id → one JE with reference_type='sale')
SELECT reference_id AS sale_id, COUNT(*) AS cnt
FROM journal_entries
WHERE reference_type = 'sale'
GROUP BY reference_id
HAVING COUNT(*) > 1;

-- Refund duplicates (one sale_id refund → one JE with reference_type='refund')
SELECT reference_id AS sale_id, COUNT(*) AS cnt
FROM journal_entries
WHERE reference_type = 'refund'
GROUP BY reference_id
HAVING COUNT(*) > 1;

-- Void duplicates (one sale_id void → one JE with reference_type='void')
SELECT reference_id AS sale_id, COUNT(*) AS cnt
FROM journal_entries
WHERE reference_type = 'void'
GROUP BY reference_id
HAVING COUNT(*) > 1;
