-- Migration: Fix Storage Policies for business-assets bucket
-- More permissive policies for authenticated users

-- ============================================================================
-- DROP AND RECREATE STORAGE POLICIES
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can upload business assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can read business assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can update business assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete business assets" ON storage.objects;

-- Policy: Allow authenticated users to upload files to business-assets bucket
-- File path format: {business_id}/logo.{ext}
-- For development: More permissive policy
CREATE POLICY "Users can upload business assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'business-assets'
  -- AUTH DISABLED FOR DEVELOPMENT: Allow all authenticated users
  -- In production, add: AND EXISTS (SELECT 1 FROM businesses WHERE businesses.owner_id = auth.uid() AND name LIKE businesses.id::text || '/%')
);

-- Policy: Allow authenticated users to read files from business-assets bucket
-- Public read access since bucket is public
CREATE POLICY "Users can read business assets"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'business-assets');

-- Policy: Allow authenticated users to update files in business-assets bucket
-- AUTH DISABLED FOR DEVELOPMENT
CREATE POLICY "Users can update business assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'business-assets');

-- Policy: Allow authenticated users to delete files from business-assets bucket
-- AUTH DISABLED FOR DEVELOPMENT
CREATE POLICY "Users can delete business assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'business-assets');

