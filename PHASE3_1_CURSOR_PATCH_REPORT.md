# Phase 3.1 Patch — Fix General Ledger Cursor (Remove running_balance)

**Date:** 2024-01-XX  
**Scope:** Keyset pagination cursor fix  
**Mode:** CONTROLLED BATCH (no drift)

---

## EXECUTIVE SUMMARY

Fixed General Ledger pagination cursor to be deterministic and audit-safe by removing `running_balance` from cursor parameters. Cursor now uses only stable identifiers: `(entry_date, journal_entry_id, line_id)`.

**Changes:**
- Removed `p_cursor_running_balance` parameter from database function
- Updated ORDER BY to match cursor tuple exactly: `entry_date ASC, journal_entry_id ASC, line_id ASC`
- Removed `cursor_running_balance` from API query parameters and response
- Updated UI to store and send only `(entry_date, journal_entry_id, line_id)` in cursor
- Updated tests to assert cursor stability based only on `(entry_date, journal_entry_id, line_id)`

---

## PART 1: DATABASE FUNCTION FIX

### File: `supabase/migrations/140_phase3_1_report_function_optimization.sql`

#### Changes Made:

1. **Removed `p_cursor_running_balance` parameter:**
   ```sql
   -- BEFORE:
   CREATE OR REPLACE FUNCTION get_general_ledger_paginated(
     ...,
     p_cursor_running_balance NUMERIC DEFAULT NULL
   )
   
   -- AFTER:
   CREATE OR REPLACE FUNCTION get_general_ledger_paginated(
     ...,
     -- REMOVED: p_cursor_running_balance NUMERIC DEFAULT NULL
   )
   ```

2. **Removed unused variable:**
   ```sql
   -- REMOVED: v_cursor_balance NUMERIC;
   ```

3. **Fixed ORDER BY to match cursor tuple exactly:**
   ```sql
   -- Window function ORDER BY (for running balance calculation):
   ORDER BY date ASC, journal_entry_id ASC, line_id ASC
   
   -- Cursor filter ORDER BY:
   ORDER BY date ASC, journal_entry_id ASC, line_id ASC
   
   -- Final SELECT ORDER BY:
   ORDER BY date ASC, journal_entry_id ASC, line_id ASC
   ```

4. **Cleaned up unused columns:**
   - Removed `journal_created_at` and `line_created_at` from CTEs (not needed for ORDER BY)

5. **Updated function comment:**
   ```sql
   COMMENT ON FUNCTION get_general_ledger_paginated IS '...Cursor: (entry_date, journal_entry_id, line_id) - deterministic and audit-safe. ORDER BY: entry_date ASC, journal_entry_id ASC, line_id ASC (matches cursor tuple)...';
   ```

#### Verification:

- **Cursor tuple:** `(entry_date, journal_entry_id, line_id)` ✅
- **ORDER BY matches cursor:** `entry_date ASC, journal_entry_id ASC, line_id ASC` ✅
- **No running_balance in cursor:** ✅
- **Cursor WHERE clause matches ORDER BY:** ✅

---

## PART 2: API ENDPOINT FIX

### File: `app/api/accounting/reports/general-ledger/route.ts`

#### Changes Made:

1. **Removed `cursor_running_balance` from query parameters:**
   ```typescript
   // BEFORE:
   const cursorRunningBalance = searchParams.get("cursor_running_balance")
   
   // AFTER:
   // REMOVED: const cursorRunningBalance = searchParams.get("cursor_running_balance")
   ```

2. **Removed `cursor_running_balance` from RPC call:**
   ```typescript
   // BEFORE:
   const { data, error } = await supabase.rpc("get_general_ledger_paginated", {
     ...,
     p_cursor_running_balance: cursorRunningBalance ? parseFloat(cursorRunningBalance) : null,
   })
   
   // AFTER:
   const { data, error } = await supabase.rpc("get_general_ledger_paginated", {
     ...,
     // REMOVED: p_cursor_running_balance: ...
   })
   ```

