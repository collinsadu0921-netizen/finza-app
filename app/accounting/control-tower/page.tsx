"use client"

/**
 * Control Tower — Operational Command Center.
 * 3-column: Left = client list + filters, Center = work item stream (grouped), Right = client action panel.
 * Bulk actions, risk scoring, assignment, aging, status tracking.
 */

import { useState, useEffect, useMemo, useCallback } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { EngagementStatusBadge, AccessLevelBadge } from "@/components/EngagementStatusBadge"
import type { ControlTowerWorkItem, WorkItemType, WorkItemSeverity } from "@/lib/accounting/controlTower/types"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { scoreClient } from "@/lib/accounting/controlTower/riskScore"
import BulkActionBar from "@/components/controlTower/BulkActionBar"
import AssignmentDropdown from "@/components/controlTower/AssignmentDropdown"
import ClientActionPanel from "@/components/controlTower/ClientActionPanel"
import AgingBadge from "@/components/controlTower/AgingBadge"
import RiskBadge from "@/components/controlTower/RiskBadge"
import WorkItemStatusBadge from "@/components/controlTower/WorkItemStatusBadge"
import { getAssignment } from "@/components/controlTower/AssignmentDropdown"

const TYPE_LABELS: Record<WorkItemType, string> = {
  journal_approval: "Journal approval pending",
  journal_post: "Journal approved, unposted",
  ob_approval: "Opening balance pending approval",
  ob_post: "Opening balance approved, unposted",
  period_blocker: "Period close blocked",
  recon_exception: "Reconciliation exceptions",
  accounting_not_initialized: "Accounting not initialized",
  engagement_pending_acceptance: "Engagement pending acceptance",
  engagement_suspended: "Engagement suspended",
  engagement_terminated: "Engagement terminated",
  engagement_not_effective: "Engagement not effective",
  engagement_missing: "Engagement missing",
}

const SEVERITY_ORDER: Record<string, number> = {
  blocker: 0,
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
}

function severitySortKey(s: WorkItemSeverity): number {
  return SEVERITY_ORDER[s] ?? 99
}

type ClientRow = {
  business_id: string
  client_name: string
  engagement_status: string
  access_level: "read" | "write" | "approve"
  accounting_ready: boolean
  open_blockers_count: number
  last_activity: string | null
  engagement_id: string | null
  risk_score: number
  items: ControlTowerWorkItem[]
}

function deriveSummary(workItems: ControlTowerWorkItem[]) {
  const clientsRequiringAction = new Set(workItems.map((w) => w.business_id)).size
  const engagementBlockers = workItems.filter((w) =>
    w.work_item_type.startsWith("engagement_")
  ).length
  const accountingNotInitialized = workItems.filter(
    (w) => w.work_item_type === "accounting_not_initialized"
  ).length
  const periodsNeedingClosure = workItems.filter(
    (w) => w.work_item_type === "period_blocker"
  ).length
  const reconciliationExceptions = workItems.filter(
    (w) => w.work_item_type === "recon_exception"
  ).length
  const draftJournalsAwaitingApproval = workItems.filter(
    (w) => w.work_item_type === "journal_approval"
  ).length
  return {
    clientsRequiringAction,
    engagementBlockers,
    accountingNotInitialized,
    periodsNeedingClosure,
    reconciliationExceptions,
    draftJournalsAwaitingApproval,
  }
}

