import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

// This endpoint helps create storage buckets (business-assets or receipts)
// Note: Requires service role key or proper permissions
// Usage: POST /api/storage/create-bucket?bucket=business-assets or receipts

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    
    // Get bucket name from query parameter or default to business-assets
    const { searchParams } = new URL(request.url)
    const bucketName = searchParams.get("bucket") || "business-assets"
    
    // Validate bucket name
    const allowedBuckets = ["business-assets", "receipts"]
    if (!allowedBuckets.includes(bucketName)) {
      return NextResponse.json(
        { 
          success: false, 
          error: "Invalid bucket name",
          message: `Bucket must be one of: ${allowedBuckets.join(", ")}`
        },
        { status: 400 }
      )
    }
    
    // Define bucket configurations
    const bucketConfigs: Record<string, { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }> = {
      "business-assets": {
        public: true,
        fileSizeLimit: 5242880, // 5MB
        allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"]
      },
      "receipts": {
        public: true,
        fileSizeLimit: 10485760, // 10MB - receipts can be larger
        allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]
      }
    }
    
    // Check if bucket exists
    const { data: buckets, error: listError } = await supabase.storage.listBuckets()
    
    if (listError) {
      return NextResponse.json(
        { 
          success: false, 
          error: "Failed to list buckets",
          message: listError.message 
        },
        { status: 500 }
      )
    }

    const bucketExists = buckets?.some(b => b.id === bucketName)
    
    if (bucketExists) {
      return NextResponse.json({
        success: true,
        message: `Bucket '${bucketName}' already exists`
      })
    }

    // Try to create the bucket
    // Note: This requires service role permissions or bucket creation API access
    const config = bucketConfigs[bucketName]
    const { data, error: createError } = await supabase.storage.createBucket(bucketName, config)

    if (createError) {
      return NextResponse.json(
        { 
          success: false,
          error: "Failed to create bucket",
          message: createError.message,
          instructions: `Please create the '${bucketName}' bucket manually in Supabase Dashboard > Storage`
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Bucket '${bucketName}' created successfully`,
      data
    })
  } catch (error: any) {
    console.error("Error creating storage bucket:", error)
    return NextResponse.json(
      { 
        success: false,
        error: error.message || "Internal server error",
        instructions: "Please create the bucket manually in Supabase Dashboard > Storage"
      },
      { status: 500 }
    )
  }
}

