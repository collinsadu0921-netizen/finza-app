"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { buildEffectiveParsedFields } from "@/lib/documents/effectiveIncomingFields"
import { inboxStatusLabel } from "@/lib/documents/incomingOpenAiExtraction"
import { buildServiceRoute } from "@/lib/service/routes"

type DocRow = {
  status?: string
  review_status?: string
  reviewed_fields?: Record<string, unknown> | null
  file_name?: string | null
  source_type?: string | null
  document_kind?: string | null
  mime_type?: string | null
  linked_entity_id?: string | null
  linked_entity_type?: string | null
}

type LineItem = {
  description: string
  quantity: string
  unit_price: string
  discount_amount: string
  line_total: string
}

type ExtractionRow = {
  parsed_json?: Record<string, unknown> | null
  extraction_mode?: string | null
  extraction_warnings?: unknown
  error_message?: string | null
  provider?: string | null
}

function strVal(value: unknown): string {
  if (value == null) return ""
  return String(value)
}

function linesFrom(value: unknown): LineItem[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => {
    const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {}
    return {
      description: strVal(item.description),
      quantity: strVal(item.quantity),
      unit_price: strVal(item.unit_price),
      discount_amount: strVal(item.discount_amount),
      line_total: strVal(item.line_total),
    }
  })
}

