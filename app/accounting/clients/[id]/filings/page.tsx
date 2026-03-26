"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

// ---------- types ------------------------------------------------------------

type FilingStatus = "pending" | "in_progress" | "filed" | "accepted" | "rejected" | "cancelled"

type ClientFiling = {
  id: string
  firm_id: string
  client_business_id: string
  period_id: string | null
  filing_type: string
  status: FilingStatus
  created_by_user_id: string
  filed_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

type FilingComment = {
  id: string
  filing_id: string
  firm_id: string
  client_business_id: string
  author_user_id: string
  body: string
  created_at: string
  updated_at: string
}

type FilingAttachment = {
  id: string
  filing_id: string
  file_name: string
  storage_path: string
  mime_type: string
  file_size: number
  uploaded_by_user_id: string
  created_at: string
  signed_url: string | null
}

type FilingTemplate = {
  id: string
  name: string
  filing_type: string
  items: { id: string; title: string; note: string; sort_order: number }[]
}

type ChecklistItemStatus = "pending" | "done" | "na"

type ChecklistItem = {
  id: string
  filing_id: string
  firm_id: string
  client_business_id: string
  title: string
  status: ChecklistItemStatus
  note: string
  created_by_user_id: string
  completed_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ---------- constants --------------------------------------------------------

const FILING_TYPES = [
  "VAT",
  "CIT",
  "PAYE",
  "SSNIT",
  "Annual Returns",
  "Withholding Tax",
  "GRA Audit Response",
  "Other",
]

const VALID_STATUSES: FilingStatus[] = [
  "pending",
  "in_progress",
  "filed",
  "accepted",
  "rejected",
  "cancelled",
]

// ---------- helpers ----------------------------------------------------------

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function fmtDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

// ---------- status badge -----------------------------------------------------

const STATUS_STYLES: Record<FilingStatus, string> = {
  pending:     "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  filed:       "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  accepted:    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  rejected:    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  cancelled:   "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
}

function StatusBadge({ status }: { status: FilingStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  )
}

// ---------- status transitions allowed per state -----------------------------

const NEXT_STATUSES: Record<FilingStatus, FilingStatus[]> = {
  pending:     ["in_progress", "cancelled"],
  in_progress: ["filed", "pending", "cancelled"],
  filed:       ["accepted", "rejected", "in_progress"],
  accepted:    ["filed"],
  rejected:    ["in_progress", "cancelled"],
  cancelled:   ["pending"],
}

// ---------- filing attachments section ---------------------------------------

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function sanitizeForPath(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200)
}

function FilingAttachmentsSection({
  businessId,
  filingId,
}: {
  businessId: string
  filingId: string
}) {
  const [attachments, setAttachments] = useState<FilingAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const base = `/api/accounting/clients/${encodeURIComponent(businessId)}/filings/${encodeURIComponent(filingId)}/attachments`

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(base)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Failed to load attachments (${res.status})`); return }
      setAttachments(data.attachments ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { load() }, [load])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large — max is ${formatBytes(MAX_FILE_SIZE)}`)
      e.target.value = ""
      return
    }

    setUploading(true)
    setError("")
    setUploadProgress("Uploading to storage…")

    try {
      // Step 1: browser → Supabase Storage directly (matches repo pattern)
      const safeName = sanitizeForPath(file.name)
      const storagePath = `accounting-filings/${filingId}/${Date.now()}-${safeName}`

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

      // Step 2: register metadata via API (also verifies existence + authorization)
      setUploadProgress("Registering attachment…")
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: file.name,
          storage_path: storagePath,
          mime_type: file.type || "application/octet-stream",
          file_size: file.size,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Registration failed (${res.status})`)
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
    <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4">
      <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
        Attachments
      </span>

      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-3">
          <div className="h-4 w-4 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : attachments.length === 0 ? (
        <p className="mb-3 text-sm text-gray-400 dark:text-gray-500">No attachments yet.</p>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center gap-2 min-w-0">
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
        <label
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
            uploading
              ? "border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 cursor-not-allowed"
              : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          }`}
        >
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

