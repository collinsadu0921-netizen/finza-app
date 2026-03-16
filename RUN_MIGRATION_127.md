# How to Run Migration 127: Register Default Enforcement

## Overview
This migration adds the `is_default` column to the `registers` table and enforces exactly one default register per store.

## Step 1: Open Supabase Dashboard
1. Go to https://supabase.com/dashboard
2. Select your project
3. Click on **SQL Editor** in the left sidebar

## Step 2: Create New Query
1. Click **New Query** button
2. Give it a name: "Register Default Enforcement (127)"

## Step 3: Copy and Paste Migration
Copy the entire contents of `supabase/migrations/127_register_default_enforcement.sql` and paste it into the SQL Editor.

## Step 4: Run the Migration
1. Click **Run** button (or press `Ctrl+Enter`)
2. Wait for it to complete
3. Check for any errors in the output

## What This Migration Does:
- ✅ Adds `is_default` column to `registers` table (if not exists)
- ✅ Creates index for default register lookups
- ✅ Backfills existing data: sets earliest created register as default for each store
- ✅ Fixes multiple defaults: ensures only one default per store
- ✅ Creates trigger function to enforce single default per store
- ✅ Creates trigger to automatically enforce the constraint
- ✅ Creates unique indexes to prevent multiple defaults

## After Running:
1. Verify the column exists:
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'registers' AND column_name = 'is_default';
   ```

2. Test register creation to ensure the default enforcement works correctly!

## Alternative: Using Supabase CLI
If you have Supabase CLI installed:
```bash
supabase db push
```
This will apply all pending migrations including 127.



