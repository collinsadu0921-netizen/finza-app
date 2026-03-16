# Ground Truth Verification: Interpretation Guide

**Purpose:** Determine which exact versions of functions and triggers are active

---

## Section 1: Complete Function Definitions

**What to Look For:**

1. **Parameter Count:**
   - **14 parameters** = Migration 179+ (includes `posted_by_accountant_id`)
   - **10 parameters** = Migration 172 wrapper
   - **6 parameters** = Migration 043 (original)

2. **JSONB Extraction Method:**
   - **`(line->'debit')::NUMERIC`** = ✅ Safe (migration 184 applied)
   - **`(line->>'debit')::NUMERIC`** = ❌ Unsafe (migration 184 NOT applied)

**Expected Output:**
- Multiple rows if overloads exist
- Full function definition for each overload
- Check the 14-parameter version (most recent)

---

## Section 2: Key Function Characteristics

**This provides a quick check without reading full definitions.**

**Critical Indicators:**

| Indicator | Migration 184 Applied? | Migration 184 NOT Applied? |
|-----------|----------------------|---------------------------|
| `debit_extraction_method` | `SAFE (migration 184)` | `UNSAFE (pre-184)` |
| `credit_extraction_method` | `SAFE (migration 184)` | `UNSAFE (pre-184)` |
| `parameter_count` | `14` (migration 179+) | `6` or `10` (older) |

---

## Section 3: Critical Code Sections

**Extracts specific sections from the active function:**
- Balance validation loop
- JSONB extraction method used
- INSERT loop
- Exact code patterns

**What to Verify:**
- Does balance loop use `->` or `->>`?
- Does INSERT loop use `->` or `->>`?
- Are they consistent?

---

## Section 4: Complete Trigger Definition

**Provides full trigger metadata:**
- Trigger name
- Event (INSERT/UPDATE/DELETE)
- Timing (BEFORE/AFTER)
- **Action Orientation:** `ROW` vs `STATEMENT` (CRITICAL)
- Trigger function name
- Trigger function definition

**Critical Check:**
- `action_orientation = 'STATEMENT'` = ✅ Migration 185 applied
- `action_orientation = 'ROW'` = ❌ Migration 185 NOT applied

---

## Section 5: All Triggers on journal_entry_lines

**Lists all triggers (not just balance trigger):**
- Balance enforcement trigger
- Immutability trigger (prevents UPDATE/DELETE)
- Any other triggers

**Verify:**
- Which triggers exist
- Their trigger levels (ROW vs STATEMENT)
- Which one is the balance trigger

---

## Section 6: Trigger Function Definition

**Gets the actual trigger function code:**
- Function name
- Full definition
- Whether it loops through all entries or just NEW

**Key Indicators:**
- Function name contains `statement` = Migration 185
- Function loops through `SELECT DISTINCT journal_entry_id` = Statement-level version

---

## Section 7: post_sale_to_ledger Call Site

**Verifies which `post_journal_entry()` overload is called:**
- Parameter count in the call
- Whether it passes `posted_by_accountant_id`

**Expected:**
- Should call 14-parameter version
- Should pass `p_posted_by_accountant_id`

---

## Section 8: Summary - Migration Status

**Quick status check:**
- `post_journal_entry JSONB Extraction` status
- `Balance Trigger Level` status

**Possible Results:**

### JSONB Extraction:
- ✅ `Migration 184 APPLIED` - Safe extraction (`->`)
- ❌ `Migration 184 NOT APPLIED` - Unsafe extraction (`->>`)
- ❓ `Cannot determine` - Need manual inspection

### Balance Trigger:
- ✅ `Migration 185 APPLIED` - Statement-level trigger
- ❌ `Migration 185 NOT APPLIED` - Row-level trigger
- ❓ `Trigger not found` - Need investigation

---

## Section 9: Code Snippets for Manual Inspection

**Extracts specific code sections:**
- Balance validation loop (exact code)
- INSERT loop (exact code)

**Use for:**
- Manual verification of JSONB extraction method
- Confirming exact syntax used
- Comparing against migration files

---

## Interpretation Checklist

After running `GROUND_TRUTH_VERIFICATION.sql`, check:

- [ ] **JSONB Extraction Method:**
  - [ ] Uses `(line->'debit')` = Migration 184 applied ✅
  - [ ] Uses `(line->>'debit')` = Migration 184 NOT applied ❌

- [ ] **Trigger Level:**
  - [ ] `FOR EACH STATEMENT` = Migration 185 applied ✅
  - [ ] `FOR EACH ROW` = Migration 185 NOT applied ❌

- [ ] **Function Parameter Count:**
  - [ ] 14 parameters = Migration 179+ ✅
  - [ ] 6 or 10 parameters = Older version ❌

- [ ] **Consistency Check:**
  - [ ] All extraction points use same method (`->` or `->>`)
  - [ ] Balance loop and INSERT loop match

---

## Expected Outcomes

### Scenario A: Both Migrations Applied
- JSONB extraction: `->` (safe)
- Trigger level: `STATEMENT`
- **Status:** Ready to verify test results

### Scenario B: Migration 184 NOT Applied
- JSONB extraction: `->>` (unsafe)
- Trigger level: May be STATEMENT or ROW
- **Status:** Migration 184 must be applied first

### Scenario C: Migration 185 NOT Applied
- JSONB extraction: May be safe or unsafe
- Trigger level: `ROW` (problematic)
- **Status:** Migration 185 must be applied first

### Scenario D: Neither Migration Applied
- JSONB extraction: `->>` (unsafe)
- Trigger level: `ROW` (problematic)
- **Status:** Both migrations must be applied

---

## Next Steps Based on Results

1. **If migrations are applied:**
   - Proceed with test execution
   - Verify test results match expectations

2. **If migrations are NOT applied:**
   - **STOP** - Do not proceed with test execution
   - Apply missing migrations first
   - Re-run verification after applying

3. **If status is unclear:**
   - Inspect Section 9 code snippets manually
   - Compare against migration file contents
   - Resolve ambiguity before proceeding

---

**Ready to Run:** Execute `GROUND_TRUTH_VERIFICATION.sql` and interpret results using this guide
