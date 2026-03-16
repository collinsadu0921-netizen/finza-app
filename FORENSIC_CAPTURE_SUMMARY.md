# Forensic Capture Summary: journal_lines Payload Evidence

**Status:** Ready to execute  
**Objective:** Capture exact `journal_lines` JSONB payloads for TEST A, B, and C

---

## Files Created

1. **`DIAGNOSTIC_DEBUG_LOG_CAPTURE.sql`**
   - Comprehensive diagnostic queries
   - Verifies debug logging is working
   - Captures journal_lines JSONB payloads
   - Line-by-line breakdown analysis

2. **`QUICK_CAPTURE_AFTER_TESTS.sql`**
   - Run immediately after TEST A/B/C
   - Quick queries for most recent entries
   - Multiple output formats for easy analysis

3. **`FORENSIC_CAPTURE_GUIDE.md`**
   - Step-by-step instructions
   - What to look for in results
   - Expected structure documentation

---

## Execution Steps

### Step 1: Verify Debug Logging Status

**Run:**
```sql
-- From DIAGNOSTIC_DEBUG_LOG_CAPTURE.sql, Sections 1 & 6
```

**Check:**
- ✅ Table exists and has records
- ✅ Function has debug logging code

**If missing:** Debug logging may not be active - function may have been overwritten.

---

### Step 2: Re-run TEST A / B / C

**Run:**
```sql
SELECT * FROM test_retail_ledger_null_credit_fix();
```

**Note:** Sale IDs or timestamps if visible in output.

---

### Step 3: Immediately Capture journal_lines

**Run:**
```sql
-- From QUICK_CAPTURE_AFTER_TESTS.sql
-- Option 1: Most recent entries
-- Option 2: JSONB as text (easy copy/paste)
```

**Capture:**
- Exact `journal_lines` JSONB for each test
- `debit_sum` and `credit_sum` values
- Line-by-line breakdown

---

### Step 4: Document Evidence

**Update:** `FINAL_VERIFICATION_REPORT.md` → "Captured journal_lines" section

**For each test, paste:**
- Raw JSONB payload (no editing)
- Summary stats (debit_sum, credit_sum, line_count)
- Line-by-line breakdown

---

## Critical Questions to Answer

1. **Are credit values IN the journal_lines JSONB?**
   - If YES → Problem is in `post_journal_entry()` INSERT
   - If NO → Problem is in `post_sale_to_ledger()` construction

2. **For TEST A:**
   - Is `credit` present in revenue line?
   - Is `credit` present in tax line?
   - What are the actual values?

3. **For TEST B:**
   - Why is credit_sum 116.66?
   - Is it in the JSONB or calculated incorrectly?
   - Which line has the wrong value?

4. **For TEST C:**
   - Does journal_lines exist? (Shouldn't if NULL validation works)
   - What was built despite NULL tax_lines?

---

## Expected Findings

### If Credits Are IN JSONB But Lost During Insert:
- JSONB shows correct credits (83.34 + 16.66 = 100.00)
- Table shows credit total = 0
- **Problem:** `post_journal_entry()` INSERT loop
- **Likely cause:** JSONB extraction or NULL handling in INSERT

### If Credits Are MISSING From JSONB:
- JSONB shows credits missing or NULL
- **Problem:** `post_sale_to_ledger()` construction
- **Likely cause:** Revenue credit calculation or tax parsing

### If TEST B Shows 116.66 in JSONB:
- Confirms calculation bug
- **Problem:** Tax/revenue math in `post_sale_to_ledger()`

---

## Success Criteria

✅ **Captured:** Exact journal_lines JSONB for TEST A, B, C  
✅ **Verified:** Where credits are being lost  
✅ **Documented:** Evidence in FINAL_VERIFICATION_REPORT.md  
✅ **Ready:** For fix design phase

---

**Next:** Run diagnostics → Capture payloads → Document findings → Design surgical fixes
