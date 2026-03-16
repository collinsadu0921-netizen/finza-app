"use client"

import { useState } from "react"
import { extractFilename, isImageFile, isPdfFile, getFileTypeInfo } from "@/lib/fileHandling"

interface FileAttachmentProps {
  /** Current file URL/path */
  existingFileUrl: string | null | undefined
  /** Whether the file is marked for removal */
  isRemoved?: boolean
  /** Callback when user clicks remove */
  onRemove?: () => void
  /** Callback when user cancels removal */
  onKeep?: () => void
  /** Optional label override */
  label?: string
  /** Optional className for styling */
  className?: string
}

/**
 * Standardized FileAttachment Component
 * 
 * Displays existing file attachments with:
 * - Filename extraction and display
 * - Download link
 * - Image preview (for images)
 * - PDF/document icon (for PDFs)
 * - Remove/Keep actions
 * - Visual indicator when marked for removal
 * 
 * This component follows Finza file handling standards:
 * - Files are never silently removed
 * - Clear visual feedback for all states
 * - Consistent UI across all modules
 */
export default function FileAttachment({
  existingFileUrl,
  isRemoved = false,
  onRemove,
  onKeep,
  label = "Attachment",
  className = "",
}: FileAttachmentProps) {
  if (!existingFileUrl) {
    return null
  }

  const filename = extractFilename(existingFileUrl)
  const fileInfo = getFileTypeInfo(existingFileUrl)
  const isImage = isImageFile(existingFileUrl)
  const isPdf = isPdfFile(existingFileUrl)

  return (
    <div
      className={`p-4 rounded-lg border ${
        isRemoved
          ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
          : "bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
      } ${className}`}
    >
      {isRemoved && (
        <div className="mb-3 p-2 bg-red-100 dark:bg-red-900/30 rounded border border-red-200 dark:border-red-700">
          <p className="text-sm text-red-800 dark:text-red-200 font-medium">
            ⚠️ {label} will be removed when you save
          </p>
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Current {label.toLowerCase()}:
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate" title={filename}>
            {filename}
          </p>
        </div>
        {!isRemoved && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-4 flex-shrink-0 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm font-medium transition-colors"
          >
            Remove
          </button>
        )}
        {isRemoved && onKeep && (
          <button
            type="button"
            onClick={onKeep}
            className="ml-4 flex-shrink-0 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium transition-colors"
          >
            Keep
          </button>
        )}
      </div>

      <div className={isRemoved ? "opacity-60" : ""}>
        {/* Image Preview */}
        {isImage && (
          <div className="mb-2">
            <img
              src={existingFileUrl}
              alt={label}
              className="max-w-xs rounded-lg border border-gray-300 dark:border-gray-600"
            />
          </div>
        )}

        {/* PDF/Document Icon */}
        {!isImage && (
          <div className="mb-2 flex items-center gap-2">
            <span className="text-2xl">{fileInfo.icon}</span>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                {fileInfo.label} Document
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500">{filename}</p>
            </div>
          </div>
        )}

        {/* Download Link */}
        <a
          href={existingFileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Download {label.toLowerCase()}
        </a>
      </div>
    </div>
  )
}

/**
 * FileInput Component
 * 
 * Standardized file input with preview support
 */
interface FileInputProps {
  /** Current file selection */
  file: File | null
  /** Callback when file is selected */
  onFileChange: (file: File | null) => void
  /** Allowed file types (e.g., "image/*,.pdf") */
  accept?: string
  /** Label text */
  label?: string
  /** Optional preview URL (for existing files) */
  previewUrl?: string | null
  /** Input ID */
  id?: string
  /** Help text */
  helpText?: string
}

export function FileInput({
  file,
  onFileChange,
  accept = "image/*,.pdf",
  label = "File",
  previewUrl,
  id = "file-input",
  helpText,
}: FileInputProps) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null
    onFileChange(selectedFile)
  }

  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/20 dark:file:text-blue-300"
      />
      {file && (
        <div className="mt-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">New file preview:</p>
          {file.type.startsWith("image/") && (
            <img
              src={URL.createObjectURL(file)}
              alt="Preview"
              className="max-w-xs rounded-lg border border-gray-300 dark:border-gray-600"
            />
          )}
          {!file.type.startsWith("image/") && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <span>📄</span>
              <span>{file.name}</span>
              <span className="text-xs text-gray-500">
                ({(file.size / 1024).toFixed(1)} KB)
              </span>
            </div>
          )}
        </div>
      )}
      {helpText && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{helpText}</p>
      )}
    </div>
  )
}