3. **Removed `running_balance` from `nextCursor` response:**
   ```typescript
   // BEFORE:
   const nextCursor = hasMore && ledgerLines && ledgerLines.length > 0 
     ? {
         entry_date: ...,
         journal_entry_id: ...,
         line_id: ...,
         running_balance: ...,  // REMOVED
       }
     : null
   
   // AFTER:
   const nextCursor = hasMore && ledgerLines && ledgerLines.length > 0 
     ? {
         entry_date: ledgerLines[ledgerLines.length - 1].entry_date,
         journal_entry_id: ledgerLines[ledgerLines.length - 1].journal_entry_id,
         line_id: ledgerLines[ledgerLines.length - 1].line_id,
         // REMOVED: running_balance
       }
     : null
   ```

4. **Updated API documentation comment:**
   ```typescript
   /**
    * ...
    * - cursor_entry_date (optional) - for pagination: entry_date of last row
    * - cursor_journal_entry_id (optional) - for pagination: journal_entry_id of last row
    * - cursor_line_id (optional) - for pagination: line_id of last row
    * REMOVED: - cursor_running_balance (optional) - for pagination: running_balance of last row
    * 
    * Response (paginated):
    * - pagination: { limit, has_more, next_cursor: { entry_date, journal_entry_id, line_id } } | null
    * ...
    */
   ```

#### Verification:

- **Query parameters:** Only `cursor_entry_date`, `cursor_journal_entry_id`, `cursor_line_id` ✅
- **RPC call:** No `p_cursor_running_balance` parameter ✅
- **Response nextCursor:** Only `entry_date`, `journal_entry_id`, `line_id` ✅

---

## PART 3: UI FIX

### File: `app/accounting/reports/general-ledger/page.tsx`

#### Changes Made:

1. **Removed `running_balance` from cursor type:**
   ```typescript
   // BEFORE:
   const [nextCursor, setNextCursor] = useState<{
     entry_date: string
     journal_entry_id: string
     line_id: string
     running_balance: number  // REMOVED
   } | null>(null)
   
   // AFTER:
   const [nextCursor, setNextCursor] = useState<{
     entry_date: string
     journal_entry_id: string
     line_id: string
     // REMOVED: running_balance: number
   } | null>(null)
   ```

2. **Removed `cursor_running_balance` from URL:**
   ```typescript
   // BEFORE:
   if (!reset && nextCursor) {
     url += `&cursor_entry_date=${...}&cursor_journal_entry_id=${...}&cursor_line_id=${...}&cursor_running_balance=${nextCursor.running_balance}`
   }
   
   // AFTER:
   if (!reset && nextCursor) {
     url += `&cursor_entry_date=${nextCursor.entry_date}&cursor_journal_entry_id=${nextCursor.journal_entry_id}&cursor_line_id=${nextCursor.line_id}`
     // REMOVED: &cursor_running_balance=${nextCursor.running_balance}
   }
   ```

#### Verification:

- **Cursor type:** Only `entry_date`, `journal_entry_id`, `line_id` ✅
- **URL building:** No `cursor_running_balance` parameter ✅
- **Load More:** Still works (uses corrected cursor) ✅

---

## PART 4: TESTS UPDATE

### File: `lib/accountingPeriods/__tests__/phase3_1_pagination.test.ts`

#### Changes Made:

1. **Updated Test 3.1.1:** Added assertion that cursor only contains `(entry_date, journal_entry_id, line_id)`
2. **Updated Test 3.1.2:** Explicitly verifies cursor stability based only on `(entry_date, journal_entry_id, line_id)` with no `running_balance`
3. **Updated Test 3.1.5:** Explicitly verifies ORDER BY matches cursor tuple: `entry_date ASC, journal_entry_id ASC, line_id ASC`
4. **Updated Test 3.1.6:** Clarifies that cursor does NOT include `running_balance`, but running balance is still calculated correctly

#### Key Assertions:

