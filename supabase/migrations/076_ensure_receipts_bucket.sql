-- Ensure receipts storage bucket exists and is public
-- Note: Storage buckets cannot be created via SQL, but we can ensure policies are set
-- The bucket must be created via Supabase Dashboard or Storage API
-- This migration ensures the policies are correct for the receipts bucket

-- ============================================================================
-- STORAGE POLICIES FOR receipts BUCKET
-- ============================================================================
-- IMPORTANT: Create the bucket first via Supabase Dashboard > Storage > New Bucket
-- Bucket name: receipts, Public: true

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can read receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can update receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete receipts" ON storage.objects;
DROP POLICY IF EXISTS "Public can read receipts" ON storage.objects;

-- Policy: Allow authenticated users to upload receipt files
-- File path format: expenses/{business_id}/{timestamp}.{ext}
-- DEVELOPMENT MODE: More permissive policy
CREATE POLICY "Users can upload receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'receipts'
  -- Allow all authenticated users to upload (development mode)
  -- In production, you can add business ownership check:
  -- AND EXISTS (
  --   SELECT 1 FROM businesses
  --   WHERE businesses.owner_id = auth.uid()
  --     AND name LIKE 'expenses/' || businesses.id::text || '/%'
  -- )
);

-- Policy: Allow authenticated users to read receipts
-- DEVELOPMENT MODE: More permissive policy
CREATE POLICY "Users can read receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'receipts'
  -- Allow all authenticated users to read (development mode)
);

-- Policy: Allow public read access (for public URLs)
CREATE POLICY "Public can read receipts"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'receipts');

-- Policy: Allow authenticated users to update receipts
-- DEVELOPMENT MODE: More permissive policy
CREATE POLICY "Users can update receipts"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'receipts');

-- Policy: Allow authenticated users to delete receipts
-- DEVELOPMENT MODE: More permissive policy
CREATE POLICY "Users can delete receipts"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'receipts');

-- Note: The bucket itself must be created via Supabase Dashboard or Storage API
-- Bucket settings:
-- - Name: receipts
-- - Public: true (for public URLs)
-- - File size limit: 10485760 (10MB) - receipts can be larger than logos
-- - Allowed MIME types: image/jpeg, image/png, image/gif, image/webp, application/pdf













