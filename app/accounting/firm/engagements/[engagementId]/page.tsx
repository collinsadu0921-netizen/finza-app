"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import ProtectedLayout from "@/components/ProtectedLayout"
import PageHeader from "@/components/ui/PageHeader"
import { EngagementStatusBadge, AccessLevelBadge } from "@/components/EngagementStatusBadge"
import EngagementStatusTimeline from "@/components/accounting/EngagementStatusTimeline"
import EditEngagementModal from "@/components/accounting/EditEngagementModal"
import TerminateEngagementModal from "@/components/accounting/TerminateEngagementModal"
import { evaluateEngagementState } from "@/lib/accounting/evaluateEngagementState"
import {
  ACTIVE,
  ENGAGEMENT_NOT_EFFECTIVE,
  ENGAGEMENT_PENDING,
  ENGAGEMENT_SUSPENDED,
  ENGAGEMENT_TERMINATED,
  NO_ENGAGEMENT,
} from "@/lib/accounting/reasonCodes"
import { resolveAuthority } from "@/lib/firmAuthority"
import type { FirmRole } from "@/lib/firmAuthority"
import type { Engagement, EngagementStatus } from "@/lib/firmEngagements"

const STATUS_ALLOWED: Record<string, string[]> = {
  pending: ["accepted", "terminated"],
  accepted: ["active", "suspended", "terminated"],
  active: ["suspended", "terminated"],
  suspended: ["active", "terminated"],
  terminated: [],
}

const REASON_CODE_LABELS: Record<string, string> = {
  [NO_ENGAGEMENT]: "No engagement",
  [ENGAGEMENT_PENDING]: "Pending acceptance",
  [ENGAGEMENT_SUSPENDED]: "Suspended",
  [ENGAGEMENT_TERMINATED]: "Terminated",
  [ENGAGEMENT_NOT_EFFECTIVE]: "Outside effective window",
  [ACTIVE]: "Active and effective",
}

