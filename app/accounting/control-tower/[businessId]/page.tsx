"use client"

/**
 * Client Command Center — summary, engagement lifecycle, accounting health, work items.
 * When engagement state !== ACTIVE, only lifecycle panel is shown (workspace blocked).
 */

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import Link from "next/link"
import type { ControlTowerClientSummary } from "@/lib/controlTower/types"
import type { Engagement } from "@/lib/firmEngagements"
import { evaluateEngagementState } from "@/lib/accounting/evaluateEngagementState"
import OpenAccountingButton from "@/components/accounting/OpenAccountingButton"
import { WorkQueue } from "@/components/accounting/WorkQueue"
import EngagementLifecyclePanel from "@/components/accounting/EngagementLifecyclePanel"

export default function ControlTowerClientPage() {
  const params = useParams()
  const businessId = params.businessId as string
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [summary, setSummary] = useState<ControlTowerClientSummary | null>(null)
  const [engagement, setEngagement] = useState<Engagement | null>(null)
  const [firmRole, setFirmRole] = useState<string | null>(null)
  const [activityLogs, setActivityLogs] = useState<{ id: string; action_type: string; created_at: string; metadata?: Record<string, unknown> }[]>([])

  const loadSummary = useCallback(async () => {
    if (!businessId) return null
    const res = await fetch(
      `/api/accounting/control-tower/client-summary?business_id=${encodeURIComponent(businessId)}`
    )
    if (!res.ok) return null
    return res.json()
  }, [businessId])

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    async function load() {
      try {
        if (!cancelled) {
          setLoading(true)
          setError("")
        }
        const summaryRes = await fetch(
          `/api/accounting/control-tower/client-summary?business_id=${encodeURIComponent(businessId)}`
        )
        const summaryData = summaryRes.ok ? await summaryRes.json() : null
        if (cancelled) return
        if (!summaryRes.ok || !summaryData) {
          const errData = await summaryRes.json().catch(() => ({}))
          if (!cancelled) {
            if (summaryRes.status === 403) setError(errData.reason || "Access denied")
            else if (summaryRes.status === 400) setError("Missing business context")
            else setError(errData.error || "Failed to load")
            setSummary(null)
            setEngagement(null)
            setFirmRole(null)
          }
          return
        }
        setSummary(summaryData)

        const firmsRes = await fetch("/api/accounting/firm/firms")
        if (!firmsRes.ok || cancelled) return
        const firmsData = await firmsRes.json()
        const firms = firmsData.firms ?? []
        const firmIds = firms.map((f: { firm_id: string }) => f.firm_id)

        for (const firmId of firmIds) {
          if (cancelled) return
          const engRes = await fetch(
            `/api/accounting/firm/engagements?firm_id=${encodeURIComponent(firmId)}`
          )
          if (!engRes.ok || cancelled) continue
          const engData = await engRes.json()
          const list = engData.engagements ?? []
          const found = list.find((e: Engagement) => e.client_business_id === businessId)
          if (found) {
            if (!cancelled) {
              setEngagement(found)
              const firm = firms.find((f: { firm_id: string }) => f.firm_id === firmId)
              setFirmRole(firm?.role ?? null)
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
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load")
          setSummary(null)
          setEngagement(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [businessId, loadSummary])

  const evaluatorResult =
    engagement
      ? evaluateEngagementState({
          engagement: {
            status: engagement.status,
            effective_from: engagement.effective_from,
            effective_to: engagement.effective_to ?? null,
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
  const isActive = evaluatorResult?.state === "ACTIVE"

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4" />
            <p className="text-gray-600 dark:text-gray-400">Loading client summary...</p>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  if (error || !summary) {
    return (
      <ProtectedLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200">
            {error || "Client not found"}
          </div>
          <Link
            href="/accounting/control-tower"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Back to Control Tower
          </Link>
        </div>
      </ProtectedLayout>
    )
  }

  const { counts, periods, links } = summary
  const clientName = summary.client_name ?? ""

  if (!isActive) {
    return (
      <ProtectedLayout>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link
            href="/accounting/control-tower"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
          >
            ← Control Tower
          </Link>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
            {clientName}
          </h1>
          <EngagementLifecyclePanel
            engagement={engagement}
            evaluatorResult={evaluatorResult ?? null}
            authoritySource="accountant"
            firmRole={firmRole}
            clientName={clientName}
            businessName={clientName}
            activityLogs={activityLogs}
            onUpdated={() => {
              loadSummary().then((s) => s && setSummary(s))
              if (engagement?.accounting_firm_id) {
                fetch(`/api/accounting/firm/engagements?firm_id=${encodeURIComponent(engagement.accounting_firm_id)}`)
                  .then((r) => r.json())
                  .then((d) => {
                    const found = (d.engagements ?? []).find((e: Engagement) => e.client_business_id === businessId)
                    if (found) setEngagement(found)
                  })
              }
            }}
          />
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <Link
              href="/accounting/control-tower"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block"
            >
              ← Control Tower
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {clientName}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Engagement: {summary.engagement.status} · Access: {summary.engagement.access_level} · Effective {summary.engagement.effective_from}
              {summary.engagement.effective_to ? ` – ${summary.engagement.effective_to}` : " – ongoing"}
            </p>
          </div>
          <OpenAccountingButton businessId={businessId}>
            Open Accounting →
          </OpenAccountingButton>
        </div>

        <div className="space-y-6 mb-8">
          <EngagementLifecyclePanel
            engagement={engagement}
            evaluatorResult={evaluatorResult ?? null}
            authoritySource="accountant"
            firmRole={firmRole}
            clientName={clientName}
            businessName={clientName}
            activityLogs={activityLogs}
            onUpdated={() => {
              loadSummary().then((s) => s && setSummary(s))
              if (engagement?.accounting_firm_id) {
                fetch(`/api/accounting/firm/engagements?firm_id=${encodeURIComponent(engagement.accounting_firm_id)}`)
                  .then((r) => r.json())
                  .then((d) => {
                    const found = (d.engagements ?? []).find((e: Engagement) => e.client_business_id === businessId)
                    if (found) setEngagement(found)
                  })
              }
            }}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Approvals pending</h3>
              <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{counts.approvals_pending}</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Approved, unposted</h3>
              <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{counts.approved_unposted}</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">OB pending</h3>
              <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{counts.ob_pending}</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">OB unposted</h3>
              <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{counts.ob_unposted}</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Recon exceptions</h3>
              <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{counts.recon_exceptions}</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Period blockers</h3>
              <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{counts.period_blockers}</p>
            </div>
          </div>

          {periods.current_period_id && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Periods</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Current period: {periods.current_status ?? "—"} · Last closed: {periods.last_closed_period_id ? "Yes" : "—"}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
            <WorkQueue
              businessId={businessId}
              limit={20}
              groupByClient={false}
              title="Work items"
              maxHeight="360px"
            />
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Drill links</h3>
            <div className="flex flex-wrap gap-3">
              <Link href={links.ledger} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Ledger</Link>
              <Link href={links.journals} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Journals</Link>
              <Link href={links.openingBalances} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Opening balances</Link>
              <Link href={links.reconciliation} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Reconciliation</Link>
              <Link href={links.periods} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Periods</Link>
              <Link href={links.reports} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Reports</Link>
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
