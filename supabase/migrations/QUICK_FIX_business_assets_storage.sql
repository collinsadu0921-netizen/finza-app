-- QUICK FIX: Apply permissive storage policies for business-assets bucket
-- Run this in Supabase SQL Editor after creating the bucket

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can upload business assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can read business assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can update business assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete business assets" ON storage.objects;
DROP POLICY IF EXISTS "Public can read business assets" ON storage.objects;

-- DEVELOPMENT MODE: Permissive policies (allow all authenticated users)
-- Policy: Allow authenticated users to upload files
CREATE POLICY "Users can upload business assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'business-assets');

-- Policy: Allow authenticated users to read files
CREATE POLICY "Users can read business assets"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'business-assets');

-- Policy: Allow public read access (for public URLs)
CREATE POLICY "Public can read business assets"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'business-assets');

-- Policy: Allow authenticated users to update files
CREATE POLICY "Users can update business assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'business-assets');

-- Policy: Allow authenticated users to delete files
CREATE POLICY "Users can delete business assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'business-assets');

-- Verify policies were created
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'objects' 
  AND schemaname = 'storage'
  AND policyname LIKE '%business assets%'
ORDER BY policyname;

