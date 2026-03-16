"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import type { ControlTowerClientSummary } from "@/lib/controlTower/types"
import type { Engagement } from "@/lib/firmEngagements"
import { evaluateEngagementState } from "@/lib/accounting/evaluateEngagementState"
import EngagementLifecyclePanel from "@/components/accounting/EngagementLifecyclePanel"
import RiskBadge from "./RiskBadge"

export interface ClientActionPanelProps {
  businessId: string | null
  clientName: string
  riskScore: number
  workItemCount: number
  engagementStatus?: string
  accountingReady?: boolean
}

export default function ClientActionPanel({
  businessId,
  clientName,
  riskScore,
  workItemCount,
  engagementStatus: engagementStatusProp,
  accountingReady: accountingReadyProp,
}: ClientActionPanelProps) {
  const [summary, setSummary] = useState<ControlTowerClientSummary | null>(null)
  const [engagement, setEngagement] = useState<Engagement | null>(null)
  const [firmRole, setFirmRole] = useState<string | null>(null)
  const [activityLogs, setActivityLogs] = useState<{ id: string; action_type: string; created_at: string; metadata?: Record<string, unknown> }[]>([])
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!businessId) {
      setSummary(null)
      setEngagement(null)
      setFirmRole(null)
      setActivityLogs([])
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const summaryRes = await fetch(
          `/api/accounting/control-tower/client-summary?business_id=${encodeURIComponent(businessId)}`
        )
        if (!summaryRes.ok || cancelled) return
        const summaryData = await summaryRes.json()
        if (cancelled) return
        if (!cancelled) setSummary(summaryData)

        const firmsRes = await fetch("/api/accounting/firm/firms")
        if (!firmsRes.ok || cancelled) return
        const firmsData = await firmsRes.json()
        const firms = firmsData.firms ?? []
        for (const firm of firms) {
          if (cancelled) return
          const engRes = await fetch(
            `/api/accounting/firm/engagements?firm_id=${encodeURIComponent(firm.firm_id)}`
          )
          if (!engRes.ok || cancelled) continue
          const engData = await engRes.json()
          const list = engData.engagements ?? []
          const found = list.find((e: Engagement) => e.client_business_id === businessId)
          if (found) {
            if (!cancelled) {
              setEngagement(found)
              setFirmRole(firm.role ?? null)
            }
            if (found.id && !cancelled) {
              const actRes = await fetch(
                `/api/accounting/firm/activity?engagement_id=${encodeURIComponent(found.id)}&limit=50`
              )
              if (actRes.ok && !cancelled) {
                const actData = await actRes.json()
                if (!cancelled) setActivityLogs(actData.logs ?? [])
              }
            }
            break
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId])

  const evaluatorResult =
    engagement && summary?.engagement
      ? evaluateEngagementState({
          engagement: {
            status: engagement.status,
            effective_from: engagement.effective_from ?? summary.engagement.effective_from,
            effective_to: engagement.effective_to ?? summary.engagement.effective_to ?? null,
          },
        })
      : summary?.engagement
        ? evaluateEngagementState({
            engagement: {
              status: summary.engagement.status,
              effective_from: summary.engagement.effective_from,
              effective_to: summary.engagement.effective_to ?? null,
            },
          })
        : null

  const engagementStatus = summary?.engagement?.status ?? engagementStatusProp ?? "—"
  const accountingReady = summary
    ? !(summary.counts.approvals_pending || summary.counts.ob_pending || summary.counts.recon_exceptions)
    : accountingReadyProp

  if (!businessId) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
        Click a client to load preview
      </div>
    )
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 flex items-center justify-center">
        <span className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden flex flex-col h-full">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
            {summary?.client_name ?? clientName}
          </h3>
          <RiskBadge score={riskScore} />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
              engagementStatus === "active"
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200"
                : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
            }`}
          >
            {engagementStatus}
          </span>
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
              accountingReady !== false
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200"
                : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
            }`}
          >
            {accountingReady !== false ? "Ready" : "Not ready"}
          </span>
          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
            {workItemCount} work item{workItemCount !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="mt-3">
          <Link
            href={`/accounting/control-tower/${businessId}`}
            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            Open command center →
          </Link>
        </div>
      </div>
      {summary && (
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Work summary</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Approvals pending: {summary.counts.approvals_pending}</div>
            <div>Approved unposted: {summary.counts.approved_unposted}</div>
            <div>OB pending: {summary.counts.ob_pending}</div>
            <div>OB unposted: {summary.counts.ob_unposted}</div>
            <div>Recon exceptions: {summary.counts.recon_exceptions}</div>
            <div>Period blockers: {summary.counts.period_blockers}</div>
          </div>
        </div>
      )}
      {engagement && evaluatorResult && (
        <div className="p-4 flex-1 overflow-y-auto min-h-0">
          <EngagementLifecyclePanel
            engagement={engagement}
            evaluatorResult={evaluatorResult}
            authoritySource="accountant"
            firmRole={firmRole}
            clientName={summary?.client_name ?? clientName}
            businessName={summary?.client_name ?? clientName}
            activityLogs={activityLogs}
            onUpdated={() => {
              fetch(
                `/api/accounting/control-tower/client-summary?business_id=${encodeURIComponent(businessId!)}`
              )
                .then((r) => r.json())
                .then((s) => {
                  if (mountedRef.current) setSummary(s)
                })
                .catch(() => {})
            }}
          />
        </div>
      )}
    </div>
  )
}