- ✅ Cursor only contains: `(entry_date, journal_entry_id, line_id)`
- ✅ No `running_balance` in cursor
- ✅ ORDER BY matches cursor tuple exactly: `entry_date ASC, journal_entry_id ASC, line_id ASC`
- ✅ No duplicates across pages
- ✅ No gaps across pages
- ✅ Cursor stability relies only on `(entry_date, journal_entry_id, line_id)`

---

## PART 5: VERIFICATION

### Cursor Structure Confirmation

**Before Fix:**
```typescript
{
  entry_date: string
  journal_entry_id: string
  line_id: string
  running_balance: number  // ❌ Computed value, not stable
}
```

**After Fix:**
```typescript
{
  entry_date: string
  journal_entry_id: string
  line_id: string
  // ✅ Only stable identifiers
}
```

### ORDER BY Confirmation

**Before Fix:**
```sql
ORDER BY date ASC, journal_created_at ASC, line_created_at ASC
-- Cursor: (date, journal_entry_id, line_id) - MISMATCH!
```

**After Fix:**
```sql
ORDER BY date ASC, journal_entry_id ASC, line_id ASC
-- Cursor: (entry_date, journal_entry_id, line_id) - MATCHES!
```

### Keyset WHERE Clause Confirmation

**Before Fix:**
```sql
WHERE (
  (date > p_cursor_entry_date) OR
  (date = p_cursor_entry_date AND journal_entry_id > p_cursor_journal_entry_id) OR
  (date = p_cursor_entry_date AND journal_entry_id = p_cursor_journal_entry_id AND line_id > p_cursor_line_id)
)
-- ✅ Already correct (matches cursor tuple)
```

**After Fix:**
```sql
WHERE (
  (date > p_cursor_entry_date) OR
  (date = p_cursor_entry_date AND journal_entry_id > p_cursor_journal_entry_id) OR
  (date = p_cursor_entry_date AND journal_entry_id = p_cursor_journal_entry_id AND line_id > p_cursor_line_id)
)
-- ✅ Unchanged (already matched cursor tuple, just removed running_balance parameter)
```

---

## FILES CHANGED

1. **`supabase/migrations/140_phase3_1_report_function_optimization.sql`**
   - Removed `p_cursor_running_balance` parameter
   - Fixed ORDER BY to match cursor tuple: `entry_date ASC, journal_entry_id ASC, line_id ASC`
   - Removed unused variables and columns
   - Updated function comment

2. **`app/api/accounting/reports/general-ledger/route.ts`**
   - Removed `cursor_running_balance` from query parameters
   - Removed `p_cursor_running_balance` from RPC call
   - Removed `running_balance` from `nextCursor` response
   - Updated API documentation comment

3. **`app/accounting/reports/general-ledger/page.tsx`**
   - Removed `running_balance` from cursor type definition
   - Removed `cursor_running_balance` from URL building
   - Cursor state now only contains: `(entry_date, journal_entry_id, line_id)`

4. **`lib/accountingPeriods/__tests__/phase3_1_pagination.test.ts`**
   - Updated tests to assert cursor only uses `(entry_date, journal_entry_id, line_id)`
   - Updated tests to verify ORDER BY matches cursor tuple
   - Clarified that cursor does NOT include `running_balance`

---

## FINAL CONFIRMATION

### ✅ Cursor Fields

**Current cursor fields (after fix):**
- ✅ `entry_date` (DATE) - Stable identifier
- ✅ `journal_entry_id` (UUID) - Stable identifier
- ✅ `line_id` (UUID) - Stable identifier (unique)
- ❌ `running_balance` - REMOVED (computed value, not stable)

### ✅ ORDER BY Matches Cursor Tuple

**ORDER BY (all places):**
```sql
ORDER BY entry_date ASC, journal_entry_id ASC, line_id ASC
```

**Cursor tuple:**
```
(entry_date, journal_entry_id, line_id)
```

**Match:** ✅ Perfect match - ORDER BY fields exactly match cursor tuple in same order

### ✅ Keyset WHERE Clause

