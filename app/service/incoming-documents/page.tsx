"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
  draft: "Draft",
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

function isLinked(r: IncomingDocumentListSummary): boolean {
  return !!(r.linked_entity_id && r.linked_entity_type)
}

function needsAttentionVisual(r: IncomingDocumentListSummary): boolean {
  if (r.status === "failed") return true
  if (r.status === "needs_review") return true
  if (r.status === "extracting" || r.status === "uploaded") return true
  if (r.status === "extracted" && r.review_status !== "accepted" && !isLinked(r)) return true
  return false
}

function extractionSummary(r: IncomingDocumentListSummary): string {
  const ext = r.latest_extraction
  if (!ext) return r.status === "failed" ? "Extraction failed" : "No extraction yet"
  if (ext.extraction_failed || r.status === "failed") {
    return ext.error_snippet ? `Failed · ${ext.error_snippet}` : "Failed"
  }
  return [
    ext.extraction_mode ?? "—",
    ext.page_count != null ? `${ext.page_count} pg` : null,
    ext.has_warnings ? "Warnings" : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

function nextStepHint(r: IncomingDocumentListSummary): string {
  if (isLinked(r)) return "View linked record"
  if (r.status === "failed") return "Review & fix or re-upload"
  if (r.status === "uploaded" || r.status === "extracting") return "Wait for extraction"
  if (r.status === "needs_review" || (r.status === "extracted" && r.review_status !== "accepted"))
    return "Review & accept fields"
  if (r.review_status === "draft") return "Continue review"
  if (r.status === "reviewed" && !isLinked(r)) return "Create expense or bill"
  return "Open"
}

function buildListQuery(businessId: string, extra: Record<string, string>): string {
  const qs = new URLSearchParams()
  qs.set("business_id", businessId)
  qs.set("limit", "1")
  qs.set("offset", "0")
  for (const [k, v] of Object.entries(extra)) {
    if (v) qs.set(k, v)
  }
  return qs.toString()
}

type SummaryCounts = {
  needs_review: number | null
  failed: number | null
  reviewed: number | null
  linked: number | null
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
  const [summary, setSummary] = useState<SummaryCounts>({
    needs_review: null,
    failed: null,
    reviewed: null,
    linked: null,
  })
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [inboundHint, setInboundHint] = useState<{
    loaded: boolean
    hasRoute: boolean
    domainConfigured: boolean
  }>({ loaded: false, hasRoute: false, domainConfigured: false })

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

  const loadSummary = useCallback(async () => {
    if (!effectiveBusinessId) return
    setSummaryLoading(true)
    try {
      const base = effectiveBusinessId
      const fetches = [
        fetch(`/api/incoming-documents?${buildListQuery(base, { status: "needs_review" })}`).then((r) => r.json()),
        fetch(`/api/incoming-documents?${buildListQuery(base, { status: "failed" })}`).then((r) => r.json()),
        fetch(`/api/incoming-documents?${buildListQuery(base, { reviewed: "1" })}`).then((r) => r.json()),
        fetch(`/api/incoming-documents?${buildListQuery(base, { linked: "linked" })}`).then((r) => r.json()),
      ]
      const [nr, fd, rv, lk] = await Promise.all(fetches)
      setSummary({
        needs_review: typeof nr?.total === "number" ? nr.total : null,
        failed: typeof fd?.total === "number" ? fd.total : null,
        reviewed: typeof rv?.total === "number" ? rv.total : null,
        linked: typeof lk?.total === "number" ? lk.total : null,
      })
    } catch {
      setSummary({ needs_review: null, failed: null, reviewed: null, linked: null })
    } finally {
      setSummaryLoading(false)
    }
  }, [effectiveBusinessId])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  useEffect(() => {
    if (!effectiveBusinessId) return
    let cancelled = false
    void fetch(`/api/business/inbound-email?business_id=${encodeURIComponent(effectiveBusinessId)}`)
      .then((r) => r.json().catch(() => ({})))
      .then((data: { domain_configured?: boolean; route?: unknown }) => {
        if (cancelled) return
        setInboundHint({
          loaded: true,
          hasRoute: !!data?.route,
          domainConfigured: !!data?.domain_configured,
        })
      })
      .catch(() => {
        if (!cancelled) setInboundHint({ loaded: true, hasRoute: false, domainConfigured: false })
      })
    return () => {
      cancelled = true
    }
  }, [effectiveBusinessId])

  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0)
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50))
  const hasPrev = offset > 0
  const hasNext = offset + rows.length < total

  const hasActiveFilters = useMemo(() => {
    const sp = searchParams
    return !!(
      sp.get("q")?.trim() ||
      sp.get("status")?.trim() ||
      sp.get("review_status")?.trim() ||
      sp.get("document_kind")?.trim() ||
      sp.get("attention")?.trim() ||
      sp.get("reviewed")?.trim() ||
      (sp.get("linked")?.trim() && sp.get("linked") !== "all")
    )
  }, [searchParams])

  const activeQuick = useMemo(() => {
    const sp = searchParams
    if (sp.get("attention") === "1") return "attention"
    if (sp.get("status") === "failed") return "failed"
    if (sp.get("reviewed") === "1") return "reviewed"
    if (sp.get("linked") === "unlinked") return "unlinked"
    if (sp.get("linked") === "linked") return "linked"
    return "all"
  }, [searchParams])

  const chipClass = (active: boolean) =>
    [
      "rounded-md px-2.5 py-1 text-xs font-medium border transition-colors",
      active
        ? "border-slate-800 bg-slate-900 text-white shadow-sm"
        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    ].join(" ")

  const applyQuickFilter = (key: typeof activeQuick) => {
    const next = new URLSearchParams(searchParams.toString())
    const clear = [
      "attention",
      "status",
      "reviewed",
      "linked",
      "review_status",
      "document_kind",
      "q",
    ] as const
    for (const c of clear) next.delete(c)
    if (key === "attention") next.set("attention", "1")
    else if (key === "failed") next.set("status", "failed")
    else if (key === "reviewed") next.set("reviewed", "1")
    else if (key === "unlinked") next.set("linked", "unlinked")
    else if (key === "linked") next.set("linked", "linked")
    next.delete("offset")
    router.replace(`/service/incoming-documents?${next.toString()}`)
  }

  if (!effectiveBusinessId && !loading) {
    return (
      <main className="mx-auto max-w-6xl p-4 md:p-6">
        <h1 className="text-lg font-semibold text-slate-900">Incoming documents</h1>
        <p className="mt-2 text-sm text-slate-600">Select or load a workspace business to see uploads.</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div data-tour="service-incoming-documents-overview">
          <h1 className="text-lg font-semibold text-slate-900">Incoming documents</h1>
          <p className="mt-0.5 max-w-xl text-xs text-slate-500">
            Operational inbox for uploads and email — triage, review, then link to expenses or bills.{" "}
            <span className="text-slate-600">
              Email supplier invoices and receipts into Finza from your workspace inbound address.
            </span>{" "}
            <Link
              href={buildServiceRoute("/service/settings/inbound-email", effectiveBusinessId ?? undefined)}
              className="font-medium text-blue-700 hover:underline"
            >
              Inbound email settings
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={buildServiceRoute("/service/settings/inbound-email", effectiveBusinessId ?? undefined)}
            data-tour="service-incoming-documents-upload"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50"
          >
            Inbound email
          </Link>
          <Link
            href={buildServiceRoute("/service/expenses/create", effectiveBusinessId ?? undefined)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
          >
            New expense
          </Link>
          <Link
            href={buildServiceRoute("/bills/create", effectiveBusinessId ?? undefined)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
          >
            New bill
          </Link>
        </div>
      </div>

      {inboundHint.loaded && inboundHint.domainConfigured && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2 text-xs text-slate-600">
          <p>
            <span className="font-medium text-slate-700">By email:</span> forward or BCC invoices and receipts to your
            Finza address.{" "}
            {inboundHint.hasRoute ? (
              <Link
                href={buildServiceRoute("/service/settings/inbound-email", effectiveBusinessId ?? undefined)}
                className="font-medium text-blue-700 hover:underline"
              >
                Manage inbound email
              </Link>
            ) : (
              <Link
                href={buildServiceRoute("/service/settings/inbound-email", effectiveBusinessId ?? undefined)}
                className="font-medium text-blue-700 hover:underline"
              >
                Set up inbound email
              </Link>
            )}
          </p>
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            { key: "needs_review", label: "Needs review", value: summary.needs_review, hint: "status" },
            { key: "failed", label: "Failed", value: summary.failed, hint: "status" },
            { key: "reviewed", label: "Reviewed", value: summary.reviewed, hint: "review" },
            { key: "linked", label: "Linked", value: summary.linked, hint: "link" },
          ] as const
        ).map((c) => (
          <div
            key={c.key}
            className="rounded-lg border border-slate-200/90 bg-white px-3 py-2 shadow-sm"
            title={`Approximate count (${c.hint} filter)`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className="text-lg font-semibold tabular-nums text-slate-900">
              {summaryLoading ? "—" : c.value ?? "—"}
            </p>
          </div>
        ))}
      </div>

      {/* Quick filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Quick</span>
        {(
          [
            { key: "all" as const, label: "All" },
            { key: "attention" as const, label: "Needs attention" },
            { key: "failed" as const, label: "Failed" },
            { key: "reviewed" as const, label: "Reviewed" },
            { key: "unlinked" as const, label: "Unlinked" },
            { key: "linked" as const, label: "Linked" },
          ] as const
        ).map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => applyQuickFilter(chip.key)}
            className={chipClass(activeQuick === chip.key)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs">
          <span className="font-medium text-slate-500">Status</span>
          <select
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
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
        <label className="block text-xs">
          <span className="font-medium text-slate-500">Review</span>
          <select
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
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
        <label className="block text-xs">
          <span className="font-medium text-slate-500">Kind</span>
          <select
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
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
        <label className="block text-xs">
          <span className="font-medium text-slate-500">Linked</span>
          <select
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            value={searchParams.get("linked") ?? "all"}
            onChange={(e) => setParam({ linked: e.target.value === "all" ? null : e.target.value || null })}
          >
            <option value="all">All</option>
            <option value="unlinked">Unlinked</option>
            <option value="linked">Linked</option>
          </select>
        </label>
        <label className="block text-xs sm:col-span-2">
          <span className="font-medium text-slate-500">Search</span>
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
              className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              placeholder="File name, subject, sender…"
            />
            <button type="submit" className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white">
              Search
            </button>
          </form>
        </label>
        <label className="block text-xs">
          <span className="font-medium text-slate-500">Sort</span>
          <select
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
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

      {loading && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-600">
          Loading documents…
        </div>
      )}

      {!loading && !error && rows.length === 0 && !hasActiveFilters && (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center">
          <p className="text-sm font-medium text-slate-800">No incoming documents yet</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-slate-600">
            Upload a receipt from an expense or bill flow, or send mail to your workspace inbound address. New items
            will land here for review.
          </p>
          {inboundHint.domainConfigured && (
            <Link
              href={buildServiceRoute("/service/settings/inbound-email", effectiveBusinessId ?? undefined)}
              className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              {inboundHint.hasRoute ? "Manage inbound email address" : "Set up inbound email address"}
            </Link>
          )}
        </div>
      )}

      {!loading && !error && rows.length === 0 && hasActiveFilters && (
        <div className="rounded-lg border border-dashed border-amber-200 bg-amber-50/60 px-6 py-10 text-center">
          <p className="text-sm font-medium text-amber-950">No documents match these filters</p>
          <p className="mt-2 text-xs text-amber-900/90">Try clearing search or switching a quick filter.</p>
          <button
            type="button"
            onClick={() => applyQuickFilter("all")}
            className="mt-4 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100"
          >
            Reset to all
          </button>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm" data-tour="service-incoming-documents-list">
          <div className="divide-y divide-slate-100">
            {rows.map((r) => {
              const bid = effectiveBusinessId ?? ""
              const reviewHref = `/service/incoming-documents/${encodeURIComponent(r.id)}/review?business_id=${encodeURIComponent(bid)}`
              const expenseHref = buildServiceRoute(
                `/service/expenses/create?from_incoming_doc=${encodeURIComponent(r.id)}`,
                bid
              )
              const billHref = buildServiceRoute(`/bills/create?from_incoming_doc=${encodeURIComponent(r.id)}`, bid)
              const linkedHref =
                r.linked_entity_id && r.linked_entity_type
                  ? r.linked_entity_type === "expense"
                    ? buildServiceRoute(`/service/expenses/${r.linked_entity_id}/view`, bid)
                    : `/bills/${r.linked_entity_id}/view`
                  : null
              const linked = isLinked(r)
              const attention = needsAttentionVisual(r)

              let primary: { href: string; label: string }
              if (linked && linkedHref) {
                primary = { href: linkedHref, label: "View linked" }
              } else {
                primary = { href: reviewHref, label: "Review" }
              }

              return (
                <div
                  key={r.id}
                  className={[
                    "flex flex-wrap items-start justify-between gap-3 px-3 py-2.5",
                    attention ? "bg-amber-50/50" : "hover:bg-slate-50/80",
                  ].join(" ")}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-medium text-slate-900" title={r.display_name}>
                        {r.display_name}
                      </span>
                      <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        {KIND_LABEL[r.document_kind] ?? r.document_kind}
                      </span>
                      <span
                        className={[
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          r.status === "failed"
                            ? "bg-red-100 text-red-900"
                            : r.status === "needs_review" || r.status === "extracting" || r.status === "uploaded"
                              ? "bg-amber-100 text-amber-950"
                              : r.status === "linked"
                                ? "bg-emerald-100 text-emerald-900"
                                : "bg-slate-100 text-slate-700",
                        ].join(" ")}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                        Review: {REVIEW_LABEL[r.review_status] ?? r.review_status}
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-500">
                        {linked ? "Linked" : "Unlinked"}
                      </span>
                    </div>
                    {r.source_type === "email_inbound" && (r.source_email_sender || r.source_email_subject) ? (
                      <div className="mt-1 space-y-0.5 text-xs text-slate-600">
                        {r.source_email_sender ? (
                          <p className="truncate" title={r.source_email_sender}>
                            <span className="font-medium text-slate-500">From:</span> {r.source_email_sender}
                          </p>
                        ) : null}
                        {r.source_email_subject ? (
                          <p className="truncate" title={r.source_email_subject ?? undefined}>
                            <span className="font-medium text-slate-500">Subject:</span> {r.source_email_subject}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500">{SOURCE_LABEL[r.source_type] ?? r.source_type}</p>
                    )}
                    <p className="mt-1 font-mono text-[10px] text-slate-400" title={r.id}>
                      {r.id.slice(0, 8)}…
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">{extractionSummary(r)}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{formatDate(r.created_at)}</p>
                    <p className="mt-1 text-[10px] font-medium text-slate-500">Next: {nextStepHint(r)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Link
                      href={primary.href}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-center text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      {primary.label}
                    </Link>
                    {!linked && (
                      <div className="flex flex-wrap justify-end gap-x-2 gap-y-0.5 text-[11px]">
                        <Link href={reviewHref} className="text-slate-500 hover:text-slate-800 hover:underline">
                          Open review
                        </Link>
                        <span className="text-slate-300">|</span>
                        <Link href={expenseHref} className="text-slate-600 hover:text-blue-800 hover:underline">
                          Expense
                        </Link>
                        <Link href={billHref} className="text-slate-600 hover:text-blue-800 hover:underline">
                          Bill
                        </Link>
                      </div>
                    )}
                    {linked && linkedHref ? (
                      <Link href={reviewHref} className="text-[11px] text-slate-500 hover:text-slate-800 hover:underline">
                        Open review (read-only)
                      </Link>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
            <span>
              Showing {offset + 1}–{offset + rows.length} of {total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!hasPrev}
                className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
                onClick={() => setParam({ offset: String(Math.max(0, offset - limit)) })}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!hasNext}
                className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
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
