-- Ensure business-assets storage bucket exists and is public
-- Note: Storage buckets cannot be created via SQL, but we can ensure policies are set
-- The bucket must be created via Supabase Dashboard or Storage API
-- This migration ensures the policies are correct for the business-assets bucket

-- ============================================================================
-- STORAGE POLICIES FOR business-assets BUCKET
-- ============================================================================
-- IMPORTANT: Create the bucket first via Supabase Dashboard > Storage > New Bucket
-- Bucket name: business-assets, Public: true

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload business assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can read business assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can update business assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete business assets" ON storage.objects;
DROP POLICY IF EXISTS "Public can read business assets" ON storage.objects;

-- Policy: Allow authenticated users to upload files to their business folder
-- File path format: {business_id}/logo.{ext}
-- DEVELOPMENT MODE: More permissive policy
CREATE POLICY "Users can upload business assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'business-assets'
  -- Allow all authenticated users to upload (development mode)
  -- In production, you can add business ownership check:
  -- AND EXISTS (
  --   SELECT 1 FROM businesses
  --   WHERE businesses.owner_id = auth.uid()
  --     AND (name LIKE businesses.id::text || '/%' OR name = businesses.id::text || '/logo.%')
  -- )
);

-- Policy: Allow authenticated users to read their business assets
-- DEVELOPMENT MODE: More permissive policy
CREATE POLICY "Users can read business assets"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'business-assets'
  -- Allow all authenticated users to read (development mode)
);

-- Policy: Allow public read access (for public URLs)
CREATE POLICY "Public can read business assets"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'business-assets');

-- Policy: Allow authenticated users to update their business assets
-- DEVELOPMENT MODE: More permissive policy
CREATE POLICY "Users can update business assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'business-assets');

-- Policy: Allow authenticated users to delete their business assets
-- DEVELOPMENT MODE: More permissive policy
CREATE POLICY "Users can delete business assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'business-assets');

-- Note: The bucket itself must be created via Supabase Dashboard or Storage API
-- Bucket settings:
-- - Name: business-assets
-- - Public: true
-- - File size limit: 5MB
-- - Allowed MIME types: image/jpeg, image/png, image/gif, image/webp