// ---------- filing comment thread --------------------------------------------

function FilingCommentThread({
  businessId,
  filingId,
}: {
  businessId: string
  filingId: string
}) {
  const [comments, setComments] = useState<FilingComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [draft, setDraft] = useState("")
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const base = `/api/accounting/clients/${encodeURIComponent(businessId)}/filings/${encodeURIComponent(filingId)}/comments`

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(base)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Failed (${res.status})`); return }
      setComments(data.comments ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { load() }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    setPosting(true)
    setPostError("")
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setPostError(data.error || `Failed (${res.status})`); return }
      setDraft("")
      await load()
      textareaRef.current?.focus()
    } catch (e) {
      setPostError(e instanceof Error ? e.message : "Failed to post")
    } finally {
      setPosting(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  return (
    <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4">
      <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
        Comments
      </span>

      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-3">
          <div className="h-4 w-4 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : comments.length === 0 ? (
        <p className="mb-3 text-sm text-gray-400 dark:text-gray-500">No comments yet.</p>
      ) : (
        <ol className="space-y-3 mb-4">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40">
                <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-300">
                  {c.author_user_id.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">
                  {fmtDateTime(c.created_at)}
                </p>
                <p className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap leading-relaxed">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Add comment form */}
      <form onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a comment… (⌘↵ to post)"
          rows={2}
          disabled={posting}
          className="w-full resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        {postError && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{postError}</p>
        )}
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={posting || !draft.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {posting ? (
              <span className="inline-block h-3 w-3 rounded-full border-b-2 border-white animate-spin" />
            ) : null}
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------- template picker --------------------------------------------------

function TemplatePicker({
  businessId,
  filingId,
  filingType,
  onApplied,
}: {
  businessId: string
  filingId: string
  filingType: string
  onApplied: () => void
}) {
  const [templates, setTemplates] = useState<FilingTemplate[]>([])
  const [loadingTpl, setLoadingTpl] = useState(true)
  const [selectedId, setSelectedId] = useState("")
  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState("")
  const [applyError, setApplyError] = useState("")
  // Create template inline form
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newItems, setNewItems] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  useEffect(() => {
    let cancelled = false
    async function fetchTemplates() {
      setLoadingTpl(true)
      try {
        const qs = filingType ? `?filing_type=${encodeURIComponent(filingType)}` : ""
        const res = await fetch(`/api/accounting/filing-templates${qs}`)
        const data = await res.json().catch(() => ({}))
        if (!cancelled && res.ok) {
          setTemplates(data.templates ?? [])
          if (data.templates?.length === 1) setSelectedId(data.templates[0].id)
        }
      } finally {
        if (!cancelled) setLoadingTpl(false)
      }
    }
    fetchTemplates()
    return () => { cancelled = true }
  }, [filingType])

  async function handleApply() {
    if (!selectedId) return
    setApplying(true)
    setApplyError("")
    setApplyMsg("")
    try {
      const res = await fetch(
        `/api/accounting/clients/${encodeURIComponent(businessId)}/filings/${encodeURIComponent(filingId)}/apply-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template_id: selectedId }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setApplyError(data.error || `Failed (${res.status})`)
        return
      }
      setApplyMsg(`Applied "${data.template_name}" — ${data.items_created} items added`)
      onApplied()
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Failed to apply")
    } finally {
      setApplying(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    const itemLines = newItems
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
    if (!name || itemLines.length === 0) return
    setSaving(true)
    setSaveError("")
    try {
      const res = await fetch("/api/accounting/filing-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          filing_type: filingType,
          items: itemLines.map((title, idx) => ({ title, sort_order: idx })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(data.error || `Failed (${res.status})`)
        return
      }
      const created: FilingTemplate = data.template
      setTemplates((prev) => [created, ...prev])
      setSelectedId(created.id)
      setNewName("")
      setNewItems("")
      setCreating(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to create")
    } finally {
      setSaving(false)
    }
  }

  if (loadingTpl) return null // silent — checklist loads independently

  return (
    <div className="mb-3 pb-3 border-b border-gray-100 dark:border-gray-700">
      {templates.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setApplyMsg(""); setApplyError("") }}
            className="flex-1 min-w-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Apply a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.items.length} items)
              </option>
            ))}
          </select>
          <button
            onClick={handleApply}
            disabled={applying || !selectedId}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {applying ? (
              <span className="h-3 w-3 rounded-full border-b-2 border-white animate-spin" />
            ) : null}
            {applying ? "Applying…" : "Apply"}
          </button>
          <button
            onClick={() => setCreating((v) => !v)}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400"
          >
            + new
          </button>
        </div>
      ) : (
        <button
          onClick={() => setCreating((v) => !v)}
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400"
        >
          + Create template for {filingType}
        </button>
      )}

      {applyMsg && <p className="mt-1 text-xs text-green-600 dark:text-green-400">{applyMsg}</p>}
      {applyError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{applyError}</p>}

      {creating && (
        <form onSubmit={handleCreate} className="mt-2 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Template name"
            required
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <textarea
            value={newItems}
            onChange={(e) => setNewItems(e.target.value)}
            placeholder={"One checklist item per line:\nCollect VAT invoices\nReconcile output tax\nPrepare return form"}
            rows={4}
            required
            className="w-full resize-y rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {saveError && <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving || !newName.trim() || !newItems.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? (
                <span className="h-3 w-3 rounded-full border-b-2 border-white animate-spin" />
              ) : null}
              {saving ? "Saving…" : "Save template"}
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setSaveError("") }}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ---------- checklist section ------------------------------------------------

