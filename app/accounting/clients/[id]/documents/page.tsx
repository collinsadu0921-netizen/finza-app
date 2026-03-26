"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

// ---------- types ------------------------------------------------------------

type ClientDocument = {
  id: string
  firm_id: string
  client_business_id: string
  uploaded_by_user_id: string
  title: string
  category: string
  note: string
  file_name: string
  storage_path: string
  mime_type: string
  file_size: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  signed_url: string | null
}

// ---------- constants --------------------------------------------------------

const CATEGORIES = [
  "Tax Returns",
  "Financial Statements",
  "Bank Statements",
  "Contracts",
  "ID Documents",
  "Audit Evidence",
  "Correspondence",
  "Working Papers",
  "Other",
]

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

// ---------- helpers ----------------------------------------------------------

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: "short", day: "numeric",
    }).format(new Date(iso))
  } catch { return iso }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function sanitizeForPath(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200)
}

function mimeIcon(mime: string): string {
  if (mime.startsWith("image/")) return "🖼"
  if (mime === "application/pdf") return "📄"
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.endsWith(".xlsx")) return "📊"
  if (mime.includes("word") || mime.includes("document")) return "📝"
  if (mime.startsWith("text/")) return "📃"
  if (mime.includes("zip") || mime.includes("compressed")) return "🗜"
  return "📎"
}

// ---------- upload form ------------------------------------------------------

function UploadForm({
  businessId,
  onUploaded,
}: {
  businessId: string
  onUploaded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState("")
  const [note, setNote] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setTitle("")
    setCategory("")
    setNote("")
    setFile(null)
    setError("")
    setProgress("")
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    if (!f) { setFile(null); return }
    if (f.size > MAX_FILE_SIZE) {
      setError(`File too large — max is ${formatBytes(MAX_FILE_SIZE)}`)
      e.target.value = ""
      setFile(null)
      return
    }
    setError("")
    setFile(f)
    // Auto-fill title from filename if empty
    if (!title) setTitle(f.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " "))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !title.trim()) return
    setUploading(true)
    setError("")

    try {
      setProgress("Uploading to storage…")

      const safeName = sanitizeForPath(file.name)
      const storagePath = `accounting-documents/${encodeURIComponent(businessId)}/${Date.now()}-${safeName}`

      const { error: uploadErr } = await supabase.storage
        .from("documents")
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "application/octet-stream",
        })

      if (uploadErr) {
        setError(`Storage upload failed: ${uploadErr.message}`)
        return
      }

      setProgress("Saving document record…")

      const res = await fetch(
        `/api/accounting/clients/${encodeURIComponent(businessId)}/documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            category: category.trim(),
            note: note.trim(),
            file_name: file.name,
            storage_path: storagePath,
            mime_type: file.type || "application/octet-stream",
            file_size: file.size,
          }),
        }
      )

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Registration failed (${res.status})`)
        return
      }

      reset()
      setOpen(false)
      onUploaded()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
      setProgress("")
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
        Upload document
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-5">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Upload document</h3>
      <form onSubmit={handleSubmit} className="space-y-3">

        {/* File picker */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            File <span className="text-red-500">*</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            required
            disabled={uploading}
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-900 dark:text-white file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-700 disabled:opacity-50"
          />
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
            Max {formatBytes(MAX_FILE_SIZE)}
            {file && ` · ${formatBytes(file.size)}`}
          </p>
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={uploading}
            placeholder="e.g. Q3 2024 VAT Return"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={uploading}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            <option value="">Uncategorised</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Note */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Note{" "}
            <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={uploading}
            placeholder="e.g. Filed with GRA on 15 Oct 2024"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {progress && !error && (
          <p className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
            <span className="inline-block h-3 w-3 rounded-full border-b-2 border-blue-600 animate-spin" />
            {progress}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={uploading || !file || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {uploading ? (
              <span className="inline-block h-3.5 w-3.5 rounded-full border-b-2 border-white animate-spin" />
            ) : null}
            {uploading ? "Uploading…" : "Upload"}
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => { reset(); setOpen(false) }}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------- document row -----------------------------------------------------

function DocumentRow({ doc }: { doc: ClientDocument }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-xl shrink-0 mt-0.5" aria-hidden>
          {mimeIcon(doc.mime_type)}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{doc.title}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{doc.file_name}</p>
          {doc.note && (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 italic">{doc.note}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400 dark:text-gray-500">
            {doc.category && (
              <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300">
                {doc.category}
              </span>
            )}
            <span>{formatBytes(doc.file_size)}</span>
            <span>{fmtDate(doc.created_at)}</span>
          </div>
        </div>
      </div>

      <div className="shrink-0">
        {doc.signed_url ? (
          <a
            href={doc.signed_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M12 3v13.5m0 0 4.5-4.5M12 16.5l-4.5-4.5" />
            </svg>
            Download
          </a>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500 px-3 py-1.5">Link expired</span>
        )}
      </div>
    </div>
  )
}

// ---------- filter bar -------------------------------------------------------

function CategoryFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        onClick={() => onChange("")}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          value === ""
            ? "bg-blue-600 text-white"
            : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
        }`}
      >
        All
      </button>
      {CATEGORIES.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            value === c
              ? "bg-blue-600 text-white"
              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  )
}

// ---------- page -------------------------------------------------------------

export default function ClientDocumentsPage() {
  const params = useParams()
  const businessId = params.id as string

  const [documents, setDocuments] = useState<ClientDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")

  const load = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError("")
    try {
      const qs = categoryFilter ? `?category=${encodeURIComponent(categoryFilter)}` : ""
      const res = await fetch(
        `/api/accounting/clients/${encodeURIComponent(businessId)}/documents${qs}`
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Failed to load documents (${res.status})`)
        return
      }
      setDocuments(data.documents ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [businessId, categoryFilter])

  useEffect(() => { load() }, [load])

  // Group documents by category for display
  const grouped: Record<string, ClientDocument[]> = {}
  for (const doc of documents) {
    const key = doc.category || "Uncategorised"
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(doc)
  }
  const groupKeys = Object.keys(grouped).sort()

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Document vault</h2>
          {!loading && !error && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {documents.length} document{documents.length !== 1 ? "s" : ""}
              {categoryFilter ? ` in "${categoryFilter}"` : ""}
            </p>
          )}
        </div>
        <UploadForm businessId={businessId} onUploaded={load} />
      </div>

      {/* Category filter */}
      <div className="mb-5 overflow-x-auto pb-1">
        <CategoryFilter value={categoryFilter} onChange={setCategoryFilter} />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-7 w-7 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <svg
            className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
            />
          </svg>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {categoryFilter ? `No documents in "${categoryFilter}"` : "No documents yet"}
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            Upload documents to start building this client's vault.
          </p>
        </div>
      ) : categoryFilter ? (
        // Flat list when filtered
        <div className="space-y-2">
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} />
          ))}
        </div>
      ) : (
        // Grouped by category when showing all
        <div className="space-y-6">
          {groupKeys.map((key) => (
            <section key={key}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {key}
                <span className="ml-2 font-normal normal-case text-gray-400 dark:text-gray-500">
                  ({grouped[key].length})
                </span>
              </h3>
              <div className="space-y-2">
                {grouped[key].map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
