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

function strVal(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  return String(v)
}

function warningsList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === "string")
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
    () => (latestExtraction?.parsed_json && typeof latestExtraction.parsed_json === "object"
      ? latestExtraction.parsed_json
      : {}) as Record<string, unknown>,
    [latestExtraction]
  )

  const confidence = useMemo(
    () =>
      (latestExtraction?.confidence_json && typeof latestExtraction.confidence_json === "object"
        ? latestExtraction.confidence_json
        : {}) as Record<string, unknown>,
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
  const isPdf =
    mime.includes("pdf") || (document?.file_name?.toLowerCase().endsWith(".pdf") ?? false)
  const isImage = mime.startsWith("image/")

  const extractionStatus = latestExtraction?.status ?? "none"
  const extractionFailed = document?.status === "failed" || extractionStatus === "failed"
  const noExtractionYet = !latestExtraction && !extractionFailed && (document?.status === "uploaded" || document?.status === "extracting")
  const parseEmpty =
    latestExtraction &&
    extractionStatus === "succeeded" &&
    (!latestExtraction.parsed_json || Object.keys(latestExtraction.parsed_json).length === 0)

  if (!businessId) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <p className="text-sm text-amber-800">
          Add <code className="bg-amber-50 px-1 rounded">business_id</code> to the URL (workspace context).
        </p>
      </main>
    )
  }

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs mb-1">
            <Link
              href={buildServiceRoute("/service/incoming-documents", businessId)}
              className="text-slate-500 hover:text-slate-800 hover:underline"
            >
              ← Incoming documents
            </Link>
          </p>
          <h1 className="text-lg font-semibold text-slate-900">Review incoming document</h1>
          <p className="text-xs text-slate-500 mt-0.5 font-mono">{id}</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href={buildServiceRoute(
              `/service/expenses/create?from_incoming_doc=${encodeURIComponent(id)}`,
              businessId
            )}
            className="text-blue-700 hover:underline"
          >
            Create expense (prefill)
          </Link>
          <Link
            href={buildServiceRoute(`/bills/create?from_incoming_doc=${encodeURIComponent(id)}`, businessId)}
            className="text-blue-700 hover:underline"
          >
            Create bill (prefill)
          </Link>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-600">Loading…</p>}
      {loadError && (
        <p className="text-sm text-red-700" role="alert">
          {loadError}
        </p>
      )}

      {!loading && document && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800">Document</h2>
            <dl className="text-xs text-slate-600 space-y-1">
              <div>
                <dt className="font-medium text-slate-500 inline">Status: </dt>
                <dd className="inline">{document.status ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500 inline">Review: </dt>
                <dd className="inline">{document.review_status ?? "none"}</dd>
              </div>
              {document.file_name && (
                <div>
                  <dt className="font-medium text-slate-500 inline">File: </dt>
                  <dd className="inline">{document.file_name}</dd>
                </div>
              )}
              {latestExtraction?.extraction_mode && (
                <div>
                  <dt className="font-medium text-slate-500 inline">Extraction mode: </dt>
                  <dd className="inline">{latestExtraction.extraction_mode}</dd>
                </div>
              )}
              {latestExtraction?.page_count != null && latestExtraction.page_count > 0 && (
                <div>
                  <dt className="font-medium text-slate-500 inline">Pages (processed): </dt>
                  <dd className="inline">{latestExtraction.page_count}</dd>
                </div>
              )}
            </dl>
            {warningsList(latestExtraction?.extraction_warnings).length > 0 && (
              <ul className="text-xs text-amber-800 list-disc pl-4">
                {warningsList(latestExtraction?.extraction_warnings).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}

            <div className="mt-2 min-h-[280px] border border-slate-100 rounded-lg bg-slate-50 overflow-hidden">
              {!previewUrl && <p className="p-3 text-xs text-slate-500">No preview URL available.</p>}
              {previewUrl && isPdf && (
                <iframe title="Document preview" src={previewUrl} className="w-full h-[70vh] bg-white" />
              )}
              {previewUrl && isImage && (
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                <img src={previewUrl} alt="Document" className="max-w-full max-h-[70vh] object-contain mx-auto" />
              )}
              {previewUrl && !isPdf && !isImage && (
                <div className="p-3 space-y-2">
                  <p className="text-xs text-slate-600">Inline preview is not available for this file type.</p>
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-700 underline"
                  >
                    Open or download
                  </a>
                </div>
              )}
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800">Extracted fields</h2>
            <p className="text-xs text-slate-500">
              Values are suggestions until you save or accept. Original machine output stays on the extraction record.
            </p>

            {noExtractionYet && (
              <p className="text-sm text-slate-600">Extraction has not finished yet. Refresh after a moment.</p>
            )}
            {extractionFailed && (
              <p className="text-sm text-amber-800" role="status">
                Extraction failed
                {latestExtraction?.error_message ? `: ${latestExtraction.error_message}` : "."}
                You can still enter fields manually and save a draft.
              </p>
            )}
            {parseEmpty && !extractionFailed && (
              <p className="text-sm text-amber-800" role="status">
                Extraction ran but no structured fields were found. Check raw text below and fill manually.
              </p>
            )}

            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {FIELD_LABELS.map(({ key, label, type }) => {
                const conf = confidence[key]
                const confStr = typeof conf === "string" ? conf : conf != null ? String(conf) : ""
                return (
                  <div key={key}>
                    <label className="block text-xs font-medium text-slate-600 mb-0.5">
                      {label}
                      {confStr ? (
                        <span className="ml-1 font-normal text-slate-400">({confStr} confidence)</span>
                      ) : null}
                    </label>
                    {type === "textarea" ? (
                      <textarea
                        className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm"
                        rows={3}
                        value={form[key] ?? ""}
                        onChange={(e) => setField(key, e.target.value)}
                        disabled={document.status === "linked"}
                      />
                    ) : (
                      <input
                        type={type === "number" ? "text" : "text"}
                        inputMode={type === "number" ? "decimal" : undefined}
                        className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm"
                        value={form[key] ?? ""}
                        onChange={(e) => setField(key, e.target.value)}
                        disabled={document.status === "linked"}
                      />
                    )}
                    {machineParsed[key] != null && strVal(machineParsed[key]) !== (form[key] ?? "") && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Machine: {strVal(machineParsed[key])}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {typeof latestExtraction?.raw_text === "string" && latestExtraction.raw_text.trim().length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-600">Raw extracted text (snippet)</summary>
                <pre className="mt-1 p-2 bg-slate-50 rounded border border-slate-100 overflow-x-auto max-h-40 whitespace-pre-wrap">
                  {latestExtraction.raw_text.slice(0, 4000)}
                  {latestExtraction.raw_text.length > 4000 ? "…" : ""}
                </pre>
              </details>
            )}

            {document.status === "linked" && (
              <p className="text-sm text-slate-600">This document is linked to a record; review edits are locked.</p>
            )}

            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={saving || document.status === "linked" || noExtractionYet}
                onClick={() => void postReview("save_draft")}
                className="px-3 py-2 rounded-lg bg-slate-100 text-slate-800 text-sm font-medium hover:bg-slate-200 disabled:opacity-50"
              >
                Save draft
              </button>
              <button
                type="button"
                disabled={saving || document.status === "linked" || noExtractionYet}
                onClick={() => void postReview("accept")}
                className="px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 disabled:opacity-50"
              >
                Accept review
              </button>
            </div>
            {actionError && (
              <p className="text-sm text-red-700" role="alert">
                {actionError}
              </p>
            )}
            {actionMessage && <p className="text-sm text-emerald-800">{actionMessage}</p>}
          </section>
        </div>
      )}
    </main>
  )
}
