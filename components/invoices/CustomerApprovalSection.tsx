"use client"

import { useState } from "react"
import {
  CUSTOMER_APPROVAL_ACTION_LABELS,
  CUSTOMER_APPROVAL_LABELS,
  customerApprovalActionsForStatus,
  type CustomerApprovalAction,
  type CustomerApprovalStatus,
} from "@/lib/invoices/customerApproval"

type ApprovalInvoice = {
  id: string
  business_id: string
  customer_approval_status?: string | null
  customer_approval_note?: string | null
  customer_approval_method?: string | null
  customer_approved_at?: string | null
  customer_rejected_at?: string | null
  customer_approval_requested_at?: string | null
}

const BADGE_STYLES: Record<CustomerApprovalStatus, string> = {
  not_requested: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  pending_approval: "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  approved: "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  rejected: "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200",
}

function fmtDate(value: string | null | undefined): string | null {
  if (!value) return null
  return new Date(value).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export type CustomerApprovalSectionProps = {
  invoice: ApprovalInvoice
  readOnly?: boolean
  onUpdated: () => void | Promise<void>
}

export default function CustomerApprovalSection({
  invoice,
  readOnly = false,
  onUpdated,
}: CustomerApprovalSectionProps) {
  const [loadingAction, setLoadingAction] = useState<CustomerApprovalAction | null>(null)
  const [error, setError] = useState("")

  const status = (invoice.customer_approval_status || "not_requested") as CustomerApprovalStatus
  const actions = customerApprovalActionsForStatus(status, readOnly)

  const runAction = async (action: CustomerApprovalAction) => {
    setLoadingAction(action)
    setError("")
    try {
      let note: string | undefined
      if (action === "reject" || action === "approve") {
        const promptLabel =
          action === "reject" ? "Optional rejection note" : "Optional approval note"
        const entered = window.prompt(promptLabel)
        if (entered === null && action === "reject") {
          setLoadingAction(null)
          return
        }
        note = entered?.trim() || undefined
      }

      const res = await fetch(`/api/invoices/${invoice.id}/approval`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          business_id: invoice.business_id,
          note,
          method: action === "approve" ? "manual" : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Could not update approval")
      }
      await onUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update approval")
    } finally {
      setLoadingAction(null)
    }
  }

  const statusNote =
    status === "approved"
      ? fmtDate(invoice.customer_approved_at)
      : status === "rejected"
        ? fmtDate(invoice.customer_rejected_at)
        : status === "pending_approval"
          ? fmtDate(invoice.customer_approval_requested_at)
          : null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Customer approval</p>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${BADGE_STYLES[status] ?? BADGE_STYLES.not_requested}`}
            >
              {CUSTOMER_APPROVAL_LABELS[status] ?? status}
            </span>
            {statusNote ? (
              <span className="text-xs text-slate-500 dark:text-slate-400">Updated {statusNote}</span>
            ) : null}
          </div>
          {invoice.customer_approval_note ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">{invoice.customer_approval_note}</p>
          ) : null}
          {invoice.customer_approval_method ? (
            <p className="text-xs text-slate-400">Method: {invoice.customer_approval_method}</p>
          ) : null}
        </div>

        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                disabled={loadingAction != null}
                onClick={() => void runAction(action)}
                className={`inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                  action === "reject"
                    ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                    : action === "approve"
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                }`}
              >
                {loadingAction === action ? "Saving…" : CUSTOMER_APPROVAL_ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  )
}