export default function IncomingDocumentReviewPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const id = typeof params?.id === "string" ? params.id : ""
  const businessId = searchParams.get("business_id")?.trim() ?? ""
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [document, setDocument] = useState<DocRow | null>(null)
  const [extraction, setExtraction] = useState<ExtractionRow | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [lines, setLines] = useState<LineItem[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const apply = useCallback((doc: DocRow, ext: ExtractionRow | null) => {
    const effective = buildEffectiveParsedFields({
      machineParsed: ext?.parsed_json ?? null,
      reviewedFields: doc.reviewed_fields ?? null,
      reviewStatus: doc.review_status ?? "none",
    })
    setForm({
      supplier_name: strVal(effective.supplier_name),
      document_number: strVal(effective.document_number),
      document_date: strVal(effective.document_date),
      due_date: strVal(effective.due_date),
      currency_code: strVal(effective.currency_code),
      subtotal: strVal(effective.subtotal),
      tax_amount: strVal(effective.tax_amount),
      total: strVal(effective.total),
    })
    setLines(linesFrom(effective.line_items))
  }, [])

  const refresh = useCallback(async () => {
    if (!id || !businessId) return
    setLoading(true)
    setError("")
    const res = await fetch(`/api/incoming-documents/${encodeURIComponent(id)}?business_id=${encodeURIComponent(businessId)}`)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Could not load document")
      setLoading(false)
      return
    }
    const doc = (data?.document ?? null) as DocRow | null
    const ext = (data?.latest_extraction ?? null) as ExtractionRow | null
    setDocument(doc)
    setExtraction(ext)
    setPreviewUrl(typeof data?.preview_url === "string" ? data.preview_url : null)
    if (doc) apply(doc, ext)
    setLoading(false)
  }, [apply, businessId, id])

  useEffect(() => { void refresh() }, [refresh])

  const mode = extraction?.parsed_json && typeof extraction.parsed_json.extraction_mode === "string"
    ? extraction.parsed_json.extraction_mode
    : extraction?.extraction_mode || document?.document_kind
  const isBill = mode === "supplier_bill" || document?.document_kind === "supplier_bill_attachment"
  const isUnknown = mode === "unknown" || document?.document_kind === "unknown"
  const linked = Boolean(document?.linked_entity_id)
  const label = inboxStatusLabel({
    status: document?.status || "",
    reviewStatus: document?.review_status,
    linked,
  })
  const warnings = useMemo(() => {
    const value = extraction?.extraction_warnings
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  }, [extraction])

  function payload() {
    const numeric = (key: string) => {
      const raw = form[key]?.trim()
      if (!raw) return null
      const value = Number(raw)
      return Number.isFinite(value) ? value : null
    }
    return {
      supplier_name: form.supplier_name || null,
      document_number: form.document_number || null,
      document_date: form.document_date || null,
      due_date: form.due_date || null,
      currency_code: form.currency_code || null,
      subtotal: numeric("subtotal"),
      tax_amount: numeric("tax_amount"),
      total: numeric("total"),
      line_items: isBill
        ? lines.map((line) => ({
            description: line.description || null,
            quantity: line.quantity === "" ? null : Number(line.quantity),
            unit_price: line.unit_price === "" ? null : Number(line.unit_price),
            discount_amount: line.discount_amount === "" ? null : Number(line.discount_amount),
            line_total: line.line_total === "" ? null : Number(line.line_total),
          }))
        : undefined,
    }
  }

  async function save(action: "save_draft" | "accept") {
    setSaving(true)
    setError("")
    setMessage("")
    const res = await fetch(`/api/incoming-documents/${encodeURIComponent(id)}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, action, fields: payload() }),
    })
    const data = await res.json().catch(() => null)
    setSaving(false)
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Could not save")
      return
    }
    setMessage(action === "accept" ? "Review saved." : "Draft saved.")
    await refresh()
  }

  async function reextract() {
    const reviewed = document?.review_status === "accepted" || document?.review_status === "draft"
    if (reviewed && !window.confirm("Read this document again? Your reviewed corrections stay until you change them.")) return
    setError("")
    const res = await fetch(`/api/incoming-documents/${encodeURIComponent(id)}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, confirm: reviewed }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Could not read the document again")
      return
    }
    setMessage("Document read again. Earlier corrections are still here.")
    await refresh()
  }

  async function removeDocument() {
    if (!window.confirm("Delete this document?")) return
    const res = await fetch(`/api/incoming-documents/${encodeURIComponent(id)}?business_id=${encodeURIComponent(businessId)}`, { method: "DELETE" })
    if (res.ok) window.location.href = buildServiceRoute("/service/incoming-documents", businessId)
    else setError("Could not delete this document")
  }

  const expenseHref = buildServiceRoute(`/service/expenses/create?from_incoming_doc=${encodeURIComponent(id)}`, businessId)
  const billHref = buildServiceRoute(`/bills/create?from_incoming_doc=${encodeURIComponent(id)}`, businessId)
  const linkedHref = document?.linked_entity_id
    ? document.linked_entity_type === "expense"
      ? buildServiceRoute(`/service/expenses/${document.linked_entity_id}/view`, businessId)
      : `/bills/${document.linked_entity_id}/view`
    : ""

  if (!businessId) {
    return <main className="mx-auto max-w-3xl p-6 text-sm text-slate-600">Open this document from the inbox.</main>
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={buildServiceRoute("/service/incoming-documents", businessId)} className="text-sm text-slate-500">
            Back to inbox
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">{document?.file_name || "Document"}</h1>
          <p className="mt-1 text-sm text-slate-600">{label}</p>
        </div>
        <div className="flex items-center gap-2">
          {linked && linkedHref ? (
            <Link href={linkedHref} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
              {document?.linked_entity_type === "bill" ? "View supplier bill" : "View expense"}
            </Link>
          ) : document?.review_status === "accepted" ? (
            isUnknown ? null : (
              <Link href={isBill ? billHref : expenseHref} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                {isBill ? "Create supplier bill" : "Create expense"}
              </Link>
            )
          ) : (
            <button type="button" disabled={saving || loading} onClick={() => void save("accept")} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Review document
            </button>
          )}
          <div className="relative">
            <button type="button" aria-label="More actions" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onClick={() => setMenuOpen((open) => !open)}>
              …
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-10 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-sm">
                {previewUrl ? <a className="block rounded-lg px-3 py-2 hover:bg-slate-50" href={previewUrl}>Download</a> : null}
                <button type="button" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50" onClick={() => void reextract()}>Re-extract</button>
                <button type="button" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50" onClick={() => { setDetailsOpen(true); setMenuOpen(false) }}>View extraction details</button>
                {!linked && (document?.source_type === "expense_form_upload" || document?.source_type === "bill_form_upload") ? (
                  <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-red-700 hover:bg-slate-50" onClick={() => void removeDocument()}>Delete</button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-red-700" role="alert">{error}</p> : null}
      {message ? <p className="mt-4 text-sm text-slate-600">{message}</p> : null}
      {loading ? <p className="mt-6 text-sm text-slate-500">Loading document…</p> : null}

      {!loading ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="min-h-80 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            {previewUrl ? (
              document?.mime_type === "application/pdf" || previewUrl.includes("pdf") ? (
                <iframe title="Document preview" src={previewUrl} className="h-[70vh] w-full rounded-xl bg-white" />
              ) : (
                <img src={previewUrl} alt="Document preview" className="max-h-[70vh] w-full rounded-xl object-contain" />
              )
            ) : (
              <p className="p-6 text-sm text-slate-500">Preview is not available.</p>
            )}
          </div>

          <div className="space-y-4">
            {extraction?.error_message ? <p className="text-sm text-red-700">{extraction.error_message}</p> : null}
            {warnings.length > 0 ? <p className="text-sm text-amber-800">{warnings[0]}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["supplier_name", "Supplier"],
                ["document_number", "Document number"],
                ["document_date", "Issue date"],
                ["due_date", "Due date"],
                ["currency_code", "Currency"],
                ["total", "Total"],
              ].map(([key, labelText]) => (
                <label key={key} className="text-sm text-slate-600">
                  {labelText}
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                    value={form[key] ?? ""}
                    onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                </label>
              ))}
            </div>

            {isBill ? (
              <div>
                <h2 className="text-sm font-medium text-slate-900">Line items</h2>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-1 pr-2">Description</th>
                        <th className="py-1 pr-2">Qty</th>
                        <th className="py-1 pr-2">Price</th>
                        <th className="py-1">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => (
                        <tr key={index}>
                          {(["description", "quantity", "unit_price", "line_total"] as const).map((key) => (
                            <td key={key} className="py-1 pr-2">
                              <input
                                aria-label={`${key} ${index + 1}`}
                                className="w-full rounded border border-slate-200 px-2 py-1"
                                value={line[key]}
                                onChange={(event) => setLines((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: event.target.value } : item))}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {isUnknown && !linked ? (
              <div className="flex flex-wrap gap-2">
                <Link href={expenseHref} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">Create expense</Link>
                <Link href={billHref} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">Create supplier bill</Link>
              </div>
            ) : null}
            {detailsOpen ? (
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
                <p>Provider: {extraction?.provider || "—"}</p>
                <p>Mode: {mode || "—"}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  )
}