function deriveClientRows(workItems: ControlTowerWorkItem[]): ClientRow[] {
  const byClient = new Map<string, ControlTowerWorkItem[]>()
  for (const w of workItems) {
    const arr = byClient.get(w.business_id) ?? []
    arr.push(w)
    byClient.set(w.business_id, arr)
  }
  const rows: ClientRow[] = []
  for (const [business_id, items] of byClient) {
    const first = items[0]!
    const engagementItem = items.find((w) => w.work_item_type.startsWith("engagement_"))
    const engagement_status =
      (engagementItem?.reference_entity?.meta?.status as string) ?? "active"
    const access_level = (first.audit_context?.level as "read" | "write" | "approve") ?? "read"
    const accounting_ready = !items.some(
      (w) => w.work_item_type === "accounting_not_initialized"
    )
    const engagement_id = first.audit_context?.engagementId ?? null
    const risk_score = scoreClient(items)
    rows.push({
      business_id,
      client_name: first.client_name,
      engagement_status,
      access_level,
      accounting_ready,
      open_blockers_count: items.length,
      last_activity: null,
      engagement_id: engagement_id || null,
      risk_score,
      items,
    })
  }
  // Sort: highest risk, then oldest work item (max aging_days), then count desc
  return rows.sort((a, b) => {
    if (b.risk_score !== a.risk_score) return b.risk_score - a.risk_score
    const maxAgingA = Math.max(0, ...a.items.map((i) => i.aging_days))
    const maxAgingB = Math.max(0, ...b.items.map((i) => i.aging_days))
    if (maxAgingB !== maxAgingA) return maxAgingB - maxAgingA
    return b.open_blockers_count - a.open_blockers_count
  })
}

const WORK_ITEM_LIMIT = 100