function ChecklistSection({
  businessId,
  filingId,
  filingType,
}: {
  businessId: string
  filingId: string
  filingType: string
}) {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [draft, setDraft] = useState("")
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState("")
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const base = `/api/accounting/clients/${encodeURIComponent(businessId)}/filings/${encodeURIComponent(filingId)}/checklist`

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(base)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Failed (${res.status})`); return }
      setItems(data.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { load() }, [load])

  async function addItem(e: React.FormEvent) {
    e.preventDefault()
    const title = draft.trim()
    if (!title) return
    setAdding(true)
    setAddError("")
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setAddError(data.error || `Failed (${res.status})`); return }
      setDraft("")
      await load()
      inputRef.current?.focus()
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to add")
    } finally {
      setAdding(false)
    }
  }

  async function patchItem(itemId: string, patch: Record<string, unknown>) {
    setTogglingId(itemId)
    try {
      const res = await fetch(`${base}/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (res.ok) await load()
    } finally {
      setTogglingId(null)
    }
  }

  function cycleStatus(item: ChecklistItem) {
    const next: ChecklistItemStatus =
      item.status === "pending" ? "done"
      : item.status === "done"    ? "pending"
      : "pending"
    patchItem(item.id, { status: next })
  }

  function markNa(item: ChecklistItem) {
    patchItem(item.id, { status: item.status === "na" ? "pending" : "na" })
  }

  async function saveNote(itemId: string) {
    await patchItem(itemId, { note: noteDraft })
    setEditingNoteId(null)
  }

  const doneCount = items.filter((i) => i.status === "done").length
  const totalCount = items.length

  return (
    <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Checklist
        </span>
        {totalCount > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {doneCount}/{totalCount} done
          </span>
        )}
      </div>

      {/* Template picker */}
      <TemplatePicker
        businessId={businessId}
        filingId={filingId}
        filingType={filingType}
        onApplied={load}
      />

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="mb-3 h-1 w-full rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className="h-1 rounded-full bg-green-500 transition-all"
            style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
          />
        </div>
      )}

      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-3">
          <div className="h-4 w-4 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : (
        <ul className="space-y-1 mb-3">
          {items.map((item) => {
            const isToggling = togglingId === item.id
            const isDone = item.status === "done"
            const isNa   = item.status === "na"
            const isEditingNote = editingNoteId === item.id

            return (
              <li key={item.id} className="group">
                <div className="flex items-start gap-2">
                  {/* Checkbox */}
                  <button
                    onClick={() => cycleStatus(item)}
                    disabled={isToggling}
                    aria-label={isDone ? "Mark pending" : "Mark done"}
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-50 ${
                      isDone
                        ? "border-green-500 bg-green-500 text-white"
                        : isNa
                        ? "border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700"
                        : "border-gray-300 dark:border-gray-600 hover:border-green-400"
                    }`}
                  >
                    {isDone && (
                      <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    )}
                    {isNa && (
                      <span className="text-[8px] font-bold text-gray-400 dark:text-gray-500 leading-none">—</span>
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    {/* Title */}
                    <span
                      className={`text-sm leading-snug ${
                        isDone
                          ? "line-through text-gray-400 dark:text-gray-500"
                          : isNa
                          ? "text-gray-400 dark:text-gray-500"
                          : "text-gray-900 dark:text-white"
                      }`}
                    >
                      {item.title}
                    </span>

                    {/* Inline note */}
                    {isEditingNote ? (
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          autoFocus
                          type="text"
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveNote(item.id)
                            if (e.key === "Escape") setEditingNoteId(null)
                          }}
                          placeholder="Add a note…"
                          className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-0.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => saveNote(item.id)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingNoteId(null)}
                          className="text-xs text-gray-400 dark:text-gray-500 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : item.note ? (
                      <button
                        onClick={() => { setEditingNoteId(item.id); setNoteDraft(item.note) }}
                        className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-left"
                      >
                        {item.note}
                      </button>
                    ) : (
                      <button
                        onClick={() => { setEditingNoteId(item.id); setNoteDraft("") }}
                        className="mt-0.5 hidden text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 group-hover:block"
                      >
                        + note
                      </button>
                    )}
                  </div>

                  {/* N/A toggle */}
                  <button
                    onClick={() => markNa(item)}
                    disabled={isToggling}
                    className={`shrink-0 text-xs px-1.5 py-0.5 rounded transition-colors disabled:opacity-50 ${
                      isNa
                        ? "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200"
                        : "text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400"
                    }`}
                  >
                    N/A
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Add item form */}
      <form onSubmit={addItem} className="flex items-center gap-2 mt-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add checklist item…"
          disabled={adding}
          className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-1.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={adding || !draft.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {adding ? (
            <span className="h-3 w-3 rounded-full border-b-2 border-current animate-spin" />
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          )}
          Add
        </button>
      </form>
      {addError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{addError}</p>}
    </div>
  )
}

// ---------- filing card -------------------------------------------------------

function FilingCard({
  filing,
  businessId,
  onUpdated,
}: {
  filing: ClientFiling
  businessId: string
  onUpdated: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [expandedComments, setExpandedComments] = useState(false)
  const [expandedAttachments, setExpandedAttachments] = useState(false)
  const nextStatuses = NEXT_STATUSES[filing.status] ?? []

  async function updateStatus(newStatus: FilingStatus) {
    setSaving(true)
    setError("")
    try {
      const res = await fetch(
        `/api/accounting/clients/${encodeURIComponent(businessId)}/filings/${encodeURIComponent(filing.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Update failed (${res.status})`)
        return
      }
      onUpdated()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {filing.filing_type}
            </span>
            <StatusBadge status={filing.status} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
            <span>Created {fmtDate(filing.created_at)}</span>
            {filing.filed_at && <span>Filed {fmtDate(filing.filed_at)}</span>}
            {filing.period_id && <span>Period: {filing.period_id.slice(0, 8)}…</span>}
          </div>
        </div>

        {/* Status transition buttons */}
        {nextStatuses.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {nextStatuses.map((next) => (
              <button
                key={next}
                disabled={saving}
                onClick={() => updateStatus(next)}
                className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  next === "cancelled" || next === "rejected"
                    ? "border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    : next === "accepted" || next === "filed"
                    ? "border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
                    : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                {saving ? (
                  <span className="inline-block h-3 w-3 rounded-full border-b-2 border-current animate-spin" />
                ) : null}
                Mark {next.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Last updated {fmtDateTime(filing.updated_at)}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
            {expanded ? "Hide checklist" : "Checklist"}
          </button>
          <button
            onClick={() => setExpandedComments((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${expandedComments ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
            {expandedComments ? "Hide comments" : "Comments"}
          </button>
          <button
            onClick={() => setExpandedAttachments((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${expandedAttachments ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
            {expandedAttachments ? "Hide files" : "Files"}
          </button>
        </div>
      </div>

      {expanded && (
        <ChecklistSection businessId={businessId} filingId={filing.id} filingType={filing.filing_type} />
      )}

      {expandedComments && (
        <FilingCommentThread businessId={businessId} filingId={filing.id} />
      )}

      {expandedAttachments && (
        <FilingAttachmentsSection businessId={businessId} filingId={filing.id} />
      )}
    </div>
  )
}

// ---------- create filing form -----------------------------------------------

function CreateFilingForm({
  businessId,
  onCreated,
}: {
  businessId: string
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [filingType, setFilingType] = useState("")
  const [customType, setCustomType] = useState("")
  const [filedAt, setFiledAt] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const resolvedType = filingType === "Other" ? customType.trim() : filingType

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!resolvedType) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch(
        `/api/accounting/clients/${encodeURIComponent(businessId)}/filings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filing_type: resolvedType,
            filed_at: filedAt || null,
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`)
        return
      }
      setOpen(false)
      setFilingType("")
      setCustomType("")
      setFiledAt("")
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create")
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New filing
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">New filing</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Filing type <span className="text-red-500">*</span>
          </label>
          <select
            value={filingType}
            onChange={(e) => setFilingType(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select type…</option>
            {FILING_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {filingType === "Other" && (
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Custom type <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={customType}
              onChange={(e) => setCustomType(e.target.value)}
              placeholder="e.g. Transfer Pricing Report"
              required
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Filed date{" "}
            <span className="text-gray-400 dark:text-gray-500 font-normal">(optional — leave blank to set later)</span>
          </label>
          <input
            type="date"
            value={filedAt}
            onChange={(e) => setFiledAt(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving || !resolvedType}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <span className="inline-block h-3.5 w-3.5 rounded-full border-b-2 border-white animate-spin" />
            ) : null}
            {saving ? "Creating…" : "Create filing"}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setError("") }}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------- filter bar -------------------------------------------------------

function FilterBar({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const options: { label: string; value: string }[] = [
    { label: "All", value: "" },
    ...VALID_STATUSES.map((s) => ({ label: s.replace(/_/g, " "), value: s })),
  ]
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value
              ? "bg-blue-600 text-white"
              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------- page -------------------------------------------------------------

export default function ClientFilingsPage() {
  const params = useParams()
  const businessId = params.id as string

  const [filings, setFilings] = useState<ClientFiling[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  const load = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError("")
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ""
      const res = await fetch(
        `/api/accounting/clients/${encodeURIComponent(businessId)}/filings${qs}`
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Failed to load filings (${res.status})`)
        return
      }
      setFilings(data.filings ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [businessId, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  const activeCount  = filings.filter((f) => f.status === "in_progress").length
  const pendingCount = filings.filter((f) => f.status === "pending").length
  const filedCount   = filings.filter((f) => f.status === "filed" || f.status === "accepted").length

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Filings</h2>
          {!loading && !error && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {pendingCount} pending · {activeCount} in progress · {filedCount} filed/accepted
            </p>
          )}
        </div>
        <CreateFilingForm businessId={businessId} onCreated={load} />
      </div>

      {/* Filter */}
      <div className="mb-5">
        <FilterBar value={statusFilter} onChange={setStatusFilter} />
      </div>

      {/* Content */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-7 w-7 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : filings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <svg
            className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3"
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
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {statusFilter ? `No ${statusFilter.replace(/_/g, " ")} filings` : "No filings yet"}
          </p>
          {!statusFilter && (
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Create a filing to start tracking submissions for this client.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filings.map((f) => (
            <FilingCard
              key={f.id}
              filing={f}
              businessId={businessId}
              onUpdated={load}
            />
          ))}
        </div>
      )}
    </div>
  )
}
