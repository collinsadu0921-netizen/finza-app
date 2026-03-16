"use client"

/**
 * Engagement Control Panel — displays engagement data and status actions for the Control Tower client view.
 * Renders only for accountants; uses GET /api/accounting/debug/context and PATCH .../engagements/{id}/status.
 */

import { useState, useEffect, useCallback } from "react"
import { AccessLevelBadge } from "@/components/EngagementStatusBadge"
import Modal from "@/components/ui/Modal"
import EngagementTimeline from "./EngagementTimeline"

type DebugContextResponse = {
  authoritySource: string | null
  engagement: {
    id: string
    accounting_firm_id: string
    client_business_id: string
    status: string
    access_level: string
    effective_from: string
    effective_to: string | null
    accepted_at?: string | null
    accepted_by?: string | null
  } | null
  engagement_state: string | null
  business_id: string
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className: "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200",
  },
  active: {
    label: "Active",
    className: "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200",
  },
  suspended: {
    label: "Suspended",
    className: "bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-200",
  },
  terminated: {
    label: "Terminated",
    className: "bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200",
  },
  not_effective: {
    label: "Not effective",
    className: "bg-amber-100 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200",
  },
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export interface EngagementControlPanelProps {
  businessId: string
  clientName?: string | null
}

type StatusAction = "accepted" | "active" | "suspended" | "terminated"

const ACTION_LABELS: Record<StatusAction, string> = {
  accepted: "Accept",
  active: "Reactivate",
  suspended: "Suspend",
  terminated: "Terminate",
}

