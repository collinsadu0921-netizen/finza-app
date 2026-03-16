# Creating the Receipts Storage Bucket

If you encounter a "Bucket not found" error when uploading expense receipts, you need to create the receipts storage bucket in Supabase.

## Option 1: Via Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to **Storage** in the left sidebar
3. Click **New Bucket**
4. Enter the following details:
   - **Name**: `receipts`
   - **Public bucket**: ✅ Check this (so receipts can be accessed via public URLs)
   - **File size limit**: 10485760 (10MB)
   - **Allowed MIME types**: `image/jpeg,image/png,image/gif,image/webp,application/pdf`
5. Click **Create bucket**

## Option 2: Via API Endpoint

You can use the application's API endpoint to create the bucket:

```bash
POST /api/storage/create-bucket?bucket=receipts
```

Or use curl:

```bash
curl -X POST http://localhost:3000/api/storage/create-bucket?bucket=receipts
```

**Note:** This requires service role permissions. If it fails, use Option 1 instead.

## Option 3: Via Supabase CLI

If you have the Supabase CLI installed:

```bash
supabase storage create receipts --public
```

## Storage Policies

After creating the bucket, run migration `076_ensure_receipts_bucket.sql` to set up the storage policies. This will allow:
- Authenticated users to upload receipt files
- Authenticated users to read receipt files
- Public read access (for public URLs)
- Authenticated users to update/delete receipt files

## Folder Structure

Files are stored in the following structure:
```
receipts/
  └── expenses/
      └── {business_id}/
          └── {timestamp}.{ext}
```

Example: `receipts/expenses/123e4567-e89b-12d3-a456-426614174000/1234567890.pdf`

## After Creation

1. Run the migration: `076_ensure_receipts_bucket.sql`
2. Test by creating or editing an expense and uploading a receipt













