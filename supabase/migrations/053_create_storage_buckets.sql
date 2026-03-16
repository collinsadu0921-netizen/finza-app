-- Migration: Create Storage Buckets for Business Assets
-- Note: Storage buckets cannot be created directly via SQL in Supabase
-- This migration creates the necessary policies
-- The bucket itself must be created via Supabase Dashboard or Storage API

-- ============================================================================
-- STORAGE POLICIES FOR business-assets BUCKET
-- ============================================================================
-- These policies will be applied once the bucket is created
-- IMPORTANT: Create the bucket first via Supabase Dashboard > Storage > New Bucket
-- Bucket name: business-assets, Public: true

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload business assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can read business assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can update business assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete business assets" ON storage.objects;

-- Policy: Allow authenticated users to upload files to their business folder
-- File path format: {business_id}/logo.{ext}
CREATE POLICY "Users can upload business assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'business-assets' AND
  (
    -- Allow if the file path starts with a business ID that belongs to the user
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.owner_id = auth.uid()
        AND (name LIKE businesses.id::text || '/%' OR name = businesses.id::text || '/logo.%')
    )
  )
);

-- Policy: Allow authenticated users to read their business assets
CREATE POLICY "Users can read business assets"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'business-assets' AND
  (
    -- Allow if the file path starts with a business ID that belongs to the user
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.owner_id = auth.uid()
        AND (name LIKE businesses.id::text || '/%' OR name = businesses.id::text || '/logo.%')
    )
  )
);

-- Policy: Allow authenticated users to update their business assets
CREATE POLICY "Users can update business assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'business-assets' AND
  (
    -- Allow if the file path starts with a business ID that belongs to the user
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.owner_id = auth.uid()
        AND (name LIKE businesses.id::text || '/%' OR name = businesses.id::text || '/logo.%')
    )
  )
);

-- Policy: Allow authenticated users to delete their business assets
CREATE POLICY "Users can delete business assets"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'business-assets' AND
  (
    -- Allow if the file path starts with a business ID that belongs to the user
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.owner_id = auth.uid()
        AND (name LIKE businesses.id::text || '/%' OR name = businesses.id::text || '/logo.%')
    )
  )
);