**WHERE clause matches cursor tuple:**
```sql
WHERE (
  (date > p_cursor_entry_date) OR
  (date = p_cursor_entry_date AND journal_entry_id > p_cursor_journal_entry_id) OR
  (date = p_cursor_entry_date AND journal_entry_id = p_cursor_journal_entry_id AND line_id > p_cursor_line_id)
)
```

**Match:** ✅ WHERE clause filters correctly using cursor tuple `(entry_date, journal_entry_id, line_id)`

### ✅ Deterministic and Audit-Safe

- **Cursor uses only stable identifiers:** ✅ `(entry_date, journal_entry_id, line_id)` - all are immutable primary/foreign keys
- **No computed values in cursor:** ✅ `running_balance` removed (it's a computed value)
- **ORDER BY matches cursor tuple:** ✅ Perfect alignment
- **Keyset pagination is deterministic:** ✅ Same cursor always returns same next page
- **No gaps or duplicates:** ✅ Guaranteed by keyset pagination with stable identifiers

---

## TESTING VERIFICATION

### Pagination Correctness Tests

1. **Test 3.1.1:** Page 1 + Page 2 equals unpaginated result
   - ✅ Cursor only contains `(entry_date, journal_entry_id, line_id)`
   - ✅ Combined pages match unpaginated result
   - ✅ ORDER BY matches cursor tuple

2. **Test 3.1.2:** Cursor stability
   - ✅ Cursor only contains `(entry_date, journal_entry_id, line_id)` - no `running_balance`
   - ✅ Next page starts exactly after cursor position
   - ✅ No duplicates, no gaps

3. **Test 3.1.5:** Ordering deterministic
   - ✅ ORDER BY: `entry_date ASC, journal_entry_id ASC, line_id ASC`
   - ✅ Cursor tuple matches ORDER BY exactly
   - ✅ Consistent ordering across pages

### Edge Cases

- ✅ Empty result set: Cursor is null
- ✅ Single page result: Cursor is null, has_more = false
- ✅ Invalid cursor: Handled gracefully (returns from start or empty result)

---

## KNOWN BEHAVIOR

### Running Balance Calculation

**Note:** Running balance is still calculated correctly, but it's NOT part of the cursor. This means:

- **First page:** Calculates running balance by processing all rows up to first 100 rows
- **Subsequent pages:** Calculates running balance by processing all rows up to cursor position

**Why:** Running balance requires all previous rows for correctness. Since we removed it from the cursor, the function recalculates it from the beginning for each page. This is acceptable for correctness, even if slower for very large datasets.

**Alternative (future enhancement):** Calculate running balance client-side by maintaining state, or use materialized running balance column.

---

## OUTPUT SUMMARY

### 1. Files Changed
- ✅ `supabase/migrations/140_phase3_1_report_function_optimization.sql`
- ✅ `app/api/accounting/reports/general-ledger/route.ts`
- ✅ `app/accounting/reports/general-ledger/page.tsx`
- ✅ `lib/accountingPeriods/__tests__/phase3_1_pagination.test.ts`

### 2. Cursor Fields Confirmed
- ✅ Cursor now only contains: `(entry_date, journal_entry_id, line_id)`
- ✅ No `running_balance` in cursor
- ✅ All fields are stable identifiers (immutable)

### 3. ORDER BY Matches Cursor Tuple
- ✅ ORDER BY: `entry_date ASC, journal_entry_id ASC, line_id ASC`
- ✅ Cursor tuple: `(entry_date, journal_entry_id, line_id)`
- ✅ Perfect match - same fields in same order

### 4. Final Confirmation
- ✅ Ledger-only (no Service Mode/tax engine touched)
- ✅ Read-only (no writes, no mutations)
- ✅ Deterministic (same cursor = same next page)
- ✅ Audit-safe (stable identifiers only, no computed values)
- ✅ No gaps or duplicates (keyset pagination guarantees)

---

**END OF PATCH REPORT**

Phase 3.1 Cursor Fix - COMPLETE ✅