export default function ControlTowerPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [workItems, setWorkItems] = useState<ControlTowerWorkItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [collapsedClients, setCollapsedClients] = useState<Set<string>>(new Set())
  const [refetchTrigger, setRefetchTrigger] = useState(0)

  // Filters
  const [filterSeverity, setFilterSeverity] = useState<WorkItemSeverity | "">("")
  const [filterType, setFilterType] = useState<WorkItemType | "">("")
  const [filterAging, setFilterAging] = useState<"all" | "green" | "orange" | "red">("all")
  const [filterEngagement, setFilterEngagement] = useState<string>("")
  const [filterReadiness, setFilterReadiness] = useState<"all" | "ready" | "not_ready">("all")
  const [filterAssigned, setFilterAssigned] = useState<string>("")

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        if (!cancelled) {
          setLoading(true)
          setError("")
        }
        const res = await fetch(`/api/accounting/control-tower/work-items?limit=${WORK_ITEM_LIMIT}`)
        if (cancelled) return
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          if (!cancelled) {
            if (res.status === 403) {
              setError(data.reason || "Access denied")
            } else {
              setError(data.error || `Failed to load (${res.status})`)
            }
            setWorkItems([])
          }
          return
        }
        const data = await res.json()
        if (!cancelled) setWorkItems(data.work_items ?? [])
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load work items")
          setWorkItems([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [refetchTrigger])

  const clientRows = useMemo(() => deriveClientRows(workItems), [workItems])

  const clientMap = useMemo(() => {
    const m = new Map<string, ClientRow>()
    for (const r of clientRows) m.set(r.business_id, r)
    return m
  }, [clientRows])

  const filteredWorkItems = useMemo(() => {
    let list = workItems
    if (filterSeverity) {
      list = list.filter((w) => w.severity === filterSeverity)
    }
    if (filterType) {
      list = list.filter((w) => w.work_item_type === filterType)
    }
    if (filterAging !== "all") {
      list = list.filter((w) => {
        const d = w.aging_days
        if (filterAging === "green") return d < 3
        if (filterAging === "orange") return d >= 3 && d <= 7
        return d > 7
      })
    }
    if (filterEngagement) {
      list = list.filter((w) => {
        const row = clientMap.get(w.business_id)
        return row?.engagement_status === filterEngagement
      })
    }
    if (filterReadiness !== "all") {
      list = list.filter((w) => {
        const row = clientMap.get(w.business_id)
        if (!row) return true
        return filterReadiness === "ready" ? row.accounting_ready : !row.accounting_ready
      })
    }
    if (filterAssigned) {
      list = list.filter((w) => {
        const a = getAssignment(w.id)
        if (filterAssigned === "unassigned") return !a
        return a === filterAssigned
      })
    }
    return list
  }, [workItems, filterSeverity, filterType, filterAging, filterEngagement, filterReadiness, filterAssigned, clientMap])

  const groupedByClient = useMemo(() => {
    const byClient = new Map<string, ControlTowerWorkItem[]>()
    for (const w of filteredWorkItems) {
      const arr = byClient.get(w.business_id) ?? []
      arr.push(w)
      byClient.set(w.business_id, arr)
    }
    return Array.from(byClient.entries()).map(([business_id, items]) => {
      const row = clientMap.get(business_id)
      const sorted = [...items].sort(
        (a, b) =>
          severitySortKey(a.severity) - severitySortKey(b.severity) ||
          b.aging_days - a.aging_days
      )
      return {
        business_id,
        client_name: row?.client_name ?? items[0]?.client_name ?? "Unknown",
        risk_score: row?.risk_score ?? scoreClient(items),
        items: sorted,
      }
    })
  }, [filteredWorkItems, clientMap])

  const summary = useMemo(() => deriveSummary(workItems), [workItems])
  const pendingApprovalItems = useMemo(
    () =>
      workItems.filter(
        (w) =>
          w.work_item_type === "journal_approval" || w.work_item_type === "ob_approval"
      ),
    [workItems]
  )
  const firstPendingApprovalRoute =
    pendingApprovalItems.length > 0 ? pendingApprovalItems[0].drill_route : null

  const selectedItems = useMemo(
    () => workItems.filter((w) => selectedIds.has(w.id)),
    [workItems, selectedIds]
  )

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size >= filteredWorkItems.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredWorkItems.map((w) => w.id)))
    }
  }, [filteredWorkItems, selectedIds.size])

  const handleClientClick = useCallback(
    (businessId: string, e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        router.push(`/accounting/control-tower/${businessId}`)
      } else {
        setSelectedClientId(businessId)
      }
    },
    [router]
  )

  const toggleClientCollapse = useCallback((businessId: string) => {
    setCollapsedClients((prev) => {
      const next = new Set(prev)
      if (next.has(businessId)) next.delete(businessId)
      else next.add(businessId)
      return next
    })
  }, [])

  const selectedClientRow = selectedClientId ? clientMap.get(selectedClientId) : null

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4" />
            <p className="text-gray-600 dark:text-gray-400">Loading Control Tower...</p>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Control Tower
          </h1>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            Operations command center — clients, work items, bulk actions. Click client for preview; Ctrl+click to open command center.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        <section className="mb-6 flex flex-wrap gap-3">
          <Link
            href="/accounting/firm/clients/add"
            className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Create engagement
          </Link>
          <Link
            href="/accounting/firm?tab=activity"
            className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            View blocked attempts
          </Link>
          {firstPendingApprovalRoute && (
            <Link
              href={firstPendingApprovalRoute}
              className="inline-flex items-center px-4 py-2 rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm font-medium hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            >
              Review pending approvals
              {pendingApprovalItems.length > 1 && (
                <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-800 text-xs">
                  {pendingApprovalItems.length}
                </span>
              )}
            </Link>
          )}
          {clientRows.length > 0 && (
            <Link
              href={buildAccountingRoute("/accounting", clientRows[0].business_id)}
              className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Open client accounting
            </Link>
          )}
        </section>

        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <SummaryCard label="Clients requiring action" value={summary.clientsRequiringAction} accent="blue" />
          <SummaryCard label="Engagement blockers" value={summary.engagementBlockers} accent="amber" />
          <SummaryCard label="Accounting not initialized" value={summary.accountingNotInitialized} accent="red" />
          <SummaryCard label="Periods needing closure" value={summary.periodsNeedingClosure} accent="orange" />
          <SummaryCard label="Reconciliation exceptions" value={summary.reconciliationExceptions} accent="red" />
          <SummaryCard label="Draft journals awaiting approval" value={summary.draftJournalsAwaitingApproval} accent="amber" />
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT — Client list + filters */}
          <aside className="lg:col-span-3 space-y-4">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
              <h2 className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700">
                Filters
              </h2>
              <div className="p-4 space-y-3">
                <label className="block">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Severity</span>
                  <select
                    value={filterSeverity}
                    onChange={(e) => setFilterSeverity((e.target.value || "") as WorkItemSeverity | "")}
                    className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                  >
                    <option value="">All</option>
                    <option value="blocker">Blocker</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Type</span>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType((e.target.value || "") as WorkItemType | "")}
                    className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                  >
                    <option value="">All</option>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Aging</span>
                  <select
                    value={filterAging}
                    onChange={(e) => setFilterAging(e.target.value as typeof filterAging)}
                    className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                  >
                    <option value="all">All</option>
                    <option value="green">&lt; 3 days</option>
                    <option value="orange">3–7 days</option>
                    <option value="red">7+ days</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Engagement</span>
                  <select
                    value={filterEngagement}
                    onChange={(e) => setFilterEngagement(e.target.value)}
                    className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                  >
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="suspended">Suspended</option>
                    <option value="terminated">Terminated</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Readiness</span>
                  <select
                    value={filterReadiness}
                    onChange={(e) => setFilterReadiness(e.target.value as typeof filterReadiness)}
                    className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                  >
                    <option value="all">All</option>
                    <option value="ready">Ready</option>
                    <option value="not_ready">Not ready</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Assigned</span>
                  <select
                    value={filterAssigned}
                    onChange={(e) => setFilterAssigned(e.target.value)}
                    className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                  >
                    <option value="">All</option>
                    <option value="unassigned">Unassigned</option>
                    <option value="staff-1">Staff 1</option>
                    <option value="staff-2">Staff 2</option>
                    <option value="partner">Partner</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
              <h2 className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700">
                Clients
              </h2>
              <div className="max-h-[400px] overflow-y-auto">
                {clientRows.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">
                    No clients
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                    {clientRows.map((row) => (
                      <li key={row.business_id}>
                        <button
                          type="button"
                          onClick={(e) => handleClientClick(row.business_id, e)}
                          className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                            selectedClientId === row.business_id ? "bg-blue-50 dark:bg-blue-900/20" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-gray-900 dark:text-white truncate">
                              {row.client_name}
                            </span>
                            <RiskBadge score={row.risk_score} />
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <EngagementStatusBadge status={row.engagement_status} />
                            <span
                              className={`text-xs ${row.accounting_ready ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}
                            >
                              {row.accounting_ready ? "Ready" : "Not ready"}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {row.open_blockers_count} items
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>

          {/* CENTER — Work item stream */}
          <main className="lg:col-span-6 space-y-3">
            {workItems.length >= WORK_ITEM_LIMIT && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Showing first {WORK_ITEM_LIMIT} work items.
              </p>
            )}
            <BulkActionBar
              selectedItems={selectedItems}
              onClearSelection={() => setSelectedIds(new Set())}
              onComplete={() => {
                setSelectedIds(new Set())
                setRefetchTrigger((t) => t + 1)
              }}
            />
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
              <h2 className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700">
                Work items
              </h2>
              {groupedByClient.length === 0 ? (
                <div className="px-4 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No work items match filters.
                </div>
              ) : (
                <div className="max-h-[600px] overflow-y-auto">
                  {groupedByClient.map((group) => {
                    const isCollapsed = collapsedClients.has(group.business_id)
                    return (
                      <div
                        key={group.business_id}
                        className="border-b border-gray-200 dark:border-gray-700 last:border-b-0"
                      >
                        <button
                          type="button"
                          onClick={() => toggleClientCollapse(group.business_id)}
                          className="w-full flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-800 text-left"
                        >
                          <span className="text-gray-500 dark:text-gray-400">
                            {isCollapsed ? "▶" : "▼"}
                          </span>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {group.client_name}
                          </span>
                          <RiskBadge score={group.risk_score} />
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {group.items.length} items
                          </span>
                        </button>
                        {!isCollapsed && (
                          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-900">
                              <tr>
                                <th className="px-2 py-1.5 w-8">
                                  <input
                                    type="checkbox"
                                    checked={
                                      group.items.length > 0 &&
                                      group.items.every((w) => selectedIds.has(w.id))
                                    }
                                    onChange={() => {
                                      const allSelected = group.items.every((w) => selectedIds.has(w.id))
                                      setSelectedIds((prev) => {
                                        const next = new Set(prev)
                                        if (allSelected) {
                                          group.items.forEach((w) => next.delete(w.id))
                                        } else {
                                          group.items.forEach((w) => next.add(w.id))
                                        }
                                        return next
                                      })
                                    }}
                                    className="rounded border-gray-300 dark:border-gray-600"
                                  />
                                </th>
                                <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                                  Severity
                                </th>
                                <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                                  Type
                                </th>
                                <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                                  Action
                                </th>
                                <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                                  Aging
                                </th>
                                <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                                  Status
                                </th>
                                <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                                  Assign
                                </th>
                                <th className="px-2 py-1.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                                  Drill
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                              {group.items.map((w) => (
                                <tr key={w.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                  <td className="px-2 py-1.5">
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.has(w.id)}
                                      onChange={() => toggleSelection(w.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="rounded border-gray-300 dark:border-gray-600"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5 whitespace-nowrap">
                                    <SeverityBadge severity={w.severity} />
                                  </td>
                                  <td className="px-2 py-1.5 text-sm text-gray-900 dark:text-white">
                                    {TYPE_LABELS[w.work_item_type]}
                                  </td>
                                  <td className="px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300">
                                    {w.action_required}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <AgingBadge days={w.aging_days} />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <WorkItemStatusBadge workItemId={w.id} />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <AssignmentDropdown workItem={w} />
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    <Link
                                      href={w.drill_route}
                                      className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
                                    >
                                      Open →
                                    </Link>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </main>

          {/* RIGHT — Client action panel */}
          <aside className="lg:col-span-3 min-h-[400px]">
            <ClientActionPanel
              businessId={selectedClientId}
              clientName={selectedClientRow?.client_name ?? ""}
              riskScore={selectedClientRow?.risk_score ?? 0}
              workItemCount={selectedClientRow?.open_blockers_count ?? 0}
              engagementStatus={selectedClientRow?.engagement_status}
              accountingReady={selectedClientRow?.accounting_ready}
            />
          </aside>
        </div>
      </div>
    </ProtectedLayout>
  )
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: "blue" | "amber" | "red" | "orange"
}) {
  const accentClasses = {
    blue: "border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20",
    amber: "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20",
    red: "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/20",
    orange: "border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-900/20",
  }
  const valueClasses = {
    blue: "text-blue-700 dark:text-blue-300",
    amber: "text-amber-700 dark:text-amber-300",
    red: "text-red-700 dark:text-red-300",
    orange: "text-orange-700 dark:text-orange-300",
  }
  return (
    <div className={`min-w-0 rounded-xl border p-4 ${accentClasses[accent]}`}>
      <div
        className={`text-xl font-bold tabular-nums leading-tight [overflow-wrap:anywhere] sm:text-2xl ${valueClasses[accent]}`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs font-medium text-gray-600 dark:text-gray-400">{label}</div>
    </div>
  )
}

function SeverityBadge({ severity }: { severity: WorkItemSeverity }) {
  const classes: Record<WorkItemSeverity, string> = {
    blocker: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
    critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
    high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
    medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
    low: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  }
  const label =
    severity === "medium" ? "Normal" : severity.charAt(0).toUpperCase() + severity.slice(1)
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${classes[severity]}`}>
      {label}
    </span>
  )
}
