/**
 * Standardized File Handling Utilities for Finza
 * 
 * This module provides consistent file upload, storage, and deletion
 * functionality across all Finza modules (expenses, bills, invoices, etc.)
 * 
 * Rules:
 * - Files are stored with unique names to prevent collisions
 * - Original filenames are preserved in the path structure
 * - File deletion is explicit and safe
 * - Storage paths follow a consistent pattern by entity type
 */

import { SupabaseClient } from "@supabase/supabase-js"

export type FileStorageBucket = "receipts" | "business-assets" | "documents"

export interface FileUploadResult {
  success: boolean
  publicUrl: string | null
  storagePath: string | null
  error?: string
}

export interface FileMetadata {
  originalFilename: string
  mimeType: string
  size: number
}

/**
 * Extract storage path from a public URL
 * Handles various Supabase storage URL formats
 */
export function extractStoragePathFromUrl(publicUrl: string, bucketName: string): string | null {
  try {
    const url = new URL(publicUrl)
    
    // Format: /storage/v1/object/public/{bucket}/{path}
    const pathMatch = url.pathname.match(`/storage/v1/object/public/${bucketName}/(.+)$`)
    if (pathMatch && pathMatch[1]) {
      return decodeURIComponent(pathMatch[1])
    }
    
    // Fallback: try to extract path after /{bucket}/
    const bucketIndex = url.pathname.indexOf(`/${bucketName}/`)
    if (bucketIndex !== -1) {
      return decodeURIComponent(url.pathname.substring(bucketIndex + `/${bucketName}/`.length))
    }
    
    return null
  } catch (err) {
    console.error("Error extracting storage path:", err)
    return null
  }
}

/**
 * Generate a unique storage path for a file
 * Format: {entityType}/{businessId}/{timestamp}-{sanitized-filename}
 */
export function generateStoragePath(
  entityType: string,
  businessId: string,
  originalFilename: string,
  entityId?: string
): string {
  // Sanitize filename (remove special chars, keep extension)
  const sanitized = originalFilename
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .substring(0, 100) // Limit length
  
  const timestamp = Date.now()
  const filename = entityId 
    ? `${entityId}/${timestamp}-${sanitized}`
    : `${timestamp}-${sanitized}`
  
  return `${entityType}/${businessId}/${filename}`
}

/**
 * Upload a file to Supabase Storage
 * 
 * @param supabase - Supabase client instance
 * @param bucket - Storage bucket name
 * @param file - File object to upload
 * @param storagePath - Full storage path (from generateStoragePath)
 * @param metadata - Optional file metadata
 * @returns FileUploadResult with public URL and storage path
 */
export async function uploadFileToStorage(
  supabase: SupabaseClient,
  bucket: FileStorageBucket,
  file: File,
  storagePath: string,
  metadata?: FileMetadata
): Promise<FileUploadResult> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false, // Never overwrite - use unique paths
        contentType: metadata?.mimeType || file.type,
      })

    if (error) {
      console.error("File upload error:", error)
      return {
        success: false,
        publicUrl: null,
        storagePath: null,
        error: error.message,
      }
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(storagePath)

    return {
      success: true,
      publicUrl,
      storagePath,
    }
  } catch (err: any) {
    console.error("Exception during file upload:", err)
    return {
      success: false,
      publicUrl: null,
      storagePath: null,
      error: err?.message || "Unknown error during upload",
    }
  }
}

/**
 * Safely delete a file from Supabase Storage
 * 
 * This function handles errors gracefully and never throws.
 * It's designed to be used as cleanup and should not block
 * the main operation if deletion fails.
 * 
 * @param supabase - Supabase client instance
 * @param bucket - Storage bucket name
 * @param publicUrl - Public URL of the file to delete
 * @returns Promise that resolves to success boolean
 */
export async function deleteFileFromStorage(
  supabase: SupabaseClient,
  bucket: FileStorageBucket,
  publicUrl: string | null
): Promise<boolean> {
  if (!publicUrl) {
    return true // Nothing to delete
  }

  try {
    const storagePath = extractStoragePathFromUrl(publicUrl, bucket)
    if (!storagePath) {
      console.warn("Could not extract storage path from URL:", publicUrl)
      return false
    }

    const { error } = await supabase.storage
      .from(bucket)
      .remove([storagePath])

    if (error) {
      // Handle specific error cases gracefully
      if (error.message?.includes("Bucket not found") || 
          error.message?.includes("not found") ||
          error.message?.includes("No such file")) {
        console.warn("File already deleted or bucket not found (safe to ignore):", storagePath)
        return true // Consider this a success (file doesn't exist)
      }
      console.error("Error deleting file from storage:", error)
      return false
    }

    return true
  } catch (err: any) {
    console.warn("Exception while deleting file (safe to ignore):", err?.message || err)
    return false // Continue even if deletion fails
  }
}

/**
 * Extract filename from a storage URL or path
 * Useful for displaying the original filename in the UI
 */
export function extractFilename(urlOrPath: string): string {
  try {
    // If it's a URL, extract from pathname
    if (urlOrPath.startsWith("http")) {
      const url = new URL(urlOrPath)
      const pathname = url.pathname
      const filename = pathname.split("/").pop() || "file"
      // Remove query parameters
      return filename.split("?")[0]
    }
    
    // If it's a path, extract last segment
    const parts = urlOrPath.split("/")
    return parts[parts.length - 1] || "file"
  } catch {
    // Fallback: try simple string extraction
    const parts = urlOrPath.split("/")
    const last = parts[parts.length - 1] || urlOrPath
    return last.split("?")[0]
  }
}

/**
 * Check if a file URL is an image (for preview purposes)
 */
export function isImageFile(urlOrPath: string): boolean {
  const filename = extractFilename(urlOrPath).toLowerCase()
  return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename)
}

/**
 * Check if a file URL is a PDF
 */
export function isPdfFile(urlOrPath: string): boolean {
  const filename = extractFilename(urlOrPath).toLowerCase()
  return filename.endsWith(".pdf")
}

/**
 * Get file type icon/display info
 */
export function getFileTypeInfo(urlOrPath: string): {
  type: "image" | "pdf" | "document" | "unknown"
  label: string
  icon: string
} {
  if (isImageFile(urlOrPath)) {
    return { type: "image", label: "Image", icon: "🖼️" }
  }
  if (isPdfFile(urlOrPath)) {
    return { type: "pdf", label: "PDF", icon: "📄" }
  }
  return { type: "document", label: "Document", icon: "📎" }
}













