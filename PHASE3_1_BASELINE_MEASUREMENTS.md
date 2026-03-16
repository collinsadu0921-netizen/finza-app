# Phase 3.1 Baseline Performance Measurements

**Date:** 2024-01-XX  
**Purpose:** Establish baseline query performance before optimization

## Measurement Approach

Before optimization, run `EXPLAIN (ANALYZE, BUFFERS)` on the report functions to identify:
- Sequential scans vs index scans
- Join strategies
- Query execution times
- Buffer hit ratios

## Test Scenarios

### 1. Trial Balance - 1 Year Range
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM get_trial_balance(
  'business-uuid-here'::UUID,
  '2023-01-01'::DATE,
  '2023-12-31'::DATE
);
```

**Expected Issues:**
- LEFT JOIN from accounts to journal_entry_lines may scan all lines
- Date filtering may not use optimal index
- GROUP BY may be inefficient without proper indexes

### 2. General Ledger - High Activity Account (1 Year)
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM get_general_ledger(
  'business-uuid-here'::UUID,
  'account-uuid-here'::UUID,
  '2023-01-01'::DATE,
  '2023-12-31'::DATE
);
```

**Expected Issues:**
- Join from journal_entry_lines to journal_entries may be inefficient
- Window function for running balance may be slow on large datasets
- Ordering by date + created_at may require sort operation

## Baseline Measurements (To Be Recorded)

### Trial Balance
- **Execution Time:** TBD ms
- **Sequential Scans:** TBD
- **Index Scans:** TBD
- **Rows Examined:** TBD
- **Rows Returned:** TBD (typically ~100-500 accounts)

### General Ledger
- **Execution Time:** TBD ms
- **Sequential Scans:** TBD
- **Index Scans:** TBD
- **Rows Examined:** TBD
- **Rows Returned:** TBD (can be 10,000+ for high-activity accounts)

## Notes

- These measurements should be taken on a production-like dataset
- Buffer cache should be warmed before measurements
- Multiple runs should be averaged for consistency

## After Optimization

Re-run the same EXPLAIN ANALYZE queries and compare:
- Execution time improvement
- Index scan usage improvement
- Sequential scan reduction
- Buffer hit ratio improvement
