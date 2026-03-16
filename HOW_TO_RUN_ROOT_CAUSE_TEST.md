# How to Run Root Cause Diagnostic Test

## Quick Start

### Option 1: Run SQL Script Directly (Recommended)

1. **Open your database client** (psql, pgAdmin, Supabase SQL Editor, etc.)

2. **Enable NOTICE output** (if not already enabled):
   ```sql
   SET client_min_messages TO NOTICE;
   ```

3. **Get your test UUIDs**:
   ```sql
   -- Get a business_id
   SELECT id FROM businesses LIMIT 1;
   
   -- Get a user_id (business owner or admin)
   SELECT id FROM users WHERE id IN (SELECT owner_id FROM businesses) LIMIT 1;
   
   -- Get a store_id
   SELECT id FROM stores LIMIT 1;
   
   -- Get a register_id
   SELECT id FROM registers LIMIT 1;
   ```

4. **Edit `TEST_SALE_ROOT_CAUSE.sql`**:
   - Replace `YOUR_BUSINESS_ID_HERE` with actual business_id
   - Replace `YOUR_USER_ID_HERE` with actual user_id
   - Replace `YOUR_STORE_ID_HERE` with actual store_id
   - Replace `YOUR_REGISTER_ID_HERE` with actual register_id

5. **Run the script**:
   ```bash
   # Via psql
   psql -d your_database -f TEST_SALE_ROOT_CAUSE.sql
   
   # Or copy-paste into SQL editor
   ```

6. **Capture all output** - Look for lines starting with:
   - `EVIDENCE` - Diagnostic data
   - `NOTICE` - Test progress
   - `ERROR` or `WARNING` - Issues

### Option 2: Test with Existing Sale

If you have an existing sale that triggers the error:

```sql
SET client_min_messages TO NOTICE;

DO $$
DECLARE
  existing_sale_id UUID := 'YOUR_EXISTING_SALE_ID_HERE';  -- Replace with actual sale ID
  journal_entry_id UUID;
BEGIN
  RAISE NOTICE 'Testing with existing sale: %', existing_sale_id;
  
  SELECT post_sale_to_ledger(
    existing_sale_id,
    NULL, NULL, NULL, NULL
  ) INTO journal_entry_id;
  
  RAISE NOTICE 'Journal entry created: %', journal_entry_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error: %', SQLERRM;
    RAISE NOTICE 'Review diagnostic output above for EVIDENCE lines';
END $$;
```

### Option 3: Via Application (POS)

1. **Open POS page** in your browser
2. **Open browser DevTools** (F12) → Console tab
3. **Create a test sale**:
   - Add a product to cart
   - Complete payment
4. **Check server logs** for diagnostic output:
   - Supabase Dashboard → Logs → Postgres Logs
   - Or your application server logs

## Capturing Diagnostic Output

### PostgreSQL/Supabase

**Supabase Dashboard**:
1. Go to Database → Logs
2. Filter by "NOTICE" level
3. Look for lines with "EVIDENCE"

**psql**:
```bash
psql -d your_database -f TEST_SALE_ROOT_CAUSE.sql > diagnostic_output.txt 2>&1
```

**pgAdmin**:
- Output appears in "Messages" tab
- Right-click → "Save Messages" to export

### Application Logs

If using Supabase:
- Dashboard → Logs → Postgres Logs
- Filter: `level:notice` AND `message:EVIDENCE`

## What to Look For

### Critical Evidence Lines

1. **Totals**:
   ```
   EVIDENCE gross_total=100.00, net_total=83.34, tax_total=16.66, cogs=0.00
   ```
   - Check if `net_total` or `tax_total` is 0

2. **Tax Data**:
   ```
   EVIDENCE tax_lines_jsonb={"tax_lines": [...], "subtotal_excl_tax": 83.34, ...}
   ```
   - Verify JSONB structure is correct

3. **Journal Lines**:
   ```
   EVIDENCE journal_lines=[{"account_id": "...", "debit": 100.00, "credit": 0.00, ...}, ...]
   ```
   - **KEY**: Check if `credit` values are 0 or NULL

4. **Per-Line Details**:
   ```
   EVIDENCE line[1] account_id=... debit=100.00 credit=0.00 desc=Sale receipt
   EVIDENCE line[2] account_id=... debit=0.00 credit=0.00 desc=Sales revenue  ← PROBLEM!
   ```
   - **KEY**: Revenue line should have `credit=83.34`, not `credit=0.00`

5. **Summary**:
   ```
   EVIDENCE line_count=4, debit_count=1, credit_count=0, debit_sum=100.00, credit_sum=0.00
   ```
   - **KEY**: `credit_count=0` or `credit_sum=0.00` indicates the problem

## Expected vs Problematic Output

### ✅ Expected (Working):
```
EVIDENCE gross_total=100.00, net_total=83.34, tax_total=16.66, cogs=0.00
EVIDENCE line[2] account_id=... debit=0.00 credit=83.34 desc=Sales revenue
EVIDENCE line_count=5, debit_count=2, credit_count=3, debit_sum=100.00, credit_sum=100.00
```

### ❌ Problematic (Current Error):
```
EVIDENCE gross_total=100.00, net_total=0.00, tax_total=0.00, cogs=0.00  ← net_total is 0!
EVIDENCE line[2] account_id=... debit=0.00 credit=0.00 desc=Sales revenue  ← credit is 0!
EVIDENCE line_count=4, debit_count=1, credit_count=0, debit_sum=100.00, credit_sum=0.00  ← No credits!
```

## Next Steps After Capturing Evidence

1. **Save all diagnostic output** to a file
2. **Review `ROOT_CAUSE_DIAGNOSTIC_REPORT.md`** analysis framework
3. **Answer the questions**:
   - Are credits missing entirely? (check `line_count`)
   - Are credits present but 0? (check per-line `credit` values)
   - Which variable is 0? (`net_total` or `total_tax_amount`)
   - Which branch was taken? (check `tax_posting_branch`)
4. **Report findings** with specific evidence quotes

## Troubleshooting

### "Function post_sale_to_ledger does not exist"
- Ensure migration 179 has been applied
- Check: `SELECT * FROM pg_proc WHERE proname = 'post_sale_to_ledger';`

### "Business owner not found"
- Ensure business has an `owner_id`
- Check: `SELECT id, owner_id FROM businesses WHERE id = 'your_business_id';`

### "Account not found"
- Ensure accounts exist: 1000 (Cash), 4000 (Revenue), 5000 (COGS), 1200 (Inventory), 2100 (VAT Payable)
- Check: `SELECT code, name FROM accounts WHERE business_id = 'your_business_id' AND code IN ('1000', '4000', '5000', '1200', '2100');`

### "No diagnostic output"
- Ensure `SET client_min_messages TO NOTICE;` is set
- Check database log level settings
- Verify diagnostic code is in migration 179
