"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { buildEffectiveParsedFields } from "@/lib/documents/effectiveIncomingFields"
import { buildServiceRoute } from "@/lib/service/routes"

type DocRow = {
  id?: string
  status?: string
  review_status?: string
  reviewed_fields?: Record<string, unknown> | null
  reviewed_at?: string | null
  reviewed_by?: string | null
  mime_type?: string | null
  file_name?: string | null
  document_kind?: string | null
  source_type?: string | null
  source_email_sender?: string | null
  source_email_subject?: string | null
  linked_entity_id?: string | null
  linked_entity_type?: string | null
}

type ExtractionRow = {
  status?: string
  parsed_json?: Record<string, unknown> | null
  confidence_json?: Record<string, unknown> | null
  raw_text?: string | null
  error_message?: string | null
  extraction_mode?: string | null
  extraction_warnings?: unknown
  page_count?: number | null
  source_mime?: string | null
}

const FIELD_LABELS: { key: string; label: string; type: "text" | "number" | "textarea" }[] = [
  { key: "supplier_name", label: "Supplier / merchant", type: "text" },
  { key: "document_number", label: "Document number", type: "text" },
  { key: "document_date", label: "Document date", type: "text" },
  { key: "currency_code", label: "Currency", type: "text" },
  { key: "subtotal", label: "Subtotal", type: "number" },
  { key: "total", label: "Total", type: "number" },
  { key: "vat_amount", label: "VAT", type: "number" },
  { key: "nhil_amount", label: "NHIL", type: "number" },
  { key: "getfund_amount", label: "GETFund", type: "number" },
  { key: "covid_amount", label: "COVID levy", type: "number" },
  { key: "notes", label: "Notes", type: "textarea" },
]

const KIND_LABEL: Record<string, string> = {
  expense_receipt: "Expense receipt",
  supplier_bill_attachment: "Supplier bill",
  unknown: "Unknown",
}

function strVal(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  return String(v)
}

function warningsList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === "string")
}

function statusPillClass(status: string | undefined): string {
  const s = status ?? ""
  if (s === "failed") return "bg-red-100 text-red-900"
  if (s === "linked") return "bg-emerald-100 text-emerald-900"
  if (s === "needs_review" || s === "extracting" || s === "uploaded") return "bg-amber-100 text-amber-950"
  return "bg-slate-100 text-slate-800"
}

