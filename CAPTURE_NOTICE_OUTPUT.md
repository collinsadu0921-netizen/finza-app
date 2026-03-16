# How to Capture RAISE NOTICE Output

**Status:** Function has RAISE NOTICE for journal_lines, but we need to see the output

---

## Where to Find NOTICE Messages

### Option 1: PostgreSQL Client Console
If you're using:
- **psql**: NOTICE messages appear in the console output
- **pgAdmin**: Check the "Messages" tab or console output
- **DBeaver**: Check the "Output" tab or "Messages" panel
- **Supabase Dashboard**: Check SQL editor output/console

### Option 2: Check PostgreSQL Logs
If console doesn't show NOTICES, check:
- PostgreSQL server logs
- Supabase logs (if using Supabase)

### Option 3: Alternative - Query PostgreSQL System Tables
PostgreSQL doesn't directly store NOTICE output, but we can check if the function is actually outputting them.

---

## Critical Question

**Did you see any NOTICE messages in your console when running the tests?**

If YES:
- Copy/paste the journal_lines JSONB from the NOTICE output
- That's our forensic evidence

If NO:
- NOTICE messages might be suppressed
- We need an alternative capture method

---

## Alternative: Create a Persistent Log Table

If NOTICE messages aren't accessible, we can modify the function to write to a separate log table that survives rollback using autonomous transactions or a different approach.

---

## What We Need Right Now

Please check your PostgreSQL client console/logs for NOTICE messages containing:
- `journal_lines`
- `JSONB`
- Or any NOTICE messages from `post_sale_to_ledger()`

**The NOTICE output contains the exact journal_lines JSONB we need to diagnose the issue!**
