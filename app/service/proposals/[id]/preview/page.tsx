"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { ProposalDocumentView } from "@/components/proposals/ProposalDocumentView"
import type { ProposalRenderModel } from "@/lib/proposals/renderModel"
import type { PricingMode } from "@/lib/proposals/schema"
import {
  normalizeProposalStatus,
  PROPOSAL_STATUS_LABEL,
  proposalConversionBlockReason,
  proposalStaffOutboundChannelsAllowed,
} from "@/lib/proposals/proposalState"

export default function ProposalPreviewPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [model, setModel] = useState<ProposalRenderModel | null>(null)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [publicLink, setPublicLink] = useState("")
  const [workflowStatus, setWorkflowStatus] = useState("")
  const [sendBusy, setSendBusy] = useState(false)
  const [copyTip, setCopyTip] = useState(false)
  const [pricingMode, setPricingMode] = useState<PricingMode>("none")
  const [convertedEstimateId, setConvertedEstimateId] = useState<string | null>(null)
  const [convertBusy, setConvertBusy] = useState(false)
  const [convertBanner, setConvertBanner] = useState("")
  const [customerId, setCustomerId] = useState("")
  const [sentAt, setSentAt] = useState<string | null>(null)
  const [sendFeedback, setSendFeedback] = useState("")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setError("Not logged in")
          return
        }
        const business = await getCurrentBusiness(supabase, user.id)
        if (!business) {
          setError("Business not found")
          return
        }
        if (cancelled) return
        setBusinessId(business.id)
        const qs = new URLSearchParams({ business_id: business.id }).toString()
        const res = await fetch(`/api/proposals/${id}?${qs}`, { credentials: "same-origin" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error || "Failed to load")
          return
        }
        if (data.render) setModel(data.render as ProposalRenderModel)
        const p = data.proposal as {
          status?: string
          public_token?: string
          pricing_mode?: PricingMode
          converted_estimate_id?: string | null
          customer_id?: string | null
          sent_at?: string | null
        } | undefined
        if (p?.public_token && typeof window !== "undefined") {
          setPublicLink(`${window.location.origin}/proposal-public/${encodeURIComponent(p.public_token)}`)
        }
        if (p?.status) setWorkflowStatus(p.status)
        if (p?.pricing_mode) setPricingMode(p.pricing_mode)
        setConvertedEstimateId((p?.converted_estimate_id as string) || null)
        setCustomerId((p?.customer_id as string) || "")
        setSentAt((p?.sent_at as string) || null)
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const qs = businessId ? new URLSearchParams({ business_id: businessId }).toString() : ""

  type ProposalSendChannel = "mark_sent" | "email" | "whatsapp"

  async function sendProposal(channel: ProposalSendChannel) {
    if (!businessId) return
    const st = workflowStatus ? normalizeProposalStatus(workflowStatus) : "draft"
    if (!proposalStaffOutboundChannelsAllowed(st)) {
      setError("This proposal can’t be sent or shared in its current state.")
      return
    }
    if (channel === "mark_sent" && st !== "draft") {
      setError("Mark as sent is only available while the proposal is a draft.")
      return
    }
    if (channel === "email" && !customerId.trim()) {
      setError("Link this proposal to a customer with an email address before sending by email.")
      return
    }
    try {
      setSendBusy(true)
      setError("")
      setSendFeedback("")
      const res = await fetch(`/api/proposals/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ business_id: businessId, channel }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data.error as string) || (data.message as string) || "Send failed")
        return
      }
      if (typeof data.public_url === "string") setPublicLink(data.public_url)
      if (data.proposal?.status) setWorkflowStatus(data.proposal.status as string)
      if (data.proposal?.sent_at) setSentAt(data.proposal.sent_at as string)
      if (channel === "whatsapp" && typeof data.whatsapp_url === "string") {
        window.open(data.whatsapp_url as string, "_blank", "noopener,noreferrer")
      }
      if (channel === "email") setSendFeedback("Email sent successfully.")
      if (channel === "whatsapp") setSendFeedback("WhatsApp opened with a prefilled message and your proposal link.")
      if (channel === "mark_sent") {
        setSendFeedback(data.already_marked_sent ? "Already marked as sent." : "Marked as sent.")
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Send failed")
    } finally {
      setSendBusy(false)
    }
  }

  async function copyLink() {
    if (!publicLink) return
    try {
      await navigator.clipboard.writeText(publicLink)
      setCopyTip(true)
      window.setTimeout(() => setCopyTip(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const st = workflowStatus ? normalizeProposalStatus(workflowStatus) : "draft"
  const convertBlock = proposalConversionBlockReason({
    status: st,
    converted_estimate_id: convertedEstimateId,
    pricing_mode: pricingMode,
  })
  const canConvertToEstimate = convertBlock === null && st === "accepted"

  async function convertToEstimate() {
    if (!businessId || !canConvertToEstimate) return
    if (!window.confirm("Create a new draft estimate from this proposal? The proposal will be marked as converted.")) {
      return
    }
    try {
      setConvertBusy(true)
      setError("")
      setConvertBanner("")
      const res = await fetch(`/api/proposals/${id}/convert-estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ business_id: businessId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.converted_estimate_id) {
        setConvertedEstimateId(data.converted_estimate_id as string)
        setError(data.error || "Already converted")
        return
      }
      if (!res.ok) {
        throw new Error(data.error || data.message || "Conversion failed")
      }
      const estId = data.estimate_id as string | undefined
      if (estId) {
        setConvertedEstimateId(estId)
        setWorkflowStatus("converted")
        setConvertBanner("Draft quote created.")
        router.push(`/service/estimates/${estId}/edit`)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Conversion failed")
    } finally {
      setConvertBusy(false)
    }
  }

  const pdfHref = businessId ? `/api/proposals/${id}/export-pdf?${qs}` : ""

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 lg:px-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-6xl space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.push(`/service/proposals/${id}/edit`)}
            className="text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            ← Back to editor
          </button>
          <div className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">Status:</span>{" "}
            {workflowStatus ? PROPOSAL_STATUS_LABEL[st] : "—"}
            {sentAt ? (
              <span className="ml-2 text-slate-500">
                · Sent {new Date(sentAt).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            ) : null}
          </div>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Client document</p>
          <p className="mt-1 text-sm text-slate-600">Print or download for records. The public link is what you send to the client.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Print
            </button>
            {pdfHref ? (
              <a
                href={pdfHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                Download PDF
              </a>
            ) : (
              <span className="inline-flex items-center rounded-lg border border-dashed border-slate-200 px-4 py-2 text-sm text-slate-400">
                Download PDF (loading…)
              </span>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Send &amp; share</p>
          <p className="mt-1 text-sm text-slate-600">Uses the same rules as the editor — draft-only where applicable.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={sendBusy || !proposalStaffOutboundChannelsAllowed(st) || !customerId.trim() || !businessId}
              title={!customerId.trim() ? "Link a customer with an email in the editor first." : undefined}
              onClick={() => void sendProposal("email")}
              className="rounded-lg bg-blue-800 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-40"
            >
              {sendBusy ? "…" : st === "draft" ? "Send by email" : "Resend email"}
            </button>
            <button
              type="button"
              disabled={sendBusy || !proposalStaffOutboundChannelsAllowed(st) || !businessId}
              onClick={() => void sendProposal("whatsapp")}
              className="rounded-lg bg-green-700 px-3 py-2 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-40"
            >
              {sendBusy ? "…" : st === "draft" ? "Share via WhatsApp" : "WhatsApp again"}
            </button>
            <button
              type="button"
              disabled={sendBusy || st !== "draft" || !businessId}
              onClick={() => void sendProposal("mark_sent")}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {sendBusy ? "…" : "Mark as sent"}
            </button>
            <button
              type="button"
              disabled={!publicLink}
              onClick={() => void copyLink()}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
            >
              {copyTip ? "Copied" : "Copy public link"}
            </button>
            {publicLink ? (
              <a
                href={publicLink}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                Open public page
              </a>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">After acceptance</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={convertBusy || !canConvertToEstimate || !businessId}
              title={
                !canConvertToEstimate
                  ? st !== "accepted"
                    ? "Only accepted proposals can be converted."
                    : convertBlock === "pricing"
                      ? "Add fixed or line-item pricing on the proposal first."
                      : "Cannot convert in the current state."
                  : undefined
              }
              onClick={() => void convertToEstimate()}
              className="rounded-lg bg-emerald-800 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-900 disabled:opacity-40"
            >
              {convertBusy ? "…" : "Convert to estimate"}
            </button>
            {convertedEstimateId ? (
              <a
                href={`/service/estimates/${convertedEstimateId}/edit`}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                Open draft quote
              </a>
            ) : null}
          </div>
        </section>

        {sendFeedback ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{sendFeedback}</div>
        ) : null}
        {convertBanner ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{convertBanner}</div>
        ) : null}
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      </div>

      <div className="mx-auto mt-6 max-w-5xl print:mt-0 print:max-w-none">
        {model ? (
          <ProposalDocumentView model={model} variant="screen" previewLayout />
        ) : !error ? (
          <div className="py-16 text-center text-slate-500 print:hidden">Loading…</div>
        ) : null}
      </div>
    </div>
  )
}
