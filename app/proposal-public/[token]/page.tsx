"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { ProposalReader } from "@/components/proposals/ProposalReader"
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
  const terminalDecision = st === "accepted" || st === "converted" || st === "rejected"

  // Terminal decisions are already explained by the reader's acceptance status
  // block. Avoid exposing internal workflow language such as "Converted".
  const acceptanceSlot = meta && !terminalDecision ? (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {meta.actionable ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Review the proposal above, then accept it as presented or decline with an optional note.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
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
                  onChange={(event) => setRejectReason(event.target.value)}
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
        <div className="text-sm text-slate-600">
          <p className="font-semibold text-slate-900">{label}</p>
          <p className="mt-1">
            {st === "accepted"
              ? "This proposal has been accepted."
              : st === "rejected"
                ? "This proposal was declined."
                : st === "draft"
                  ? "This proposal is not yet available for a decision."
                  : `This proposal is ${label.toLowerCase()} and cannot be changed here.`}
          </p>
        </div>
      )}
      {meta.rejected_reason && st === "rejected" ? (
        <p className="mt-2 text-xs text-slate-500">Note: {meta.rejected_reason}</p>
      ) : null}
    </div>
  ) : null

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 print:max-w-none">
        {error ? (
          <div className="mx-auto mt-6 max-w-lg rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {banner ? (
          <div className="mx-auto mb-4 max-w-2xl rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-900 print:hidden">
            {banner}
          </div>
        ) : null}

        {model ? (
          <ProposalReader
            model={model}
            pdfHref={`/api/proposals/public/${encodeURIComponent(token)}/pdf`}
            acceptanceSlot={acceptanceSlot}
          />
        ) : !error ? (
          <div className="mt-12 text-center text-slate-500">Loading…</div>
        ) : null}
      </div>
    </div>
  )
}
