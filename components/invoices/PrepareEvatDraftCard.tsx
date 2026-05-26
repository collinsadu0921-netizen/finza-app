"use client"

import { useCallback, useState } from "react"

import { formatMoney } from "@/lib/money"
import {
  normalizeEvatDraftPrepareResponse,
  type EvatDraftPrepareParsed,
} from "@/lib/gra/evat/prepareEvatDraftClient"

type Props = {
  invoiceId: string
  businessId: string | null
  currencyCode: string
}

function IssueList({ title, codes }: { title: string; codes: string[] }) {
  if (codes.length === 0) return null
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-slate-700 dark:text-slate-300">
        {codes.map((c) => (
          <li key={c} className="font-mono">
            {c}
          </li>
        ))}
      </ul>
    </div>
  )
}

function TotalsDl({
  currencyCode,
  totals,
}: {
  currencyCode: string
  totals: { mappedTotalTax: number; storedTotalTax: number; taxDifference: number }
}) {
  return (
    <dl className="mt-3 space-y-1.5 text-xs">
      <div className="flex justify-between gap-2">
        <dt className="text-slate-500 dark:text-slate-400">Mapped total tax</dt>
        <dd className="font-medium tabular-nums text-slate-900 dark:text-white">
          {formatMoney(totals.mappedTotalTax, currencyCode)}
        </dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-slate-500 dark:text-slate-400">Stored total tax</dt>
        <dd className="font-medium tabular-nums text-slate-900 dark:text-white">
          {formatMoney(totals.storedTotalTax, currencyCode)}
        </dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-slate-500 dark:text-slate-400">Tax difference</dt>
        <dd className="font-medium tabular-nums text-slate-900 dark:text-white">
          {formatMoney(totals.taxDifference, currencyCode)}
        </dd>
      </div>
    </dl>
  )
}

export function PrepareEvatDraftCard({ invoiceId, businessId, currencyCode }: Props) {
  const [loading, setLoading] = useState(false)
  const [parsed, setParsed] = useState<EvatDraftPrepareParsed | null>(null)

  const prepareDraft = useCallback(async () => {
    if (!businessId?.trim()) return
    setLoading(true)
    setParsed(null)
    try {
      const url = `/api/gra/evat/invoices/${encodeURIComponent(invoiceId)}/draft?business_id=${encodeURIComponent(businessId)}`
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: "test", submission_type: "invoice" }),
      })
      let json: unknown = null
      try {
        json = await res.json()
      } catch {
        json = null
      }
      setParsed(normalizeEvatDraftPrepareResponse(res.ok, json))
    } catch {
      setParsed({ kind: "http_error" })
    } finally {
      setLoading(false)
    }
  }, [invoiceId, businessId])

  if (!businessId) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-gray-800">
      <h3 className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-400">E-VAT</h3>
      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
        This only prepares an internal Finza E-VAT draft. It does not submit anything to GRA.
      </p>
      <button
        type="button"
        onClick={prepareDraft}
        disabled={loading}
        className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
      >
        {loading ? "Preparing…" : "Prepare E-VAT draft"}
      </button>

      {parsed?.kind === "success" && (
        <div
          className="mt-4 rounded-md border border-emerald-200 bg-emerald-50/90 px-3 py-2.5 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100"
          role="status"
        >
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-50">
            E-VAT draft prepared. Nothing has been submitted to GRA yet.
          </p>
          <dl className="mt-2 space-y-1 text-xs text-emerald-900/90 dark:text-emerald-100/90">
            <div className="flex justify-between gap-2">
              <dt>Submission ID</dt>
              <dd className="max-w-[65%] truncate font-mono text-right text-[11px]">{parsed.submissionId}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Submittable</dt>
              <dd className="font-medium">{parsed.submittable ? "Yes" : "No"}</dd>
            </div>
          </dl>
          <TotalsDl currencyCode={currencyCode} totals={parsed.totals} />
          <IssueList title="Warnings" codes={parsed.warnings} />
        </div>
      )}

      {parsed?.kind === "blocked" && (
        <div
          className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-50"
          role="status"
        >
          <p className="text-sm font-medium">E-VAT draft could not be prepared for submission.</p>
          <IssueList title="Blocking issues" codes={parsed.blockingIssues} />
          <IssueList title="Warnings" codes={parsed.warnings} />
          {parsed.totals && <TotalsDl currencyCode={currencyCode} totals={parsed.totals} />}
        </div>
      )}

      {parsed?.kind === "http_error" && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200" role="alert">
          Could not prepare E-VAT draft.
        </p>
      )}
    </div>
  )
}
