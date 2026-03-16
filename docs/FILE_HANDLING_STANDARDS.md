# File Handling Standards for Finza

This document outlines the standardized file handling approach used across all Finza modules to ensure attachment persistence, consistency, and safety.

## Principles

1. **Preservation by Default**: Existing files are preserved unless explicitly changed
2. **Explicit Actions**: Files are only removed when the user explicitly requests it
3. **No Silent Deletions**: All file operations are intentional and visible
4. **Consistent Behavior**: All modules follow the same patterns

## Architecture

### Utilities Created

1. **`lib/fileHandling.ts`** - Client-side file handling utilities
2. **`lib/fileHandlingServer.ts`** - Server-side file persistence utilities
3. **`components/ui/FileAttachment.tsx`** - Reusable UI component

## Storage Structure

Files are stored with the following structure:

```
{bucket}/
  └── {entityType}/
      └── {businessId}/
          └── {entityId}/  (optional, for updates)
              └── {timestamp}-{sanitized-filename}
```

Examples:
- `receipts/expenses/{businessId}/{expenseId}/1234567890-receipt.pdf`
- `receipts/bills/{businessId}/{billId}/1234567890-invoice.pdf`

## Backend Implementation Pattern

### API Route Update Pattern

```typescript
import { handleFilePersistence } from "@/lib/fileHandlingServer"

// In PUT/PATCH handler:
export async function PUT(request: NextRequest, { params }) {
  // 1. Fetch existing record with file path
  const { data: existingRecord } = await supabase
    .from("table_name")
    .select("id, file_path_column")
    .eq("id", recordId)
    .single()

  // 2. Get new file path from request body
  const { file_path_column } = await request.json()

  // 3. Handle file persistence
  const fileResult = await handleFilePersistence({
    supabase,
    bucket: "receipts", // or appropriate bucket
    existingFilePath: existingRecord.file_path_column,
    newFilePath: file_path_column, // undefined = preserve, null = remove, string = replace
  })

  // 4. Update record with final file path
  const { data: updated } = await supabase
    .from("table_name")
    .update({
      ...otherFields,
      file_path_column: fileResult.finalFilePath,
    })
    .eq("id", recordId)
}
```

### File Persistence Rules

The `handleFilePersistence` function enforces these rules:

1. **`newFilePath === undefined`**: Preserve existing file (don't send field to API)
2. **`newFilePath === null`**: Remove file (delete from storage, set DB to null)
3. **`newFilePath === string`**: Replace file (delete old if different, save new)

## Frontend Implementation Pattern

### Using the FileAttachment Component

```typescript
import FileAttachment, { FileInput } from "@/components/ui/FileAttachment"
import { generateStoragePath, uploadFileToStorage } from "@/lib/fileHandling"

// State management
const [file, setFile] = useState<File | null>(null)
const [existingFilePath, setExistingFilePath] = useState<string | null>(null)
const [removeFile, setRemoveFile] = useState(false)

// In form JSX:
{existingFilePath && !file && (
  <FileAttachment
    existingFileUrl={existingFilePath}
    isRemoved={removeFile}
    onRemove={() => setRemoveFile(true)}
    onKeep={() => setRemoveFile(false)}
    label="Attachment" // Customize label per module
  />
)}

<FileInput
  file={file}
  onFileChange={(newFile) => {
    setFile(newFile)
    setRemoveFile(false) // Clear remove flag if new file selected
  }}
  accept="image/*,.pdf"
  label="Attachment"
  helpText="Optional help text"
/>
```

### Upload Pattern

```typescript
const uploadFile = async (): Promise<string | null> => {
  if (!file || !businessId) {
    return removeFile ? null : existingFilePath
  }

  try {
    const storagePath = generateStoragePath(
      "expenses", // entityType
      businessId,
      file.name,
      entityId // optional, for updates
    )

    const result = await uploadFileToStorage(
      supabase,
      "receipts", // bucket
      file,
      storagePath,
      {
        originalFilename: file.name,
        mimeType: file.type,
        size: file.size,
      }
    )

    if (!result.success) {
      throw new Error(result.error)
    }

    return result.publicUrl
  } catch (err) {
    console.error("Upload error:", err)
    throw err
  }
}
```

### Submit Pattern

```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()

  // Handle file upload/removal/preservation
  let filePath: string | null | undefined = undefined

  if (removeFile) {
    filePath = null // Explicitly remove
  } else if (file) {
    const uploadedPath = await uploadFile()
    filePath = uploadedPath // New file
  }
  // If neither removeFile nor file, filePath remains undefined (preserve)

  // Only include file_path in request if it changed
  const requestBody: any = {
    // ... other fields
  }

  if (filePath !== undefined) {
    requestBody.file_path_column = filePath
  }

  // Send to API
  await fetch(`/api/entity/${id}`, {
    method: "PUT",
    body: JSON.stringify(requestBody),
  })
}
```

## Module Migration Checklist

To migrate a module to use standardized file handling:

- [ ] **Backend**:
  - [ ] Import `handleFilePersistence` from `@/lib/fileHandlingServer`
  - [ ] Fetch existing file path before update
  - [ ] Use `handleFilePersistence` to determine final path
  - [ ] Update record with final file path

- [ ] **Frontend**:
  - [ ] Import `FileAttachment` and `FileInput` components
  - [ ] Import file handling utilities from `@/lib/fileHandling`
  - [ ] Replace custom file display with `FileAttachment` component
  - [ ] Replace file input with `FileInput` component
  - [ ] Use `generateStoragePath` and `uploadFileToStorage` for uploads
  - [ ] Implement state management for file removal
  - [ ] Only send `file_path` to API when it changes

## Module Status

- ✅ **Expenses**: Partially migrated (backend done, frontend uses utilities)
- ⏳ **Bills**: Needs migration
- ⏳ **Invoices**: No file attachments yet
- ⏳ **VAT Returns**: No file attachments yet
- ⏳ **Payments**: No file attachments yet

## Storage Buckets

Current buckets:
- `receipts` - Expense receipts, bill attachments
- `business-assets` - Business logos, brand assets
- `documents` - General document storage (future)

## Error Handling

- File deletion failures are non-fatal (logged but don't block updates)
- Missing buckets are handled gracefully
- Upload failures throw errors for user feedback
- Storage path extraction failures are logged but handled

## Testing Checklist

When implementing file handling:

- [ ] Create entity with file → File uploads successfully
- [ ] Edit entity without touching file → File is preserved
- [ ] Edit entity and upload new file → Old file deleted, new file saved
- [ ] Edit entity and remove file → File deleted from storage and DB
- [ ] Edit entity, remove file, then cancel → File restored
- [ ] Edit entity, select new file, then remove → File cleared, not uploaded

## Best Practices

1. **Always fetch existing file path before update** - Required for persistence
2. **Use standardized components** - Ensures consistency
3. **Handle errors gracefully** - Deletion failures shouldn't block updates
4. **Provide clear UI feedback** - Show file state clearly
5. **Validate file types** - Use appropriate `accept` attributes
6. **Limit file sizes** - Set reasonable limits (10MB for receipts)













