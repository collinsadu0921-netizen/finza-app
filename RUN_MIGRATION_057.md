# How to Run Migration 057

## Step 1: Open Supabase Dashboard
1. Go to https://supabase.com/dashboard
2. Select your project
3. Click on **SQL Editor** in the left sidebar

## Step 2: Create New Query
1. Click **New Query** button
2. Give it a name: "Fix Bills business_id"

## Step 3: Copy and Paste Migration
Copy the entire contents of `supabase/migrations/057_fix_bills_business_id.sql` and paste it into the SQL Editor.

## Step 4: Run the Migration
1. Click **Run** button (or press `Ctrl+Enter`)
2. Wait for it to complete
3. Check for any errors in the output

## What This Migration Does:
- ✅ Ensures `business_id` column exists in `bills` table
- ✅ Removes `business_id_val` column if it exists (safely)
- ✅ Ensures `business_id` exists in `bill_payments` table
- ✅ Adds missing columns to bills, bill_items, and bill_payments tables
- ✅ Creates necessary indexes
- ✅ Sets up proper foreign key relationships

## After Running:
Test bill creation to ensure everything works correctly!

