# Forensic Capture Guide: journal_lines Payload Evidence

**Purpose:** Capture the exact `journal_lines` JSONB payload passed to `post_journal_entry()` for TEST A, B, and C.

---

## Current Status

**Known Issues:**
- All three tests FAILED
- TEST A & C: Credit total = 0 (credits lost)
- TEST B: Credit = 116.66 (incorrect calculation)
- `journal_lines_jsonb` was NULL in test results
- Need to verify if debug logging is actually executing

---

## Diagnostic Process

### Step 1: Verify Debug Logging Status

**Run:** `DIAGNOSTIC_DEBUG_LOG_CAPTURE.sql` → Section 1 & 6

**Check:**
- ✅ Does `retail_posting_debug_log` table exist?
- ✅ How many records are in the table?
- ✅ Does `post_sale_to_ledger()` have debug logging code?

**Expected Results:**
- Table should exist (created in migration 181)
- Should have some records if tests ran
- Function should have INSERT INTO retail_posting_debug_log code (migration 182)

**If Debug Logging is Missing:**
- Function definition may have been overwritten
- Need to add temporary diagnostic logging (see below)

---

### Step 2: Query Debug Log for Test Evidence

**Run:** `DIAGNOSTIC_DEBUG_LOG_CAPTURE.sql` → Sections 2, 3, 4

**What to Look For:**
- Recent entries (last 2 hours)
- Entries with `journal_lines IS NOT NULL`
- Entries matching TEST A/B/C sale descriptions
- Credit sums: Should be 100.00, not 0 or 116.66

**Capture:**
- Exact `journal_lines` JSONB for each test
- `debit_sum` and `credit_sum` values
- `line_count` - how many lines in the array

---

### Step 3: Get Exact journal_lines JSONB Payloads

**For each failing test, you need:**

1. **TEST A (Canonical structure):**
   - Full JSONB array
   - Should have: Cash debit, Revenue credit, Tax credit
   - Check: Are credit values actually in the JSONB?

2. **TEST B (Parsed tax_lines only):**
   - Full JSONB array
   - Should have: Cash debit, Revenue credit, Tax credit
   - Check: Why is credit sum 116.66?

3. **TEST C (NULL tax_lines):**
   - Full JSONB array (if it exists - shouldn't)
   - If it exists, shows NULL validation not working
   - Check: What was built despite NULL tax_lines?

---

### Step 4: Line-by-Line Analysis

**Run:** `DIAGNOSTIC_DEBUG_LOG_CAPTURE.sql` → Section 5

**For each line in journal_lines, verify:**
- `account_id` is present
- `debit` value (if debit line)
- `credit` value (if credit line)
- One should have debit, another should have credit

**Critical Check:**
- Are credit values **in the JSONB** but lost during insertion?
- Or are credit values **missing from JSONB** construction?

---

## If Debug Logging Is Not Working

**Check Function Definition:**
- Run Section 6 of diagnostic script
- Verify `post_sale_to_ledger()` has INSERT INTO retail_posting_debug_log

**If Missing:**
- Function may have been overwritten by later migration
- Need to verify which version is active
- May need to add temporary diagnostic logging

---

## Expected journal_lines Structure

### TEST A (Canonical):
```json
[
  {
    "account_id": "<cash_account_uuid>",
    "debit": 100.00,
    "description": "Sale receipt"
  },
  {
    "account_id": "<revenue_account_uuid>",
    "credit": 83.34,
    "description": "Sales revenue"
  },
  {
    "account_id": "<tax_account_uuid>",
    "credit": 16.66,
    "description": "VAT tax"
  }
]
```

**Expected totals:**
- Debit sum: 100.00
- Credit sum: 100.00
- Line count: 3

### TEST B (Parsed only):
Should be similar structure, but credit calculation may differ.

### TEST C (NULL):
Should NOT exist (function should fail before building journal_lines).

---

## What This Evidence Will Tell Us

1. **If credits are in JSONB but not in table:**
   - Problem is in `post_journal_entry()` INSERT loop
   - JSONB extraction issue despite migration 184
   - NULL handling issue in INSERT

2. **If credits are missing from JSONB:**
   - Problem is in `post_sale_to_ledger()` journal_lines construction
   - Tax parsing issue
   - Revenue credit calculation issue

3. **If TEST B shows 116.66 in JSONB:**
   - Confirms calculation bug in `post_sale_to_ledger()`
   - Tax/revenue calculation is wrong

4. **If TEST C has journal_lines:**
   - Confirms NULL validation is broken
   - Function proceeds despite NULL tax_lines

---

## Next Steps After Capture

Once you have the `journal_lines` JSONB payloads:

1. **Document in:** `FINAL_VERIFICATION_REPORT.md` → "Captured journal_lines"
2. **Compare:** JSONB totals vs table totals vs error messages
3. **Identify:** Where credit values are being lost/incorrect
4. **Ready for:** Fix design phase

---

**All queries consolidated in:** `DIAGNOSTIC_DEBUG_LOG_CAPTURE.sql`
