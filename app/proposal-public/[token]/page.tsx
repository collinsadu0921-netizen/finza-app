"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { ProposalDocumentView } from "@/components/proposals/ProposalDocumentView"
import type { ProposalRenderModel } from "@/lib/proposals/renderModel"
import { normalizeProposalStatus, PROPOSAL_STATUS_LABEL } from "@/lib/proposals/proposalState"

type PublicMeta = {
  title?: string
  status: string
  proposal_number?: string | null
  business_name?: string
  viewed_at?: string | null
  sent_at?: string | null
  accepted_at?: string | null
  rejected_at?: string | null
  rejected_reason?: string | null
  actionable: boolean
  can_accept: boolean
  can_reject: boolean
}

export default function PublicProposalPage() {
  const params = useParams()
  const token = params.token as string
  const [model, setModel] = useState<ProposalRenderModel | null>(null)
  const [meta, setMeta] = useState<PublicMeta | null>(null)
  const [error, setError] = useState("")
  const [rejectReason, setRejectReason] = useState("")
  const [showReject, setShowReject] = useState(false)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState("")

  const load = useCallback(async () => {
    const enc = encodeURIComponent(token)
    const res = await fetch(`/api/proposals/public/${enc}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || "Proposal not found")
      setModel(null)
      setMeta(null)
      return
    }
    setError("")
    if (data.render) setModel(data.render as ProposalRenderModel)
    if (data.meta) setMeta(data.meta as PublicMeta)
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function accept() {
    try {
      setBusy(true)
      setBanner("")
      const enc = encodeURIComponent(token)
      const res = await fetch(`/api/proposals/public/${enc}/accept`, { method: "POST", credentials: "same-origin" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBanner(data.error || "Could not accept")
        return
      }
      setBanner("Thank you — this proposal has been accepted.")
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function reject() {
    try {
      setBusy(true)
      setBanner("")
      const enc = encodeURIComponent(token)
      const res = await fetch(`/api/proposals/public/${enc}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ rejected_reason: rejectReason.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBanner(data.error || "Could not reject")
        return
      }
      setBanner("Your response has been recorded.")
      setShowReject(false)
      setRejectReason("")
      await load()
    } finally {
      setBusy(false)
    }
  }

  const st = meta ? normalizeProposalStatus(meta.status) : "draft"
  const label = PROPOSAL_STATUS_LABEL[st]

  return (
    <div className="min-h-screen bg-slate-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 print:max-w-none">
        <header className="text-center print:hidden">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Proposal</p>
          {meta?.title ? <h1 className="mt-1 text-xl font-semibold text-slate-900">{meta.title}</h1> : null}
          {meta?.business_name ? <p className="mt-1 text-sm text-slate-600">{meta.business_name}</p> : null}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-800 ring-1 ring-slate-200">
              {label}
            </span>
          </div>
        </header>

        {model && !error ? (
          <div className="mx-auto mt-4 flex max-w-4xl justify-end gap-2 print:hidden">
            <a
              href={`/api/proposals/public/${encodeURIComponent(token)}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
            >
              Download PDF
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Print
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mx-auto mt-6 max-w-lg rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {banner ? (
          <div className="mx-auto mt-4 max-w-2xl rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-900 print:hidden">
            {banner}
          </div>
        ) : null}

        {meta && !error ? (
          <section className="mx-auto mt-6 max-w-2xl rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
            {meta.actionable ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">You can accept this proposal as presented, or decline it.</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void accept()}
                    className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    Accept proposal
                  </button>
                  {!showReject ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setShowReject(true)}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Decline
                    </button>
                  ) : null}
                </div>
                {showReject ? (
                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <label className="block text-xs font-medium text-slate-600">
                      Optional note (for the business)
                      <textarea
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        rows={3}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        maxLength={2000}
                        placeholder="Reason for declining (optional)"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void reject()}
                        className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                      >
                        Confirm decline
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setShowReject(false)
                          setRejectReason("")
                        }}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-center text-sm text-slate-600">
                {st === "accepted"
                  ? "This proposal has been accepted."
                  : st === "rejected"
                    ? "This proposal was declined."
                    : st === "draft"
                      ? "This proposal is not yet available for a decision."
                      : `This proposal is ${label.toLowerCase()} and cannot be changed here.`}
              </p>
            )}
            {meta.rejected_reason && st === "rejected" ? (
              <p className="mt-2 text-center text-xs text-slate-500">Note: {meta.rejected_reason}</p>
            ) : null}
          </section>
        ) : null}

        {model ? (
          <div className="mt-8 print:mt-4">
            <ProposalDocumentView model={model} variant="public" />
          </div>
        ) : !error ? (
          <div className="mt-12 text-center text-slate-500">Loading…</div>
        ) : null}
      </div>
    </div>
  )
}