export default function EngagementControlPanel({
  businessId,
  clientName,
}: EngagementControlPanelProps) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DebugContextResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [patchLoading, setPatchLoading] = useState(false)
  const [confirmAction, setConfirmAction] = useState<StatusAction | null>(null)
  const [patchError, setPatchError] = useState<string | null>(null)
  const [selectedAccessLevel, setSelectedAccessLevel] = useState<string>("")
  const [accessSubmitLoading, setAccessSubmitLoading] = useState(false)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [accessSuccess, setAccessSuccess] = useState(false)

  const fetchContext = useCallback(async () => {
    const res = await fetch(
      `/api/accounting/debug/context?business_id=${encodeURIComponent(businessId)}`
    )
    if (!res.ok) return null
    const json = await res.json()
    setData(json)
    setError(null)
    return json
  }, [businessId])

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(
          `/api/accounting/debug/context?business_id=${encodeURIComponent(businessId)}`
        )
        if (!res.ok) {
          if (!cancelled) setError("Failed to load engagement context")
          return
        }
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [businessId])

  const handleConfirmStatusChange = useCallback(async () => {
    if (!confirmAction || !data?.engagement?.id) return
    setPatchLoading(true)
    setPatchError(null)
    try {
      const res = await fetch(
        `/api/accounting/firm/engagements/${data.engagement.id}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: confirmAction }),
        }
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPatchError(body.error_code ?? body.error ?? `HTTP ${res.status}`)
        return
      }
      setConfirmAction(null)
      await fetchContext()
    } finally {
      setPatchLoading(false)
    }
  }, [confirmAction, data?.engagement?.id, fetchContext])

  const handleAccessLevelSubmit = useCallback(async () => {
    const eng = data?.engagement
    if (!eng || !selectedAccessLevel || selectedAccessLevel === eng.access_level) return
    setAccessSubmitLoading(true)
    setAccessError(null)
    setAccessSuccess(false)
    try {
      const res = await fetch("/api/accounting/firm/engagements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firm_id: eng.accounting_firm_id,
          business_id: eng.client_business_id,
          access_level: selectedAccessLevel,
          effective_from: eng.effective_from,
          effective_to: eng.effective_to ?? null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 409 && body.error_code === "DUPLICATE_ENGAGEMENT") {
          setAccessError("Access level upgrade requires terminating existing engagement first.")
        } else {
          setAccessError(body.error_code ?? body.error ?? `Request failed (${res.status})`)
        }
        return
      }
      setAccessSuccess(true)
      setSelectedAccessLevel("")
      await fetchContext()
      setTimeout(() => setAccessSuccess(false), 4000)
    } finally {
      setAccessSubmitLoading(false)
    }
  }, [data?.engagement, selectedAccessLevel, fetchContext])

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Engagement</h3>
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          Loading…
        </div>
      </div>
    )
  }

  if (error || !data) {
    return null
  }

  if (data.authoritySource !== "accountant") {
    return null
  }

  const engagement = data.engagement
  const stateKey = (data.engagement_state ?? "").toLowerCase()
  const statusBadgeConfig =
    STATUS_BADGE[stateKey] ??
    (engagement?.status ? STATUS_BADGE[engagement.status.toLowerCase()] : null) ?? {
      label: data.engagement_state ?? engagement?.status ?? "—",
      className: "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200",
    }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Engagement</h3>

      {!engagement ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Firm does not currently have engagement with this client
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          {clientName != null && clientName !== "" && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Client name</span>
              <p className="font-medium text-gray-900 dark:text-gray-100 mt-0.5">{clientName}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-500 dark:text-gray-400">Status</span>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeConfig.className}`}
            >
              {statusBadgeConfig.label}
            </span>
          </div>
          {engagement.access_level && ["read", "write", "approve"].includes(engagement.access_level) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400">Access level</span>
              <AccessLevelBadge level={engagement.access_level as "read" | "write" | "approve"} />
            </div>
          )}

          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">
              Access level change
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Current: <strong className="text-gray-900 dark:text-gray-100">{engagement.access_level ?? "—"}</strong>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedAccessLevel || engagement.access_level || ""}
                onChange={(e) => setSelectedAccessLevel(e.target.value)}
                disabled={accessSubmitLoading}
                className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm px-3 py-1.5 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
              >
                {(["read", "write", "approve"] as const).map((level) => (
                  <option
                    key={level}
                    value={level}
                    disabled={level === engagement.access_level}
                  >
                    {level === engagement.access_level ? `${level} (current)` : level}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={
                  accessSubmitLoading ||
                  !selectedAccessLevel ||
                  selectedAccessLevel === engagement.access_level
                }
                onClick={handleAccessLevelSubmit}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {accessSubmitLoading ? "Submitting…" : "Submit"}
              </button>
            </div>
            {accessError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                {accessError}
              </p>
            )}
            {accessSuccess && (
              <p className="mt-2 text-sm text-green-600 dark:text-green-400">
                Access level updated successfully.
              </p>
            )}
          </div>

          <div>
            <span className="text-gray-500 dark:text-gray-400">Effective window</span>
            <p className="text-gray-900 dark:text-gray-100 mt-0.5">
              {formatDate(engagement.effective_from)}
              {engagement.effective_to
                ? ` – ${formatDate(engagement.effective_to)}`
                : " – ongoing"}
            </p>
          </div>

          <EngagementTimeline
            engagement={{
              status: engagement.status,
              effective_from: engagement.effective_from,
              effective_to: engagement.effective_to ?? null,
              accepted_at: engagement.accepted_at ?? null,
            }}
          />

          {(engagement.accepted_at != null || engagement.accepted_by != null) && (
            <>
              {engagement.accepted_at != null && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Accepted date</span>
                  <p className="text-gray-900 dark:text-gray-100 mt-0.5">
                    {formatDate(engagement.accepted_at)}
                  </p>
                </div>
              )}
              {engagement.accepted_by != null && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Accepted by</span>
                  <p className="text-gray-900 dark:text-gray-100 mt-0.5 font-mono text-xs">
                    {engagement.accepted_by}
                  </p>
                </div>
              )}
            </>
          )}

          {patchError && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-800 dark:text-red-200">
              Error: {patchError}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            {engagement.status === "pending" && (
              <button
                type="button"
                disabled={patchLoading}
                onClick={() => setConfirmAction("accepted")}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Accept
              </button>
            )}
            {engagement.status === "active" && (
              <button
                type="button"
                disabled={patchLoading}
                onClick={() => setConfirmAction("suspended")}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Suspend
              </button>
            )}
            {engagement.status === "suspended" && (
              <button
                type="button"
                disabled={patchLoading}
                onClick={() => setConfirmAction("active")}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reactivate
              </button>
            )}
            {engagement.status !== "terminated" && (
              <button
                type="button"
                disabled={patchLoading}
                onClick={() => setConfirmAction("terminated")}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Terminate
              </button>
            )}
          </div>
        </div>
      )}

      <Modal
        isOpen={confirmAction !== null}
        onClose={() => {
          if (!patchLoading) {
            setConfirmAction(null)
            setPatchError(null)
          }
        }}
        title={confirmAction ? ACTION_LABELS[confirmAction] + " engagement?" : ""}
        size="sm"
        footer={
          <>
            <button
              type="button"
              disabled={patchLoading}
              onClick={() => {
                setConfirmAction(null)
                setPatchError(null)
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={patchLoading}
              onClick={handleConfirmStatusChange}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {patchLoading ? "Updating…" : "Confirm"}
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {confirmAction === "terminated"
            ? "This will terminate the engagement. The client will no longer have access until a new engagement is created."
            : confirmAction
              ? `Change engagement status to "${confirmAction}"?`
              : ""}
        </p>
      </Modal>
    </div>
  )
}