type ActivityLog = {
  id: string
  firm_id: string
  actor_user_id: string
  action_type: string
  entity_type: string
  entity_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

type EngagementWithBusiness = Engagement & { business_name?: string }

export default function EngagementCommandCenterPage() {
  const params = useParams()
  const router = useRouter()
  const engagementId = typeof params?.engagementId === "string" ? params.engagementId : null

  const [engagement, setEngagement] = useState<EngagementWithBusiness | null>(null)
  const [viewerFirmRole, setViewerFirmRole] = useState<FirmRole | null>(null)
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [terminateModalOpen, setTerminateModalOpen] = useState(false)
  const [effectiveFromEdit, setEffectiveFromEdit] = useState("")
  const [effectiveToEdit, setEffectiveToEdit] = useState("")
  const [effectiveWindowSaving, setEffectiveWindowSaving] = useState(false)
  const [effectiveWindowError, setEffectiveWindowError] = useState<string | null>(null)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)

  const loadEngagement = useCallback(async (): Promise<EngagementWithBusiness | null> => {
    if (!engagementId) return null
    const res = await fetch(`/api/accounting/firm/engagements/${engagementId}`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || "Failed to load engagement")
    }
    const data = await res.json()
    const eng = data.engagement ?? null
    setEngagement(eng)
    return eng
  }, [engagementId])

  const loadViewerRole = useCallback(async (firmId: string) => {
    const res = await fetch("/api/accounting/firm/firms")
    if (!res.ok) return
    const data = await res.json()
    const firm = (data.firms || []).find((f: { firm_id: string }) => f.firm_id === firmId)
    if (firm?.role) setViewerFirmRole(firm.role as FirmRole)
  }, [])

  const loadActivity = useCallback(async () => {
    if (!engagementId) return
    const res = await fetch(
      `/api/accounting/firm/activity?engagement_id=${encodeURIComponent(engagementId)}&limit=100`
    )
    if (!res.ok) return
    const data = await res.json()
    setActivityLogs(data.logs || [])
  }, [engagementId])

  useEffect(() => {
    if (!engagementId) {
      setError("Missing engagement id")
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const eng = await loadEngagement()
        if (cancelled) return
        if (eng?.accounting_firm_id) await loadViewerRole(eng.accounting_firm_id)
        await loadActivity()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [engagementId, loadEngagement, loadViewerRole, loadActivity])

  useEffect(() => {
    if (engagement) {
      setEffectiveFromEdit(engagement.effective_from || "")
      setEffectiveToEdit(engagement.effective_to ?? "")
    }
  }, [engagement?.id, engagement?.effective_from, engagement?.effective_to])

  const evaluated = engagement
    ? evaluateEngagementState({
        engagement: {
          status: engagement.status,
          effective_from: engagement.effective_from,
          effective_to: engagement.effective_to,
        },
      })
    : null

  const isPartner = viewerFirmRole === "partner"
  const currentStatus = (engagement?.status ?? "").toLowerCase() as EngagementStatus
  const allowedNext = STATUS_ALLOWED[currentStatus] ?? []
  const terminateAuthority = engagement
    ? resolveAuthority({
        firmRole: viewerFirmRole,
        engagementAccess: engagement.access_level,
        action: "terminate_engagement",
        engagementStatus: engagement.status as "pending" | "active" | "suspended" | "terminated" | null,
      })
    : { allowed: false, reason: "Unknown" }
  const updateAuthority = engagement
    ? resolveAuthority({
        firmRole: viewerFirmRole,
        engagementAccess: engagement.access_level,
        action: "update_engagement",
        engagementStatus: engagement.status as "pending" | "active" | "suspended" | "terminated" | null,
      })
    : { allowed: false }

  const canTerminate = isPartner && terminateAuthority.allowed && engagement?.status !== "terminated"
  const canUpdateAccess = isPartner && updateAuthority.allowed
  const canChangeStatus = isPartner

  const handleStatusTransition = async (newStatus: string) => {
    if (!engagementId || !engagement) return
    setActionLoading(newStatus)
    try {
      const res = await fetch(`/api/accounting/firm/engagements/${engagementId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Status update failed")
      await loadEngagement()
      await loadActivity()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed")
    } finally {
      setActionLoading(null)
    }
  }

  const handleTerminate = async (_reason?: string) => {
    if (!engagementId) return
    setActionLoading("terminate")
    try {
      const res = await fetch(`/api/accounting/firm/engagements/${engagementId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "terminate" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Termination failed")
      setTerminateModalOpen(false)
      await loadEngagement()
      await loadActivity()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed")
    } finally {
      setActionLoading(null)
    }
  }

  const handleEditSave = async (payload: {
    access_level: "read" | "write" | "approve"
    effective_from: string
    effective_to: string | null
  }) => {
    if (!engagementId) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/accounting/firm/engagements/${engagementId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          access_level: payload.access_level,
          effective_from: payload.effective_from,
          effective_to: payload.effective_to,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Update failed")
      setEditModalOpen(false)
      await loadEngagement()
      await loadActivity()
    } finally {
      setEditSaving(false)
    }
  }

  const handleAccessLevelSave = async (level: "read" | "write" | "approve") => {
    if (!engagementId) return
    setActionLoading("access")
    try {
      const res = await fetch(`/api/accounting/firm/engagements/${engagementId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", access_level: level }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Update failed")
      await loadEngagement()
      await loadActivity()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed")
    } finally {
      setActionLoading(null)
    }
  }

  const handleEffectiveWindowSave = async () => {
    if (!engagementId) return
    const from = effectiveFromEdit.trim()
    const to = effectiveToEdit.trim() || null
    if (to && from && to <= from) {
      setEffectiveWindowError("effective_to must be after effective_from")
      return
    }
    setEffectiveWindowError(null)
    setEffectiveWindowSaving(true)
    try {
      const res = await fetch(`/api/accounting/firm/engagements/${engagementId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          effective_from: from,
          effective_to: to,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Update failed")
      await loadEngagement()
      await loadActivity()
    } catch (e) {
      setEffectiveWindowError(e instanceof Error ? e.message : "Failed")
    } finally {
      setEffectiveWindowSaving(false)
    }
  }

  const formatDate = (s: string | null | undefined) =>
    s ? new Date(s).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—"
  const formatDateTime = (s: string | null | undefined) =>
    s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—"

  if (!engagementId) {
    return (
      <ProtectedLayout>
        <div className="max-w-4xl mx-auto px-4 py-8">
          <p className="text-red-600 dark:text-red-400">Missing engagement id.</p>
          <Link href="/accounting/firm" className="text-blue-600 dark:text-blue-400 underline mt-2 inline-block">
            Back to Firm
          </Link>
        </div>
      </ProtectedLayout>
    )
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="max-w-4xl mx-auto px-4 py-12 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading engagement...</p>
        </div>
      </ProtectedLayout>
    )
  }

  if (error || !engagement) {
    return (
      <ProtectedLayout>
        <div className="max-w-4xl mx-auto px-4 py-8">
          <p className="text-red-600 dark:text-red-400">{error || "Engagement not found."}</p>
          <Link href="/accounting/firm" className="text-blue-600 dark:text-blue-400 underline mt-2 inline-block">
            Back to Firm
          </Link>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <PageHeader
          title="Engagement Command Center"
          subtitle={
            <>
              <Link href="/accounting/firm" className="text-gray-500 dark:text-gray-400 hover:underline">
                Firm
              </Link>
              {" → "}
              <span className="text-gray-700 dark:text-gray-300">{engagement.business_name ?? "Client"}</span>
            </>
          }
          actions={
            <div className="flex items-center gap-2">
              {isPartner && engagement.status !== "terminated" && (
                <button
                  type="button"
                  onClick={() => setEditModalOpen(true)}
                  className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  Edit engagement
                </button>
              )}
              <Link
                href="/accounting/firm"
                className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Back to Firm
              </Link>
            </div>
          }
        />

        {/* Section 1 — Engagement Overview Card */}
        <section className="mb-8 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Engagement Overview</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Client name</div>
              <div className="font-medium text-gray-900 dark:text-white">{engagement.business_name ?? "—"}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Engagement status</div>
              <EngagementStatusBadge status={engagement.status} />
            </div>
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Access level</div>
              <AccessLevelBadge level={engagement.access_level} />
            </div>
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Effective from / to</div>
              <div className="text-gray-900 dark:text-white">
                {formatDate(engagement.effective_from)} — {formatDate(engagement.effective_to ?? undefined) || "Ongoing"}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Accepted at / by</div>
              <div className="text-gray-900 dark:text-white">
                {formatDateTime(engagement.accepted_at)} {engagement.accepted_by ? `(${engagement.accepted_by.slice(0, 8)}…)` : ""}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Created by</div>
              <div className="text-gray-900 dark:text-white">
                {engagement.created_by ? `${engagement.created_by.slice(0, 8)}…` : "—"}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Your firm role</div>
              <div className="text-gray-900 dark:text-white capitalize">{viewerFirmRole ?? "—"}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Current engagement state</div>
              <div className="text-gray-900 dark:text-white">
                {evaluated
                  ? `${REASON_CODE_LABELS[evaluated.reason_code] ?? evaluated.reason_code} (${evaluated.state})`
                  : "—"}
              </div>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-3">Lifecycle</div>
            <EngagementStatusTimeline currentStatus={engagement.status} />
          </div>
        </section>

        {/* Section 2 — Status Actions (Partner only: Upgrade access, Suspend, Resume, Terminate, Extend) */}
        <section className="mb-8 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Status Actions</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Only partners can change status. Accept is performed by the client from their account.
          </p>
          <div className="flex flex-wrap gap-3">
            {currentStatus === "pending" && (
              <>
                <button
                  disabled
                  title="Only the client can accept this engagement from their account"
                  className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed text-sm"
                >
                  Accept (client only)
                </button>
                {allowedNext.includes("terminated") && (
                  <button
                    disabled={!canTerminate}
                    title={!isPartner ? "Partners only" : !terminateAuthority.allowed ? terminateAuthority.reason : undefined}
                    onClick={() => setTerminateModalOpen(true)}
                    className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    Terminate
                  </button>
                )}
              </>
            )}
            {currentStatus === "accepted" &&
              ["active", "suspended", "terminated"].map((next) => {
                const allowed = canChangeStatus && allowedNext.includes(next)
                return (
                  <button
                    key={next}
                    disabled={!allowed || !!actionLoading}
                    onClick={() => handleStatusTransition(next)}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm capitalize"
                  >
                    {actionLoading === next ? "…" : next === "active" ? "Resume / Activate" : next === "suspended" ? "Suspend" : "Terminate"}
                  </button>
                )
              })}
            {currentStatus === "active" &&
              ["suspended", "terminated"].map((next) => (
                <button
                  key={next}
                  disabled={!canChangeStatus || !!actionLoading}
                  onClick={() => handleStatusTransition(next)}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm capitalize"
                >
                  {actionLoading === next ? "…" : next === "suspended" ? "Suspend" : "Terminate"}
                </button>
              ))}
            {currentStatus === "suspended" &&
              ["active", "terminated"].map((next) => (
                <button
                  key={next}
                  disabled={!canChangeStatus || !!actionLoading}
                  onClick={() => handleStatusTransition(next)}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm capitalize"
                >
                  {actionLoading === next ? "…" : next === "active" ? "Resume / Activate" : "Terminate"}
                </button>
              ))}
            {currentStatus === "terminated" && (
              <span className="text-sm text-gray-500 dark:text-gray-400">Read only — no status actions.</span>
            )}
          </div>
          {!isPartner && currentStatus !== "terminated" && (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">Only Partners can change engagement status.</p>
          )}
        </section>

        {/* Section 3 — Access Level Editor */}
        <section className="mb-8 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Access Level</h2>
          {canUpdateAccess && engagement.status !== "terminated" ? (
            <div className="flex flex-wrap items-center gap-2">
              {(["read", "write", "approve"] as const).map((level) => (
                <button
                  key={level}
                  disabled={!!actionLoading}
                  onClick={() =>
                    engagement.access_level === level ? undefined : handleAccessLevelSave(level)
                  }
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${
                    engagement.access_level === level
                      ? "bg-blue-600 text-white cursor-default"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AccessLevelBadge level={engagement.access_level} />
              {!canUpdateAccess && (
                <span className="text-sm text-gray-500 dark:text-gray-400">Only Partners can change access level.</span>
              )}
            </div>
          )}
        </section>

        {/* Section 4 — Effective Window Editor */}
        <section className="mb-8 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Effective Window</h2>
          {canUpdateAccess && engagement.status !== "terminated" ? (
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Effective from</label>
                <input
                  type="date"
                  value={effectiveFromEdit}
                  onChange={(e) => setEffectiveFromEdit(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Effective to (optional)</label>
                <input
                  type="date"
                  value={effectiveToEdit}
                  onChange={(e) => setEffectiveToEdit(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <button
                disabled={effectiveWindowSaving}
                onClick={handleEffectiveWindowSave}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {effectiveWindowSaving ? "Saving…" : "Save"}
              </button>
            </div>
          ) : (
            <div className="text-gray-900 dark:text-white">
              {formatDate(engagement.effective_from)} — {formatDate(engagement.effective_to ?? undefined) || "Ongoing"}
            </div>
          )}
          {effectiveWindowError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{effectiveWindowError}</p>
          )}
        </section>

        {/* Section 5 — Engagement Activity Panel (firm activity log for this engagement) */}
        <section className="mb-8 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Engagement Activity</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {activityLogs.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-sm">No activity for this engagement.</p>
            ) : (
              activityLogs.map((log) => (
                <div
                  key={log.id}
                  className={`border-l-4 pl-4 py-2 ${
                    log.action_type === "BLOCKED_ACTION_ATTEMPT"
                      ? "border-amber-500 bg-amber-50/50 dark:bg-amber-900/10"
                      : "border-blue-500"
                  }`}
                >
                  <div className="font-medium text-gray-900 dark:text-white text-sm">
                    {log.action_type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {formatDateTime(log.created_at)}
                    {log.metadata && typeof log.metadata === "object" && Object.keys(log.metadata).length > 0 && (
                      <pre className="mt-1 text-xs text-gray-600 dark:text-gray-500 whitespace-pre-wrap">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Section 6 — Danger Zone (termination safety: confirmation modal + reason + irreversible warning) */}
        <section className="mb-8 rounded-xl border-2 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 p-6">
          <h2 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">Danger Zone</h2>
          <p className="text-sm text-red-700 dark:text-red-300 mb-4">
            Terminating this engagement is <strong>irreversible</strong>. The client will no longer have access from the firm. You must confirm by typing the client name in the modal.
          </p>
          <button
            disabled={!canTerminate || engagement.status === "terminated" || !!actionLoading}
            onClick={() => setTerminateModalOpen(true)}
            className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            Terminate Engagement
          </button>
          {!canTerminate && engagement.status !== "terminated" && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              {!isPartner ? "Only Partners can terminate." : terminateAuthority.reason}
            </p>
          )}
        </section>
      </div>

      <TerminateEngagementModal
        open={terminateModalOpen}
        onClose={() => setTerminateModalOpen(false)}
        clientName={engagement.business_name ?? "this client"}
        onConfirm={handleTerminate}
        loading={actionLoading === "terminate"}
      />

      <EditEngagementModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        currentAccessLevel={engagement.access_level as "read" | "write" | "approve"}
        currentEffectiveFrom={engagement.effective_from || ""}
        currentEffectiveTo={engagement.effective_to ?? null}
        onSave={handleEditSave}
        loading={editSaving}
      />
    </ProtectedLayout>
  )
}
