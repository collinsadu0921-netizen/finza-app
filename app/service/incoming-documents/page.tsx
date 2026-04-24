"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { buildServiceRoute } from "@/lib/service/routes"
import type { IncomingDocumentListSummary } from "@/lib/documents/incomingDocumentsList"

const STATUS_LABEL: Record<string, string> = {
  uploaded: "Uploaded",
  extracting: "Extracting",
  extracted: "Extracted",
  needs_review: "Needs review",
  reviewed: "Reviewed",
  failed: "Failed",
  linked: "Linked",
}

const REVIEW_LABEL: Record<string, string> = {
  none: "Not reviewed",
  draft: "Draft edits",
  accepted: "Accepted",
}

const KIND_LABEL: Record<string, string> = {
  expense_receipt: "Expense receipt",
  supplier_bill_attachment: "Supplier bill",
  unknown: "Unknown",
}

const SOURCE_LABEL: Record<string, string> = {
  manual_upload: "Manual",
  expense_form_upload: "Expense form",
  bill_form_upload: "Bill form",
  email_inbound: "Email",
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
  } catch {
    return iso
  }
}

export default function IncomingDocumentsListPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [rows, setRows] = useState<IncomingDocumentListSummary[]>([])
  const [total, setTotal] = useState(0)
  const [searchDraft, setSearchDraft] = useState("")

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [k, v] of Object.entries(updates)) {
        if (v == null || v === "") next.delete(k)
        else next.set(k, v)
      }
      next.delete("offset")
      router.replace(`/service/incoming-documents?${next.toString()}`)
    },
    [router, searchParams]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const biz = await getCurrentBusiness(supabase, user.id)
      if (cancelled) return
      setBusinessId(biz?.id ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSearchDraft(searchParams.get("q") ?? "")
  }, [searchParams])

  useEffect(() => {
    if (!businessId || searchParams.get("business_id")?.trim()) return
    const next = new URLSearchParams(searchParams.toString())
    next.set("business_id", businessId)
    router.replace(`/service/incoming-documents?${next.toString()}`)
  }, [businessId, router, searchParams])

  const effectiveBusinessId = searchParams.get("business_id")?.trim() || businessId

  const load = useCallback(async () => {
    if (!effectiveBusinessId) {
      setLoading(false)
      setRows([])
      setTotal(0)
      return
    }
    setLoading(true)
    setError("")
    try {
      const qs = new URLSearchParams()
      qs.set("business_id", effectiveBusinessId)
      for (const key of [
        "status",
        "review_status",
        "document_kind",
        "linked",
        "q",
        "attention",
        "reviewed",
        "sort",
        "limit",
        "offset",
      ] as const) {
        const v = searchParams.get(key)?.trim()
        if (v) qs.set(key, v)
      }
      const res = await fetch(`/api/incoming-documents?${qs.toString()}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not load documents")
        setRows([])
        setTotal(0)
        return
      }
      setRows(Array.isArray(data.documents) ? data.documents : [])
      setTotal(typeof data.total === "number" ? data.total : 0)
    } catch {
      setError("Could not load documents")
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [effectiveBusinessId, searchParams])

  useEffect(() => {
    void load()
  }, [load])

  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0)
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50))
  const hasPrev = offset > 0
  const hasNext = offset + rows.length < total

  if (!effectiveBusinessId && !loading) {
    return (
      <main className="max-w-6xl mx-auto p-4 md:p-6">
        <h1 className="text-lg font-semibold text-slate-900">Incoming documents</h1>
        <p className="mt-2 text-sm text-slate-600">Select or load a workspace business to see uploads.</p>
      </main>
    )
  }

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Incoming documents</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Uploads, extraction, and review — newest first unless you change sort.{" "}
            <Link
              href={buildServiceRoute("/service/settings/inbound-email", effectiveBusinessId ?? undefined)}
              className="text-blue-700 hover:underline font-medium"
            >
              Inbound email settings
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={buildServiceRoute("/service/expenses/create", effectiveBusinessId ?? undefined)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            New expense
          </Link>
          <Link
            href={buildServiceRoute("/bills/create", effectiveBusinessId ?? undefined)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            New bill
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Quick</span>
        {(
          [
            { label: "Needs attention", attention: "1", clear: ["status", "review_status", "reviewed"] },
            { label: "Failed", status: "failed", clear: ["attention", "reviewed"] },
            { label: "Reviewed", reviewed: "1", clear: ["attention", "status"] },
            { label: "Unlinked", linked: "unlinked", clear: ["attention", "reviewed", "status"] },
            { label: "Linked", linked: "linked", clear: ["attention", "reviewed", "status"] },
            { label: "All", clear: ["attention", "reviewed", "status", "linked", "document_kind", "q"] },
          ] as const
        ).map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => {
              const next = new URLSearchParams(searchParams.toString())
              for (const c of chip.clear ?? []) next.delete(c)
              if ("attention" in chip && chip.attention) next.set("attention", chip.attention)
              if ("status" in chip && chip.status) next.set("status", chip.status)
              if ("reviewed" in chip && chip.reviewed) next.set("reviewed", chip.reviewed)
              if ("linked" in chip && chip.linked) next.set("linked", chip.linked)
              next.delete("offset")
              router.replace(`/service/incoming-documents?${next.toString()}`)
            }}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200/80"
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="text-xs block">
          <span className="text-slate-500 font-medium">Status</span>
          <select
            className="mt-1 w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm"
            value={searchParams.get("status") ?? ""}
            onChange={(e) => setParam({ status: e.target.value || null, attention: null, reviewed: null })}
          >
            <option value="">Any</option>
            {Object.entries(STATUS_LABEL).map(([k, lab]) => (
              <option key={k} value={k}>
                {lab}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs block">
          <span className="text-slate-500 font-medium">Review</span>
          <select
            className="mt-1 w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm"
            value={searchParams.get("review_status") ?? ""}
            onChange={(e) => setParam({ review_status: e.target.value || null })}
          >
            <option value="">Any</option>
            {Object.entries(REVIEW_LABEL).map(([k, lab]) => (
              <option key={k} value={k}>
                {lab}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs block">
          <span className="text-slate-500 font-medium">Kind</span>
          <select
            className="mt-1 w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm"
            value={searchParams.get("document_kind") ?? ""}
            onChange={(e) => setParam({ document_kind: e.target.value || null })}
          >
            <option value="">Any</option>
            {Object.entries(KIND_LABEL).map(([k, lab]) => (
              <option key={k} value={k}>
                {lab}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs block">
          <span className="text-slate-500 font-medium">Linked</span>
          <select
            className="mt-1 w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm"
            value={searchParams.get("linked") ?? "all"}
            onChange={(e) =>
              setParam({ linked: e.target.value === "all" ? null : e.target.value || null })
            }
          >
            <option value="all">All</option>
            <option value="unlinked">Unlinked</option>
            <option value="linked">Linked</option>
          </select>
        </label>
        <label className="text-xs block sm:col-span-2">
          <span className="text-slate-500 font-medium">Search</span>
          <form
            className="mt-1 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const v = searchDraft.trim()
              setParam({ q: v || null })
            }}
          >
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              className="flex-1 border border-slate-200 rounded-md px-2 py-1.5 text-sm"
              placeholder="File name or path…"
            />
            <button type="submit" className="px-3 py-1.5 text-sm rounded-md bg-slate-800 text-white">
              Search
            </button>
          </form>
        </label>
        <label className="text-xs block">
          <span className="text-slate-500 font-medium">Sort</span>
          <select
            className="mt-1 w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm"
            value={searchParams.get("sort") ?? "newest"}
            onChange={(e) => setParam({ sort: e.target.value === "newest" ? null : e.target.value })}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="attention">Needs attention first</option>
          </select>
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {loading && <p className="text-sm text-slate-600">Loading…</p>}

      {!loading && !error && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center text-sm text-slate-600">
          No incoming documents yet. Upload a receipt from an expense, bill, or scanner flow, or send to your
          workspace inbound address — documents will appear here.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Review</th>
                <th className="px-3 py-2">Extraction</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const bid = effectiveBusinessId ?? ""
                const reviewHref = `/service/incoming-documents/${encodeURIComponent(r.id)}/review?business_id=${encodeURIComponent(bid)}`
                const expenseHref = buildServiceRoute(
                  `/service/expenses/create?from_incoming_doc=${encodeURIComponent(r.id)}`,
                  bid
                )
                const billHref = buildServiceRoute(
                  `/bills/create?from_incoming_doc=${encodeURIComponent(r.id)}`,
                  bid
                )
                const linked =
                  r.linked_entity_id && r.linked_entity_type
                    ? r.linked_entity_type === "expense"
                      ? buildServiceRoute(`/service/expenses/${r.linked_entity_id}/view`, bid)
                      : `/bills/${r.linked_entity_id}/view`
                    : null
                const ext = r.latest_extraction
                const extBits = ext
                  ? [
                      ext.extraction_mode ?? "—",
                      ext.page_count != null ? `${ext.page_count} pg` : null,
                      ext.extraction_failed ? "run failed" : null,
                      ext.has_warnings ? "warnings" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "—"

                return (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-slate-900 truncate max-w-[200px]" title={r.display_name}>
                        {r.display_name}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono truncate max-w-[220px]" title={r.id}>
                        {r.id}
                      </div>
                      <div className="text-[11px] text-slate-500">{SOURCE_LABEL[r.source_type] ?? r.source_type}</div>
                      {r.source_type === "email_inbound" && (r.source_email_sender || r.source_email_subject) ? (
                        <div
                          className="text-[11px] text-slate-600 truncate max-w-[220px] mt-0.5"
                          title={[r.source_email_sender, r.source_email_subject].filter(Boolean).join(" — ")}
                        >
                          {[r.source_email_sender, r.source_email_subject].filter(Boolean).join(" · ")}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-700">
                      {KIND_LABEL[r.document_kind] ?? r.document_kind}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className={`inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium ${
                          r.status === "failed"
                            ? "bg-red-50 text-red-800"
                            : r.status === "needs_review" || r.status === "extracting"
                              ? "bg-amber-50 text-amber-900"
                              : r.status === "linked"
                                ? "bg-emerald-50 text-emerald-900"
                                : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-slate-700">
                      {REVIEW_LABEL[r.review_status] ?? r.review_status}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-slate-600 max-w-[160px]">{extBits}</td>
                    <td className="px-3 py-2 align-top text-xs text-slate-600 whitespace-nowrap">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <div className="flex flex-col gap-1 items-end">
                        <Link href={reviewHref} className="text-blue-700 hover:underline text-xs font-medium">
                          Review
                        </Link>
                        <Link href={expenseHref} className="text-blue-700 hover:underline text-xs">
                          Create expense
                        </Link>
                        <Link href={billHref} className="text-blue-700 hover:underline text-xs">
                          Create bill
                        </Link>
                        {linked && (
                          <Link href={linked} className="text-emerald-800 hover:underline text-xs font-medium">
                            View linked
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 text-xs text-slate-600">
            <span>
              Showing {offset + 1}–{offset + rows.length} of {total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!hasPrev}
                className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                onClick={() => setParam({ offset: String(Math.max(0, offset - limit)) })}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!hasNext}
                className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                onClick={() => setParam({ offset: String(offset + limit) })}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
