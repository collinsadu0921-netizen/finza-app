/**
 * Server-Side File Handling Utilities for API Routes
 * 
 * Provides standardized file persistence logic for backend API routes.
 * Ensures files are never lost during updates unless explicitly removed.
 */

import { SupabaseClient } from "@supabase/supabase-js"
import {
  extractStoragePathFromUrl,
  deleteFileFromStorage,
  FileStorageBucket,
} from "./fileHandling"

export interface FilePersistenceConfig {
  /** Supabase client instance */
  supabase: SupabaseClient
  /** Storage bucket name */
  bucket: FileStorageBucket
  /** Current file path/URL from database */
  existingFilePath: string | null | undefined
  /** New file path/URL from request (can be undefined, null, or string) */
  newFilePath: string | null | undefined
}

export interface FilePersistenceResult {
  /** Final file path to save to database */
  finalFilePath: string | null
  /** Whether the existing file was deleted */
  deleted: boolean
  /** Error message if deletion failed (non-fatal) */
  deletionError?: string
}

/**
 * Determine the final file path based on the persistence rules:
 * 
 * Rules:
 * 1. If newFilePath is undefined → preserve existing (return existingFilePath)
 * 2. If newFilePath is null → remove file (delete from storage, return null)
 * 3. If newFilePath is a string → replace file (delete old if different, return newFilePath)
 * 
 * This function ensures files are never lost unless explicitly removed.
 */
export async function handleFilePersistence(
  config: FilePersistenceConfig
): Promise<FilePersistenceResult> {
  const { supabase, bucket, existingFilePath, newFilePath } = config

  // Rule 1: newFilePath is undefined → preserve existing file
  if (newFilePath === undefined) {
    return {
      finalFilePath: existingFilePath || null,
      deleted: false,
    }
  }

  // Rule 2: newFilePath is null → user explicitly wants to remove the file
  if (newFilePath === null) {
    let deletionError: string | undefined

    // Delete existing file from storage
    if (existingFilePath) {
      const deleted = await deleteFileFromStorage(supabase, bucket, existingFilePath)
      if (!deleted) {
        deletionError = "Failed to delete old file from storage (non-fatal)"
      }
    }

    return {
      finalFilePath: null,
      deleted: !!existingFilePath,
      deletionError,
    }
  }

  // Rule 3: newFilePath is a string → new file uploaded
  // Delete old file if it's different from the new one
  if (existingFilePath && existingFilePath !== newFilePath) {
    const deleted = await deleteFileFromStorage(supabase, bucket, existingFilePath)
    if (!deleted) {
      // Log warning but continue - deletion failure shouldn't block update
      console.warn("Failed to delete old file during replacement (non-fatal)")
    }
  }

  return {
    finalFilePath: newFilePath,
    deleted: existingFilePath !== null && existingFilePath !== newFilePath,
  }
}

/**
 * Extract the existing file path from a database record
 * 
 * Helper to fetch existing file path before update operations
 */
export async function fetchExistingFilePath(
  supabase: SupabaseClient,
  table: string,
  recordId: string,
  filePathColumn: string = "receipt_path"
): Promise<string | null> {
  const { data, error } = await supabase
    .from(table)
    .select(filePathColumn)
    .eq("id", recordId)
    .single()

  if (error || !data) {
    console.error(`Error fetching existing file path from ${table}:`, error)
    return null
  }

  return (data as Record<string, any>)[filePathColumn] || null
}

