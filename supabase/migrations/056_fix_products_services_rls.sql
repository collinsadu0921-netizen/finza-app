-- Fix RLS policies for products_services to allow owners and be permissive for development
-- AUTH DISABLED FOR DEVELOPMENT

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view products_services for their business" ON products_services;
DROP POLICY IF EXISTS "Users can insert products_services for their business" ON products_services;
DROP POLICY IF EXISTS "Users can update products_services for their business" ON products_services;
DROP POLICY IF EXISTS "Users can delete products_services for their business" ON products_services;

-- Create permissive policies for development
-- Allow all authenticated users to view products_services (for their business or any business)
CREATE POLICY "Users can view products_services for their business" ON products_services
  FOR SELECT USING (
    -- AUTH DISABLED FOR DEVELOPMENT: Allow all authenticated users
    auth.uid() IS NOT NULL
    AND (deleted_at IS NULL)
  );

-- Allow all authenticated users to insert products_services
CREATE POLICY "Users can insert products_services for their business" ON products_services
  FOR INSERT WITH CHECK (
    -- AUTH DISABLED FOR DEVELOPMENT: Allow all authenticated users
    auth.uid() IS NOT NULL
  );

-- Allow all authenticated users to update products_services
CREATE POLICY "Users can update products_services for their business" ON products_services
  FOR UPDATE USING (
    -- AUTH DISABLED FOR DEVELOPMENT: Allow all authenticated users
    auth.uid() IS NOT NULL
  );

-- Allow all authenticated users to delete products_services
CREATE POLICY "Users can delete products_services for their business" ON products_services
  FOR DELETE USING (
    -- AUTH DISABLED FOR DEVELOPMENT: Allow all authenticated users
    auth.uid() IS NOT NULL
  );

-- Ensure RLS is enabled
ALTER TABLE products_services ENABLE ROW LEVEL SECURITY;

