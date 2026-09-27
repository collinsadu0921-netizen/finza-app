"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { buildServiceRoute } from "@/lib/service/routes"
import type { IncomingDocumentListSummary } from "@/lib/documents/incomingDocumentsList"
import {
  documentVisual,
  formatInboxAmount,
  inboxPrimaryAction,
  inboxPrimaryLabel,
  inboxRowFileName,
  inboxRowFromLine,
  inboxRowSecondary,
  inboxRowTitle,
  inboxStatusText,
  inboxStatusTone,
  sharesInboundEmail,
} from "@/lib/documents/incomingDocumentPresentation"

function StatusLabel({ label }: { label: string }) {
  const tone = inboxStatusTone(label)
  const classes = {
    reading: "bg-slate-100 text-slate-600",
    review: "bg-amber-50 text-amber-900",
    ready: "bg-sky-50 text-sky-900",
    handled: "bg-emerald-50 text-emerald-900",
    failed: "bg-red-50 text-red-800",
  }[tone]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>
      {tone === "reading" ? <span className="h-2 w-2 animate-spin rounded-full border border-slate-400 border-t-transparent" aria-hidden /> : null}
      {label}
    </span>
  )
}

function DocumentMark({ row }: { row: IncomingDocumentListSummary }) {
  const visual = documentVisual(row)
  const email = row.source_type === "email_inbound"
  return (
    <span className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-semibold text-slate-500" aria-hidden>
      {visual === "pdf" ? "PDF" : visual === "image" ? "IMG" : "DOC"}
      {email ? <span className="absolute -bottom-1 -right-1 rounded bg-white px-0.5 text-[9px] text-slate-500 ring-1 ring-slate-200">@</span> : null}
    </span>
  )
}

