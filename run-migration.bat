@echo off
echo ========================================
echo Running Supabase Migration
echo ========================================
echo.
echo This script will help you run the migration.
echo.
echo Option 1: Run via Supabase Dashboard (Recommended)
echo   1. Go to your Supabase project dashboard
echo   2. Navigate to SQL Editor
echo   3. Copy the contents of supabase\migrations\053_create_storage_buckets.sql
echo   4. Paste and run it
echo.
echo Option 2: Run via Supabase CLI (if installed)
echo   supabase db push
echo.
echo IMPORTANT: Before running the migration, create the storage bucket:
echo   1. Go to Supabase Dashboard > Storage
echo   2. Click "New Bucket"
echo   3. Name: business-assets
echo   4. Check "Public bucket"
echo   5. Click "Create bucket"
echo.
echo ========================================
pause

