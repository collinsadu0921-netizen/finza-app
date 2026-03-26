"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

// ---------- types ------------------------------------------------------------

type ClientRequest = {
  id: string
  firm_id: string
  client_business_id: string
  engagement_id: string
  title: string
  description: string
  status: "open" | "in_progress" | "completed" | "cancelled"
  created_by: string
  due_at: string | null
  completed_at: string | null
  document_type: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

type Comment = {
  id: string
  request_id: string
  firm_id: string
  author_user_id: string
  body: string
  created_at: string
}

type Attachment = {
  id: string
  request_id: string
  file_name: string
  storage_path: string
  mime_type: string
  file_size: number
  uploaded_by_user_id: string
  created_at: string
  signed_url: string | null
}

const STATUS_OPTIONS: ClientRequest["status"][] = [
  "open",
  "in_progress",
  "completed",
  "cancelled",
]

// ---------- helpers ----------------------------------------------------------

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function isOverdue(r: ClientRequest): boolean {
  if (!r.due_at || r.status === "completed" || r.status === "cancelled") return false
  return new Date(r.due_at) < new Date()
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200)
}

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

const STATUS_CHIP: Record<ClientRequest["status"], string> = {
  open: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
}

// ---------- attachments section ----------------------------------------------

function AttachmentsSection({
  requestId,
  businessId,
}: {
  requestId: string
  businessId: string
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(
        `/api/accounting/requests/${requestId}/attachments?business_id=${encodeURIComponent(businessId)}`
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Failed to load attachments (${res.status})`)
        return
      }
      setAttachments(data.attachments ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [requestId, businessId])

  useEffect(() => {
    load()
  }, [load])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!fileInputRef.current) fileInputRef.current = e.target
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large — maximum is ${formatBytes(MAX_FILE_SIZE)}`)
      e.target.value = ""
      return
    }

    setUploading(true)
    setError("")
    setUploadProgress("Uploading to storage…")

    try {
      // Step 1: upload file directly to Supabase Storage (matches repo pattern)
      const safeName = sanitizeFileName(file.name)
      const storagePath = `accounting-requests/${requestId}/${Date.now()}-${safeName}`

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

      // Step 2: register metadata via API
      setUploadProgress("Registering attachment…")
      const res = await fetch(`/api/accounting/requests/${requestId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          file_name: file.name,
          storage_path: storagePath,
          mime_type: file.type || "application/octet-stream",
          file_size: file.size,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Registration failed (${res.status})`)
        // The file is already in storage; registration failure is recoverable
        // by re-trying — log but don't block.
        return
      }

      await load()
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
      setUploadProgress("")
    }
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 mt-4 pt-4">
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
        Attachments
      </h3>

      {error && (
        <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-3">
          <div className="h-4 w-4 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : attachments.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">No attachments yet.</p>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center gap-2 min-w-0">
                {/* Generic file icon */}
                <svg
                  className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                  />
                </svg>
                <span className="text-sm text-gray-900 dark:text-white truncate">{a.file_name}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                  {formatBytes(a.file_size)}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {fmtDate(a.created_at)}
                </span>
                {a.signed_url ? (
                  <a
                    href={a.signed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Download
                  </a>
                ) : (
                  <span className="text-xs text-gray-400 dark:text-gray-500">Expired</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Upload control */}
      <div className="flex items-center gap-3">
        <label className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
          uploading
            ? "border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 cursor-not-allowed"
            : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        }`}>
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          {uploading ? uploadProgress || "Uploading…" : "Attach file"}
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            disabled={uploading}
            onChange={handleFileChange}
          />
        </label>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Max {formatBytes(MAX_FILE_SIZE)}
        </span>
      </div>
    </div>
  )
}

// ---------- comment thread ---------------------------------------------------

function CommentThread({
  requestId,
  businessId,
}: {
  requestId: string
  businessId: string
}) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [body, setBody] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(
        `/api/accounting/requests/${requestId}/comments?business_id=${encodeURIComponent(businessId)}`
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Failed to load comments (${res.status})`)
        return
      }
      setComments(data.comments ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [requestId, businessId])

  useEffect(() => {
    load()
  }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch(`/api/accounting/requests/${requestId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, body: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || data.reason || `Failed to add comment (${res.status})`)
        return
      }
      setBody("")
      await load()
      // Re-focus textarea for quick follow-up
      textareaRef.current?.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add comment")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 mt-4 pt-4">
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
        Comments
      </h3>

      {error && (
        <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">No comments yet.</p>
      ) : (
        <ul className="space-y-3 mb-4">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              {/* Avatar placeholder */}
              <div className="mt-0.5 flex-shrink-0 h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                  {c.author_user_id.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    Firm member
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {fmtDateTime(c.created_at)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-900 dark:text-white whitespace-pre-wrap break-words">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add comment form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Add a comment…"
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none"
          disabled={submitting}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleSubmit(e as unknown as React.FormEvent)
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 dark:text-gray-500">⌘↵ to submit</span>
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Adding…" : "Add comment"}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------- main page --------------------------------------------------------

export default function ClientRequestsPage() {
  const params = useParams()
  const businessId = params.id as string

  const [requests, setRequests] = useState<ClientRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [documentType, setDocumentType] = useState("")
  const [dueAt, setDueAt] = useState("")

  const load = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(
        `/api/accounting/requests?business_id=${encodeURIComponent(businessId)}`
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Failed to load (${res.status})`)
        setRequests([])
        return
      }
      setRequests(data.requests ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
      setRequests([])
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setCreating(true)
    setError("")
    try {
      const res = await fetch("/api/accounting/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          title: title.trim(),
          description: description.trim(),
          document_type: documentType.trim() || undefined,
          due_at: dueAt || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || data.reason || `Create failed (${res.status})`)
        return
      }
      setTitle("")
      setDescription("")
      setDocumentType("")
      setDueAt("")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed")
    } finally {
      setCreating(false)
    }
  }

  async function updateStatus(id: string, status: ClientRequest["status"]) {
    setError("")
    try {
      const res = await fetch(`/api/accounting/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Update failed (${res.status})`)
        return
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed")
    }
  }

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const openRequests = requests.filter((r) => r.status === "open" || r.status === "in_progress")
  const closedRequests = requests.filter((r) => r.status === "completed" || r.status === "cancelled")

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Client requests</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Track information and document requests for this client.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {/* New request form */}
      <form
        onSubmit={handleCreate}
        className="mb-8 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3"
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">New request</h2>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="e.g. Bank statements Q4"
            required
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="What you need from the client"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Document type
            </label>
            <input
              type="text"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Due date
            </label>
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={creating || !title.trim()}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {creating ? "Creating…" : "Create request"}
        </button>
      </form>

      {/* Request list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No requests yet.</p>
      ) : (
        <div className="space-y-3">
          {/* Open / in-progress */}
          {openRequests.length > 0 && (
            <div className="space-y-3">
              {openRequests.map((r) => (
                <RequestCard
                  key={r.id}
                  r={r}
                  businessId={businessId}
                  expanded={expandedId === r.id}
                  onToggle={() => toggleExpanded(r.id)}
                  onStatusChange={(status) => updateStatus(r.id, status)}
                />
              ))}
            </div>
          )}

          {/* Closed */}
          {closedRequests.length > 0 && (
            <div className="space-y-3">
              {openRequests.length > 0 && (
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide pt-2">
                  Closed
                </p>
              )}
              {closedRequests.map((r) => (
                <RequestCard
                  key={r.id}
                  r={r}
                  businessId={businessId}
                  expanded={expandedId === r.id}
                  onToggle={() => toggleExpanded(r.id)}
                  onStatusChange={(status) => updateStatus(r.id, status)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- request card -----------------------------------------------------

function RequestCard({
  r,
  businessId,
  expanded,
  onToggle,
  onStatusChange,
}: {
  r: ClientRequest
  businessId: string
  expanded: boolean
  onToggle: () => void
  onStatusChange: (status: ClientRequest["status"]) => void
}) {
  const overdue = isOverdue(r)

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Header row */}
      <div className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-gray-900 dark:text-white">{r.title}</p>
            {r.description ? (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{r.description}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              {r.document_type && <span>Type: {r.document_type}</span>}
              {r.due_at && (
                <span className={overdue ? "text-red-600 dark:text-red-400 font-medium" : ""}>
                  {overdue ? "Overdue · " : "Due "}
                  {fmtDate(r.due_at)}
                </span>
              )}
              {r.completed_at && <span>Completed: {fmtDate(r.completed_at)}</span>}
              <span className="text-gray-400 dark:text-gray-500">
                Created {fmtDate(r.created_at)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Status badge */}
            <span
              className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_CHIP[r.status]}`}
            >
              {r.status.replace(/_/g, " ")}
            </span>

            {/* Status dropdown */}
            <select
              value={r.status}
              onChange={(e) => onStatusChange(e.target.value as ClientRequest["status"])}
              className="text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Comments toggle */}
        <button
          type="button"
          onClick={onToggle}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          {expanded ? "Hide comments" : "Comments"}
          <svg
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Expandable attachments + comment thread */}
      {expanded && (
        <div className="px-4 pb-4">
          <AttachmentsSection requestId={r.id} businessId={businessId} />
          <CommentThread requestId={r.id} businessId={businessId} />
        </div>
      )}
    </div>
  )
}