export default function IncomingDocumentsListPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [rows, setRows] = useState<IncomingDocumentListSummary[]>([])
  const [searchDraft, setSearchDraft] = useState("")
  const [uploading, setUploading] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const box = searchParams.get("box") || "inbox"
  const effectiveBusinessId = searchParams.get("business_id") || businessId

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value == null || value === "") next.delete(key)
        else next.set(key, value)
      }
      router.replace(`/service/incoming-documents?${next.toString()}`)
    },
    [router, searchParams]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const biz = await getCurrentBusiness(supabase, user.id)
      if (!cancelled) setBusinessId(biz?.id ?? null)
    })()
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    if (!effectiveBusinessId) return
    setLoading(true)
    setError("")
    const qs = new URLSearchParams()
    qs.set("business_id", effectiveBusinessId)
    qs.set("limit", "50")
    const q = searchParams.get("q")
    if (q) qs.set("q", q)
    if (box === "handled") qs.set("linked", "linked")
    else qs.set("linked", "unlinked")
    if (box === "review") qs.set("attention", "1")
    const kind = searchParams.get("document_kind")
    const source = searchParams.get("source_type")
    const status = searchParams.get("status")
    const from = searchParams.get("from")
    const to = searchParams.get("to")
    if (kind) qs.set("document_kind", kind)
    if (source) qs.set("source_type", source)
    if (status) qs.set("status", status)
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    const res = await fetch(`/api/incoming-documents?${qs.toString()}`)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Could not load documents")
      setRows([])
    } else {
      setRows(Array.isArray(data?.documents) ? data.documents : [])
    }
    setLoading(false)
  }, [box, effectiveBusinessId, searchParams])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setSearchDraft(searchParams.get("q") ?? "") }, [searchParams])

  useEffect(() => {
    if (!rows.length) return
    if (!window.matchMedia("(min-width: 1024px)").matches) return
    if (selectedId && rows.some((row) => row.id === selectedId)) return
    setSelectedId(rows[0].id)
  }, [rows, selectedId])

  useEffect(() => {
    if (!selectedId || !effectiveBusinessId) {
      setPreviewUrl(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/incoming-documents/${encodeURIComponent(selectedId)}?business_id=${encodeURIComponent(effectiveBusinessId)}`)
      const data = await res.json().catch(() => null)
      if (!cancelled) setPreviewUrl(typeof data?.preview_url === "string" ? data.preview_url : null)
    })()
    return () => { cancelled = true }
  }, [effectiveBusinessId, selectedId])

  async function uploadDocument(file: File) {
    if (!effectiveBusinessId) return
    setUploading(true)
    setError("")
    try {
      const safeName = file.name.replace(/[^\w.\-]+/g, "_")
      const storagePath = `incoming/${effectiveBusinessId}/${Date.now()}_${safeName}`
      const uploaded = await supabase.storage.from("receipts").upload(storagePath, file)
      if (uploaded.error) {
        setError("Could not upload that document.")
        return
      }
      const registered = await fetch("/api/incoming-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: effectiveBusinessId,
          storage_bucket: "receipts",
          storage_path: storagePath,
          source_type: "manual_upload",
          document_kind: "unknown",
          file_name: file.name,
          mime_type: file.type || null,
          file_size: file.size,
        }),
      })
      const created = await registered.json().catch(() => null)
      if (!registered.ok || !created?.document_id) {
        setError(typeof created?.error === "string" ? created.error : "Could not save the document.")
        return
      }
      await fetch(`/api/incoming-documents/${encodeURIComponent(created.document_id)}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: effectiveBusinessId }),
      })
      setSelectedId(created.document_id)
      await load()
    } finally {
      setUploading(false)
    }
  }

  async function reextractSelected() {
    if (!selectedId || !effectiveBusinessId) return
    const current = rows.find((row) => row.id === selectedId)
    const reviewed = current?.review_status === "accepted" || current?.review_status === "draft"
    if (reviewed && !window.confirm("Read this document again? Your reviewed corrections stay until you change them.")) return
    setMenuOpen(false)
    await fetch(`/api/incoming-documents/${encodeURIComponent(selectedId)}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: effectiveBusinessId, confirm: reviewed }),
    })
    await load()
  }

  const selected = rows.find((row) => row.id === selectedId) ?? null
  const reviewHref = (id: string) =>
    `/service/incoming-documents/${encodeURIComponent(id)}/review?business_id=${encodeURIComponent(effectiveBusinessId || "")}`
  const actionHref = selected ? (() => {
    const action = inboxPrimaryAction(selected)
    if (action === "create_expense") return buildServiceRoute(`/service/expenses/create?from_incoming_doc=${encodeURIComponent(selected.id)}`, effectiveBusinessId ?? undefined)
    if (action === "create_bill") return buildServiceRoute(`/bills/create?from_incoming_doc=${encodeURIComponent(selected.id)}`, effectiveBusinessId ?? undefined)
    if (action === "view_expense" && selected.linked_entity_id) return buildServiceRoute(`/service/expenses/${selected.linked_entity_id}/view`, effectiveBusinessId ?? undefined)
    if (action === "view_bill" && selected.linked_entity_id) return `/bills/${selected.linked_entity_id}/view`
    return reviewHref(selected.id)
  })() : ""

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Incoming documents</h1>
          <p className="mt-1 text-sm text-slate-500">Invoices and receipts waiting to be reviewed.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            {uploading ? "Reading…" : "Upload document"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file) void uploadDocument(file)
              }}
            />
          </label>
          <Link
            href={buildServiceRoute("/service/settings/inbound-email", effectiveBusinessId ?? undefined)}
            className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
          >
            Inbound email
          </Link>
        </div>
      </div>

      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault()
          setParam({ q: searchDraft.trim() || null })
        }}
      >
        <label className="sr-only" htmlFor="document-search">Search documents</label>
        <input
          id="document-search"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search documents"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
        />
      </form>

      <div className="mt-3 flex items-center gap-3">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 text-sm" role="tablist" aria-label="Document folders">
          {[
            ["inbox", "Inbox"],
            ["review", "Needs review"],
            ["handled", "Handled"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={box === id}
              className={`rounded-lg px-3 py-1.5 ${box === id ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600"}`}
              onClick={() => setParam({ box: id === "inbox" ? null : id })}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700" onClick={() => setFiltersOpen((open) => !open)}>
          Filter
        </button>
      </div>

      {filtersOpen ? (
        <div className="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <label className="text-sm text-slate-600">
            Document type
            <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" value={searchParams.get("document_kind") ?? ""} onChange={(event) => setParam({ document_kind: event.target.value || null })}>
              <option value="">Any</option>
              <option value="supplier_bill_attachment">Supplier bill</option>
              <option value="expense_receipt">Expense receipt</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            Source
            <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" value={searchParams.get("source_type") ?? ""} onChange={(event) => setParam({ source_type: event.target.value || null })}>
              <option value="">Any</option>
              <option value="manual_upload">Upload</option>
              <option value="email_inbound">Email</option>
              <option value="expense_form_upload">Expense form</option>
              <option value="bill_form_upload">Bill form</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            From
            <input type="date" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" value={searchParams.get("from") ?? ""} onChange={(event) => setParam({ from: event.target.value || null })} />
          </label>
          <label className="text-sm text-slate-600">
            To
            <input type="date" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" value={searchParams.get("to") ?? ""} onChange={(event) => setParam({ to: event.target.value || null })} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={searchParams.get("status") === "failed"} onChange={(event) => setParam({ status: event.target.checked ? "failed" : null })} />
            Could not read
          </label>
        </div>
      ) : null}

      {error ? <p className="mt-4 text-sm text-red-700" role="alert">{error}</p> : null}

      <div className={`mt-6 grid gap-6 ${rows.length > 0 ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]" : ""}`}>
        <div
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const file = event.dataTransfer.files?.[0]
            if (file) void uploadDocument(file)
          }}
        >
          {loading ? <p className="p-6 text-sm text-slate-500">Loading documents…</p> : null}
          {!loading && rows.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <h2 className="text-lg font-medium text-slate-900">No incoming documents</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                Upload invoices and receipts here, or send them to your Finza inbound email address.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                  Upload document
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" disabled={uploading} onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ""
                    if (file) void uploadDocument(file)
                  }} />
                </label>
                <Link href={buildServiceRoute("/service/settings/inbound-email", effectiveBusinessId ?? undefined)} className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700">
                  View inbound email
                </Link>
              </div>
            </div>
          ) : null}
          <ul>
            {rows.map((row) => {
              const label = inboxStatusText(row)
              const amount = formatInboxAmount(row.total, row.currency_code)
              const fileName = inboxRowFileName(row)
              const fromLine = inboxRowFromLine(row)
              const selectedRow = selectedId === row.id
              const href = reviewHref(row.id)
              return (
                <li key={row.id} className="border-t border-slate-100 first:border-t-0">
                  <div className={`flex items-start gap-3 px-4 py-4 ${selectedRow ? "border-l-2 border-slate-900 bg-slate-100" : "border-l-2 border-transparent hover:bg-slate-50"}`}>
                    <DocumentMark row={row} />
                    <button
                      type="button"
                      aria-pressed={selectedRow}
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        if (window.matchMedia("(min-width: 1024px)").matches) setSelectedId(row.id)
                        else router.push(href)
                      }}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-medium text-slate-900">{inboxRowTitle(row)}</span>
                        <span className="shrink-0 text-sm font-medium text-slate-900">{amount ?? "—"}</span>
                      </span>
                      <span className="mt-0.5 flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-slate-500">{inboxRowSecondary(row) || row.display_name}</span>
                          {fromLine ? <span className="mt-0.5 block truncate text-xs text-slate-400">{fromLine}</span> : null}
                          {fileName ? <span className="mt-0.5 block truncate text-xs text-slate-400">{fileName}</span> : null}
                          {sharesInboundEmail(rows, row) ? <span className="mt-0.5 block text-xs text-slate-400">From same email</span> : null}
                        </span>
                        <StatusLabel label={label} />
                      </span>
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        {rows.length > 0 ? (
          <aside className="hidden lg:block">
            {!selected ? null : (
              <div className="sticky top-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-medium text-slate-900">{inboxRowTitle(selected)}</h2>
                    <p className="truncate text-sm text-slate-500">{inboxRowSecondary(selected)}</p>
                    {inboxRowFromLine(selected) ? <p className="truncate text-xs text-slate-400">{inboxRowFromLine(selected)}</p> : null}
                  </div>
                  <StatusLabel label={inboxStatusText(selected)} />
                </div>
                <p className="text-lg font-semibold text-slate-900">{formatInboxAmount(selected.total, selected.currency_code) ?? "—"}</p>
                {previewUrl ? (
                  documentVisual(selected) === "pdf" || previewUrl.includes(".pdf") ? (
                    <iframe title="Document preview" src={previewUrl} className="h-[28rem] w-full rounded-xl border border-slate-200 bg-slate-50" />
                  ) : (
                    <img src={previewUrl} alt="" className="max-h-[28rem] w-full rounded-xl border border-slate-200 bg-slate-50 object-contain" />
                  )
                ) : (
                  <div className="flex h-48 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-400">No preview</div>
                )}
                <div className="flex items-center gap-2">
                  {actionHref ? (
                    <Link href={actionHref} className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                      {inboxPrimaryLabel(inboxPrimaryAction(selected))}
                    </Link>
                  ) : null}
                  <div className="relative">
                    <button type="button" aria-label="More actions" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onClick={() => setMenuOpen((open) => !open)}>…</button>
                    {menuOpen ? (
                      <div className="absolute right-0 z-10 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-sm">
                        {previewUrl ? <a className="block rounded-lg px-3 py-2 hover:bg-slate-50" href={previewUrl}>Download</a> : null}
                        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50" onClick={() => void reextractSelected()}>Re-extract</button>
                        <Link className="block rounded-lg px-3 py-2 hover:bg-slate-50" href={reviewHref(selected.id)}>Extraction details</Link>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  )
}
