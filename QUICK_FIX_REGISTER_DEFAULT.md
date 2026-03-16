# Quick Fix: Register Default Column Error

## Problem
You're seeing: `Error loading registers: column registers.is_default does not exist`

## Solution: Run Migration 128

Migration 128 is a simplified version that just adds the `is_default` column. Run it immediately:

### Option 1: Supabase Dashboard (Fastest)
1. Go to https://supabase.com/dashboard
2. Select your project
3. Click **SQL Editor**
4. Click **New Query**
5. Copy the entire contents of `supabase/migrations/128_add_is_default_column.sql`
6. Paste and click **Run**

### Option 2: Supabase CLI
```bash
supabase db push
```

## What Migration 128 Does
- ✅ Adds `is_default` column to `registers` table
- ✅ Sets default value to `false` for all existing registers
- ✅ Backfills: Sets the earliest register as default for each store

## After Running Migration 128

**Then run Migration 127** (full enforcement):
- Migration 127 adds the database trigger and unique indexes
- This ensures only one default register per store
- Run it the same way (via Dashboard or CLI)

## Code Changes Made
The code now handles missing column gracefully:
- ✅ Register creation works even if `is_default` doesn't exist
- ✅ Register loading falls back to ordering by `created_at` if `is_default` missing
- ✅ Clear error messages if trying to set default when column doesn't exist

## Verify It Works
After running migration 128:
1. Try creating a register - should work without errors
2. Check that registers load correctly
3. The first register for each store should be marked as default



