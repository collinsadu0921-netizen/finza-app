# Creating the Business Assets Storage Bucket

If you encounter a "Bucket not found" error when uploading logos, you need to create the storage bucket in Supabase.

## Option 1: Via Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to **Storage** in the left sidebar
3. Click **New Bucket**
4. Enter the following details:
   - **Name**: `business-assets`
   - **Public bucket**: ✅ Check this (so logos can be accessed publicly)
   - **File size limit**: 5242880 (5MB)
   - **Allowed MIME types**: `image/jpeg,image/png,image/gif,image/webp`
5. Click **Create bucket**

## Option 2: Via Supabase SQL Editor

Run this SQL in the Supabase SQL Editor:

```sql
-- Note: Buckets cannot be created via SQL directly
-- You must use the Supabase Dashboard or Storage API
-- This is just for reference

-- After creating the bucket via Dashboard, run migration 053_create_storage_buckets.sql
-- to set up the storage policies
```

## Option 3: Via Application Code

The application will attempt to create the bucket automatically if it doesn't exist, but this requires proper permissions.

## Storage Policies

After creating the bucket, the storage policies from migration `053_create_storage_buckets.sql` will automatically apply, allowing:
- Authenticated users to upload files to their business folder
- Authenticated users to read files from their business folder
- Authenticated users to update/delete files in their business folder

## Folder Structure

Files are stored in the following structure:
```
business-assets/
  └── {business_id}/
      └── logo.{ext}
```

