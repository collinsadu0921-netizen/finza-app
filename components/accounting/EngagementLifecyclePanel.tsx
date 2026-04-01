"use client"

import { useState } from "react"
import { evaluateEngagementState } from "@/lib/accounting/evaluateEngagementState"
import EngagementAccessModal from "./EngagementAccessModal"
import TerminateEngagementModal from "./TerminateEngagementModal"
import SuspendEngagementModal from "./SuspendEngagementModal"
import EngagementTimeline from "./EngagementTimeline"
import type { Engagement } from "@/lib/firmEngagements"
import type { EngagementStateResult } from "@/lib/accounting/evaluateEngagementState"

type EngagementRow = Pick<
  Engagement,
  "id" | "status" | "access_level" | "effective_from" | "effective_to" | "accepted_at" | "accepted_by" | "accounting_firm_id" | "client_business_id"
>

const STATE_STYLES: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20" },
  PENDING: { label: "Pending", className: "text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20" },
  SUSPENDED: { label: "Suspended", className: "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20" },
  TERMINATED: { label: "Terminated", className: "text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800" },
  NOT_EFFECTIVE: { label: "Not effective", className: "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20" },
  NO_ENGAGEMENT: { label: "No engagement", className: "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20" },
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—"
  return new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export interface EngagementLifecyclePanelProps {
  engagement: EngagementRow | null
  evaluatorResult: EngagementStateResult | null
  authoritySource: "owner" | "employee" | "accountant" | "report_viewer" | null
  firmRole: string | null
  clientName: string
  businessName?: string
  activityLogs?: { id: string; action_type: string; created_at: string; metadata?: Record<string, unknown> }[] | null
  onUpdated?: () => void
}

export default function EngagementLifecyclePanel({
  engagement,
  evaluatorResult,
  authoritySource,
  firmRole,
  clientName,
  businessName,
  activityLogs,
  onUpdated,
}: EngagementLifecyclePanelProps) {
  const [accessModalOpen, setAccessModalOpen] = useState(false)
  const [terminateModalOpen, setTerminateModalOpen] = useState(false)
  const [suspendModalOpen, setSuspendModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const state = evaluatorResult?.state ?? "NO_ENGAGEMENT"
  const style = STATE_STYLES[state] ?? STATE_STYLES.NO_ENGAGEMENT
  const isPartner = firmRole === "partner"
  const canAct = isPartner && engagement && engagement.status !== "terminated"

  const patchStatus = async (newStatus: string) => {
    if (!engagement?.id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/accounting/firm/engagements/${engagement.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Failed")
      onUpdated?.()
    } finally {
      setLoading(false)
    }
  }

  const patchEngagement = async (action: string, body: Record<string, unknown> = {}) => {
    if (!engagement?.id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/accounting/firm/engagements/${engagement.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Failed")
      onUpdated?.()
    } finally {
      setLoading(false)
    }
  }

  if (!engagement && authoritySource !== "accountant") return null

  if (!engagement) {
    return (
      <section className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4">
        <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Engagement
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">No engagement for this client.</p>
      </section>
    )
  }

  return (
    <>
      <section className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4">
        <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Engagement lifecycle
        </h2>

        <div className="space-y-3 text-sm">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Client</span>
            <p className="font-medium text-gray-900 dark:text-white">{businessName ?? clientName}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-500 dark:text-gray-400">Status</span>
            <span className={`inline-flex px-2 py-0.5 rounded font-medium ${style.className}`}>
              {style.label}
            </span>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Access level</span>
            <p className="text-gray-900 dark:text-white capitalize">{engagement.access_level}</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Effective</span>
            <p className="text-gray-900 dark:text-white">
              {formatDate(engagement.effective_from)} – {engagement.effective_to ? formatDate(engagement.effective_to) : "ongoing"}
            </p>
          </div>
          {(engagement.accepted_at || engagement.accepted_by) && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Accepted</span>
              <p className="text-gray-900 dark:text-white">
                {formatDate(engagement.accepted_at)}
                {engagement.accepted_by ? ` by ${engagement.accepted_by.slice(0, 8)}…` : ""}
              </p>
            </div>
          )}
          <div>
            <span className="text-gray-500 dark:text-gray-400">Firm ID</span>
            <p className="text-gray-900 dark:text-white font-mono text-xs">{engagement.accounting_firm_id.slice(0, 8)}…</p>
          </div>

          <EngagementTimeline
            engagement={{
              status: engagement.status,
              effective_from: engagement.effective_from,
              effective_to: engagement.effective_to ?? null,
              accepted_at: engagement.accepted_at ?? null,
            }}
            activityLogs={activityLogs ?? null}
          />

          {state === "TERMINATED" && (
            <p className="text-sm text-gray-600 dark:text-gray-400 pt-2 border-t border-gray-200 dark:border-gray-700">
              Engagement terminated — new engagement required.
            </p>
          )}

          {canAct && state === "PENDING" && (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => patchStatus("accepted")}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? "…" : "Accept engagement"}
              </button>
            </div>
          )}

          {canAct && state === "ACTIVE" && (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => setSuspendModalOpen(true)}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Suspend engagement
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => setTerminateModalOpen(true)}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                Terminate engagement
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => setAccessModalOpen(true)}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Change access level
              </button>
            </div>
          )}

          {canAct && state === "SUSPENDED" && (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => patchStatus("active")}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? "…" : "Reactivate engagement"}
              </button>
            </div>
          )}

          {authoritySource === "accountant" && !isPartner && engagement.status !== "terminated" && (
            <p className="text-xs text-gray-500 dark:text-gray-400 pt-2">
              Only partners can change engagement status or access.
            </p>
          )}
        </div>
      </section>

      <EngagementAccessModal
        open={accessModalOpen}
        onClose={() => setAccessModalOpen(false)}
        currentLevel={engagement.access_level as "read" | "write" | "approve"}
        onConfirm={async (level) => {
          await patchEngagement("update", { access_level: level })
          setAccessModalOpen(false)
        }}
        loading={loading}
      />

      <TerminateEngagementModal
        open={terminateModalOpen}
        onClose={() => setTerminateModalOpen(false)}
        clientName={businessName ?? clientName}
        onConfirm={async () => {
          await patchEngagement("terminate")
          setTerminateModalOpen(false)
        }}
        loading={loading}
      />

      <SuspendEngagementModal
        open={suspendModalOpen}
        onClose={() => setSuspendModalOpen(false)}
        onConfirm={async () => {
          await patchEngagement("suspend")
          setSuspendModalOpen(false)
        }}
        loading={loading}
      />
    </>
  )
}