export default function IncomingDocumentReviewPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const id = typeof params?.id === "string" ? params.id : ""
  const businessId = searchParams.get("business_id")?.trim() ?? ""

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [document, setDocument] = useState<DocRow | null>(null)
  const [latestExtraction, setLatestExtraction] = useState<ExtractionRow | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState("")
  const [actionMessage, setActionMessage] = useState("")
  const [saving, setSaving] = useState(false)

  const machineParsed = useMemo(
    () =>
      latestExtraction?.parsed_json && typeof latestExtraction.parsed_json === "object"
        ? (latestExtraction.parsed_json as Record<string, unknown>)
        : {},
    [latestExtraction]
  )

  const confidence = useMemo(
    () =>
      latestExtraction?.confidence_json && typeof latestExtraction.confidence_json === "object"
        ? (latestExtraction.confidence_json as Record<string, unknown>)
        : {},
    [latestExtraction]
  )

  const applyPayloadToForm = useCallback(
    (doc: DocRow, ext: ExtractionRow | null) => {
      const effective = buildEffectiveParsedFields({
        machineParsed: (ext?.parsed_json as Record<string, unknown> | null) ?? null,
        reviewedFields: (doc.reviewed_fields as Record<string, unknown> | null) ?? null,
        reviewStatus: doc.review_status ?? "none",
      })
      const next: Record<string, string> = {}
      for (const { key } of FIELD_LABELS) {
        next[key] = strVal(effective[key])
      }
      setForm(next)
    },
    []
  )

  const refresh = useCallback(async () => {
    if (!id || !businessId) return
    setLoading(true)
    setLoadError("")
    try {
      const res = await fetch(
        `/api/incoming-documents/${encodeURIComponent(id)}?business_id=${encodeURIComponent(businessId)}`
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setLoadError(typeof data?.error === "string" ? data.error : "Could not load document")
        setDocument(null)
        setLatestExtraction(null)
        setPreviewUrl(null)
        return
      }
      const doc = (data?.document ?? null) as DocRow | null
      const ext = (data?.latest_extraction ?? null) as ExtractionRow | null
      const preview = typeof data?.preview_url === "string" ? data.preview_url : null
      setDocument(doc)
      setLatestExtraction(ext)
      setPreviewUrl(preview)
      if (doc) applyPayloadToForm(doc, ext)
    } catch {
      setLoadError("Could not load document")
    } finally {
      setLoading(false)
    }
  }, [id, businessId, applyPayloadToForm])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const buildFieldsPayload = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const { key, type } of FIELD_LABELS) {
      const raw = (form[key] ?? "").trim()
      if (raw === "") {
        out[key] = null
        continue
      }
      if (type === "number") {
        const n = Number(raw.replace(/,/g, ""))
        out[key] = Number.isFinite(n) ? n : null
      } else {
        out[key] = raw
      }
    }
    return out
  }

  const postReview = async (action: "save_draft" | "accept") => {
    if (!id || !businessId) return
    setActionError("")
    setActionMessage("")
    setSaving(true)
    try {
      const res = await fetch(`/api/incoming-documents/${encodeURIComponent(id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          action,
          fields: buildFieldsPayload(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setActionError(typeof data?.error === "string" ? data.error : "Request failed")
        return
      }
      setActionMessage(action === "accept" ? "Review accepted." : "Draft saved.")
      await refresh()
    } catch {
      setActionError("Request failed")
    } finally {
      setSaving(false)
    }
  }

  const mime = document?.mime_type?.toLowerCase() ?? ""
  const isPdf = mime.includes("pdf") || (document?.file_name?.toLowerCase().endsWith(".pdf") ?? false)
  const isImage = mime.startsWith("image/")

  const extractionStatus = latestExtraction?.status ?? "none"
  const extractionFailed = document?.status === "failed" || extractionStatus === "failed"
  const noExtractionYet =
    !latestExtraction && !extractionFailed && (document?.status === "uploaded" || document?.status === "extracting")
  const parseEmpty =
    latestExtraction &&
    extractionStatus === "succeeded" &&
    (!latestExtraction.parsed_json || Object.keys(latestExtraction.parsed_json).length === 0)

  const isLinked = !!(document?.linked_entity_id && document?.linked_entity_type)
  const linkedHref =
    document?.linked_entity_id && document?.linked_entity_type
      ? document.linked_entity_type === "expense"
        ? buildServiceRoute(`/service/expenses/${document.linked_entity_id}/view`, businessId)
        : `/bills/${document.linked_entity_id}/view`
      : null

  if (!businessId) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="text-sm text-amber-800">
          Add <code className="rounded bg-amber-50 px-1">business_id</code> to the URL (workspace context).
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-xs">
            <Link
              href={buildServiceRoute("/service/incoming-documents", businessId)}
              className="font-medium text-slate-500 hover:text-slate-800 hover:underline"
            >
              ← Incoming documents
            </Link>
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {document?.file_name?.trim() || "Review document"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {document?.status ? (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPillClass(document.status)}`}>
                {document.status.replace(/_/g, " ")}
              </span>
            ) : null}
            {document?.review_status ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                Review: {document.review_status}
              </span>
            ) : null}
            {document?.document_kind ? (
              <span className="text-xs text-slate-500">
                {KIND_LABEL[document.document_kind] ?? document.document_kind}
              </span>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-[10px] text-slate-400" title={id}>
            {id ? `${id.slice(0, 8)}…` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          {isLinked && linkedHref ? (
            <Link
              href={linkedHref}
              className="inline-flex items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              View linked record
            </Link>
          ) : (
            <>
              <Link
                href={buildServiceRoute(
                  `/service/expenses/create?from_incoming_doc=${encodeURIComponent(id)}`,
                  businessId
                )}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Create expense
              </Link>
              <Link
                href={buildServiceRoute(`/bills/create?from_incoming_doc=${encodeURIComponent(id)}`, businessId)}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Create bill
              </Link>
            </>
          )}
        </div>
      </div>

      {isLinked && linkedHref && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-950">
          <span className="font-medium">Linked</span> — this document is attached to a record. Fields are read-only;
          use <Link className="font-semibold underline hover:no-underline" href={linkedHref}>View linked record</Link>{" "}
          for accounting detail.
        </div>
      )}

      {loading && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
          Loading document…
        </div>
      )}
      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50/80 px-4 py-4 text-sm text-red-900" role="alert">
          <p className="font-medium">Could not load</p>
          <p className="mt-1">{loadError}</p>
        </div>
      )}

      {!loading && document && (
        <>
          <aside className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 text-xs text-slate-600">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source</p>
            {document.source_type === "email_inbound" ? (
              <dl className="mt-2 space-y-1">
                <div>
                  <dt className="inline text-slate-400">From </dt>
                  <dd className="inline break-all text-slate-700">{document.source_email_sender || "—"}</dd>
                </div>
                <div>
                  <dt className="inline text-slate-400">Subject </dt>
                  <dd className="inline break-all text-slate-700">{document.source_email_subject || "—"}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 capitalize text-slate-700">{String(document.source_type ?? "—").replace(/_/g, " ")}</p>
            )}
            {latestExtraction?.extraction_mode ? (
              <p className="mt-2 border-t border-slate-200/80 pt-2 text-[11px] text-slate-500">
                Extraction: <span className="text-slate-700">{latestExtraction.extraction_mode}</span>
                {latestExtraction.page_count != null && latestExtraction.page_count > 0 ? (
                  <span className="text-slate-500"> · {latestExtraction.page_count} pages</span>
                ) : null}
              </p>
            ) : null}
          </aside>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
            <section className="space-y-3 lg:col-span-7">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Preview</h2>
              </div>
              <div className="min-h-[240px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {!previewUrl && (
                  <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                    <p className="text-sm font-medium text-slate-700">No preview available</p>
                    <p className="max-w-sm text-xs text-slate-500">
                      A signed preview URL was not returned. You can still review extracted fields or open the file
                      after download from storage if your workflow allows it.
                    </p>
                  </div>
                )}
                {previewUrl && isPdf && (
                  <iframe title="Document preview" src={previewUrl} className="h-[min(72vh,640px)] w-full bg-white" />
                )}
                {previewUrl && isImage && (
                  // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                  <img src={previewUrl} alt="Document" className="mx-auto max-h-[min(72vh,640px)] max-w-full object-contain" />
                )}
                {previewUrl && !isPdf && !isImage && (
                  <div className="space-y-3 p-4">
                    <p className="text-sm text-slate-700">Inline preview is not available for this file type.</p>
                    <p className="text-xs text-slate-500">
                      Unsupported attachment for in-browser preview. Download to open locally.
                    </p>
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      Open or download
                    </a>
                  </div>
                )}
              </div>
              {warningsList(latestExtraction?.extraction_warnings).length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">
                  {warningsList(latestExtraction?.extraction_warnings).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-4 lg:col-span-5">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Extracted fields</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Confirm or edit values, then save a draft or accept. Machine output stays on the extraction record.
                </p>
              </div>

              {noExtractionYet && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                  Extraction is still running. Refresh in a moment.
                </div>
              )}
              {extractionFailed && (
                <div className="rounded-lg border border-red-200 bg-red-50/80 px-3 py-3 text-sm text-red-900" role="status">
                  <p className="font-semibold">Extraction failed</p>
                  <p className="mt-1">
                    {latestExtraction?.error_message
                      ? latestExtraction.error_message
                      : "The pipeline could not read this file. You can still enter fields manually and save a draft."}
                  </p>
                </div>
              )}
              {parseEmpty && !extractionFailed && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-3 text-sm text-amber-950" role="status">
                  No structured fields were detected. Use raw text below and fill manually.
                </div>
              )}

              <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                {FIELD_LABELS.map(({ key, label, type }) => {
                  const conf = confidence[key]
                  const confStr = typeof conf === "string" ? conf : conf != null ? String(conf) : ""
                  return (
                    <div key={key}>
                      <label className="mb-0.5 block text-xs font-medium text-slate-600">
                        {label}
                        {confStr ? <span className="ml-1 font-normal text-slate-400">({confStr})</span> : null}
                      </label>
                      {type === "textarea" ? (
                        <textarea
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm shadow-sm focus:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400"
                          rows={3}
                          value={form[key] ?? ""}
                          onChange={(e) => setField(key, e.target.value)}
                          disabled={document.status === "linked"}
                        />
                      ) : (
                        <input
                          type={type === "number" ? "text" : "text"}
                          inputMode={type === "number" ? "decimal" : undefined}
                          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm shadow-sm focus:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400"
                          value={form[key] ?? ""}
                          onChange={(e) => setField(key, e.target.value)}
                          disabled={document.status === "linked"}
                        />
                      )}
                      {machineParsed[key] != null && strVal(machineParsed[key]) !== (form[key] ?? "") && (
                        <p className="mt-0.5 text-[10px] text-slate-400">Machine: {strVal(machineParsed[key])}</p>
                      )}
                    </div>
                  )
                })}
              </div>

              {typeof latestExtraction?.raw_text === "string" && latestExtraction.raw_text.trim().length > 0 && (
                <details className="rounded-md border border-slate-100 bg-slate-50/80 text-xs">
                  <summary className="cursor-pointer px-3 py-2 font-medium text-slate-600">Raw extracted text</summary>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-slate-100 p-2">
                    {latestExtraction.raw_text.slice(0, 4000)}
                    {latestExtraction.raw_text.length > 4000 ? "…" : ""}
                  </pre>
                </details>
              )}

              <div className="sticky bottom-0 z-10 space-y-2 border-t border-slate-200 bg-white/95 pt-4 backdrop-blur-sm">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || document.status === "linked" || noExtractionYet}
                    onClick={() => void postReview("save_draft")}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    disabled={saving || document.status === "linked" || noExtractionYet}
                    onClick={() => void postReview("accept")}
                    className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                  >
                    Accept review
                  </button>
                </div>
                {actionError && (
                  <p className="text-sm text-red-700" role="alert">
                    {actionError}
                  </p>
                )}
                {actionMessage && <p className="text-sm font-medium text-emerald-800">{actionMessage}</p>}
              </div>
            </section>
          </div>
        </>
      )}
    </main>
  )
}
