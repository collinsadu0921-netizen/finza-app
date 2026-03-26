"use client"

/**
 * Accountant workspace dashboard.
 *
 * Data sources — 4 parallel calls, no per-client N+1:
 *   /api/accounting/control-tower/work-items  → work item counts + clients needing attention
 *   /api/accounting/firm/clients              → client roster (total count, name map)
 *   /api/accounting/requests                  → all firm requests in one call (firm-wide listing)
 *   /api/accounting/firm/activity?limit=10    → recent firm activity
 */

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import type { ControlTowerWorkItem, WorkItemSeverity } from "@/lib/accounting/controlTower/types"
import { scoreClient, getRiskLabel } from "@/lib/accounting/controlTower/riskScore"

// ---------- types -----------------------------------------------------------

type Client = {
  id: string
  business_id: string
  business_name: string
  engagement_status?: string
}

type ClientRequest = {
  id: string
  client_business_id: string
  title: string
  status: "open" | "in_progress" | "completed" | "cancelled"
  due_at: string | null
  created_at: string
}

type ActivityLog = {
  id: string
  action_type: string
  entity_type: string
  created_at: string
  metadata: Record<string, unknown>
}

type ClientRow = {
  business_id: string
  client_name: string
  risk_score: number
  item_count: number
  top_severity: WorkItemSeverity | null
}

// ---------- helpers ---------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = {
  blocker: 0,
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
}

function topSeverity(items: ControlTowerWorkItem[]): WorkItemSeverity | null {
  if (!items.length) return null
  return items.reduce((best, w) =>
    (SEVERITY_ORDER[w.severity] ?? 99) < (SEVERITY_ORDER[best.severity] ?? 99) ? w : best
  ).severity
}

function buildClientRows(workItems: ControlTowerWorkItem[]): ClientRow[] {
  const map = new Map<string, ControlTowerWorkItem[]>()
  for (const w of workItems) {
    const arr = map.get(w.business_id) ?? []
    arr.push(w)
    map.set(w.business_id, arr)
  }
  return Array.from(map.entries())
    .map(([business_id, items]) => ({
      business_id,
      client_name: items[0].client_name,
      risk_score: scoreClient(items),
      item_count: items.length,
      top_severity: topSeverity(items),
    }))
    .sort((a, b) => b.risk_score - a.risk_score)
    .slice(0, 8)
}

function isOverdue(r: ClientRequest): boolean {
  if (!r.due_at) return false
  return new Date(r.due_at) < new Date()
}

function fmtAction(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ---------- ui atoms --------------------------------------------------------

const SEVERITY_CHIP: Record<string, string> = {
  blocker: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  low: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
}

function SeverityChip({ severity }: { severity: WorkItemSeverity }) {
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${SEVERITY_CHIP[severity] ?? SEVERITY_CHIP.low}`}>
      {severity}
    </span>
  )
}

function StatCard({
  label,
  value,
  accent = "neutral",
  href,
}: {
  label: string
  value: number | string
  accent?: "blue" | "amber" | "red" | "green" | "neutral"
  href?: string
}) {
  const val = (
    <div className={`text-3xl font-bold ${
      accent === "red" ? "text-red-600 dark:text-red-400" :
      accent === "amber" ? "text-amber-600 dark:text-amber-400" :
      accent === "green" ? "text-green-600 dark:text-green-400" :
      accent === "blue" ? "text-blue-600 dark:text-blue-400" :
      "text-gray-900 dark:text-white"
    }`}>
      {value}
    </div>
  )
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      {href ? <Link href={href} className="hover:underline">{val}</Link> : val}
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">{label}</div>
    </div>
  )
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">{text}</div>
  )
}

// ---------- main page -------------------------------------------------------

export default function AccountantDashboardPage() {
  const [workItems, setWorkItems] = useState<ControlTowerWorkItem[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [requests, setRequests] = useState<ClientRequest[]>([])
  const [activity, setActivity] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError("")
      try {
        // Single parallel load — 4 calls total regardless of client count.
        // /api/accounting/requests with no business_id returns all firm requests (see route.ts).
        const [wiRes, clRes, actRes, reqRes] = await Promise.all([
          fetch("/api/accounting/control-tower/work-items?limit=200"),
          fetch("/api/accounting/firm/clients"),
          fetch("/api/accounting/firm/activity?limit=10"),
          fetch("/api/accounting/requests"),
        ])

        if (cancelled) return

        const wiData = wiRes.ok ? await wiRes.json() : { work_items: [] }
        const clData = clRes.ok ? await clRes.json() : { clients: [] }
        const actData = actRes.ok ? await actRes.json() : { logs: [] }
        const reqData = reqRes.ok ? await reqRes.json() : { requests: [] }

        if (cancelled) return

        setWorkItems(wiData.work_items ?? [])
        setClients(clData.clients ?? [])
        setActivity(actData.logs ?? [])
        setRequests(reqData.requests ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load dashboard")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const clientRows = useMemo(() => buildClientRows(workItems), [workItems])

  const openRequests = useMemo(
    () => requests.filter((r) => r.status === "open" || r.status === "in_progress"),
    [requests]
  )
  const overdueRequests = useMemo(
    () => openRequests.filter(isOverdue),
    [openRequests]
  )

  const workItemsBySeverity = useMemo(() => {
    const counts: Record<WorkItemSeverity, number> = {
      blocker: 0, critical: 0, high: 0, medium: 0, low: 0,
    }
    for (const w of workItems) counts[w.severity] = (counts[w.severity] ?? 0) + 1
    return counts
  }, [workItems])

  const clientsWithItems = new Set(workItems.map((w) => w.business_id)).size

  // Build a map of business_id → client name for requests display
  const clientNameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of clients) m.set(c.business_id, c.business_name)
    // Also fill from work items in case a client has no requests
    for (const w of workItems) if (!m.has(w.business_id)) m.set(w.business_id, w.client_name)
    return m
  }, [clients, workItems])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="h-8 w-8 rounded-full border-b-2 border-blue-600 animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Firm-wide overview across all clients.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/accounting/control-tower"
            className="inline-flex px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Control Tower →
          </Link>
          <Link
            href="/accounting/clients"
            className="inline-flex px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            Clients →
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard
          label="Clients engaged"
          value={clients.length}
          accent="blue"
          href="/accounting/clients"
        />
        <StatCard
          label="Clients needing action"
          value={clientsWithItems}
          accent={clientsWithItems > 0 ? "amber" : "neutral"}
          href="/accounting/control-tower"
        />
        <StatCard
          label="Total work items"
          value={workItems.length}
          accent={workItems.length > 0 ? "amber" : "neutral"}
          href="/accounting/control-tower"
        />
        <StatCard
          label="Open requests"
          value={openRequests.length}
          accent="blue"
        />
        <StatCard
          label="Overdue requests"
          value={overdueRequests.length}
          accent={overdueRequests.length > 0 ? "red" : "neutral"}
        />
        <StatCard
          label="Blockers / critical"
          value={(workItemsBySeverity.blocker ?? 0) + (workItemsBySeverity.critical ?? 0)}
          accent={
            (workItemsBySeverity.blocker ?? 0) + (workItemsBySeverity.critical ?? 0) > 0 ? "red" : "neutral"
          }
          href="/accounting/control-tower"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Clients needing attention */}
        <Panel
          title="Clients needing attention"
          action={
            <Link href="/accounting/control-tower" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              Full view →
            </Link>
          }
        >
          {clientRows.length === 0 ? (
            <EmptyRow text="No work items — all clients clear." />
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {clientRows.map((r) => (
                <li key={r.business_id}>
                  <Link
                    href={`/accounting/clients/${r.business_id}/overview`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{r.client_name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {r.item_count} item{r.item_count !== 1 ? "s" : ""}
                        {" · "}
                        {getRiskLabel(r.risk_score)} risk
                      </p>
                    </div>
                    {r.top_severity && <SeverityChip severity={r.top_severity} />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Work items by severity */}
        <Panel
          title="Work items by severity"
          action={
            <Link href="/accounting/control-tower" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              Open work queue →
            </Link>
          }
        >
          {workItems.length === 0 ? (
            <EmptyRow text="No open work items." />
          ) : (
            <div className="p-4 space-y-3">
              {(["blocker", "critical", "high", "medium", "low"] as WorkItemSeverity[]).map((s) => {
                const count = workItemsBySeverity[s] ?? 0
                const max = Math.max(...Object.values(workItemsBySeverity), 1)
                const pct = Math.round((count / max) * 100)
                return (
                  <div key={s} className="flex items-center gap-3">
                    <span className="w-16 text-xs font-medium text-gray-600 dark:text-gray-400 capitalize">{s}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-700">
                      <div
                        className={`h-2 rounded-full ${
                          s === "blocker" || s === "critical"
                            ? "bg-red-500"
                            : s === "high"
                              ? "bg-orange-400"
                              : s === "medium"
                                ? "bg-amber-400"
                                : "bg-gray-300 dark:bg-gray-600"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-6 text-right text-sm font-semibold text-gray-900 dark:text-white">{count}</span>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>

        {/* Open requests */}
        <Panel
          title="Open requests"
          action={
            <Link
              href="/accounting/clients"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              View all →
            </Link>
          }
        >
          {openRequests.length === 0 ? (
            <EmptyRow text="No open requests." />
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {openRequests.slice(0, 8).map((r) => {
                const overdue = isOverdue(r)
                return (
                  <li key={r.id}>
                    <Link
                      href={`/accounting/clients/${r.client_business_id}/requests`}
                      className="flex items-start justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 gap-3 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {r.title}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {clientNameMap.get(r.client_business_id) ?? "Unknown client"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span
                          className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                            r.status === "in_progress"
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
                              : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                          }`}
                        >
                          {r.status.replace(/_/g, " ")}
                        </span>
                        {r.due_at && (
                          <span
                            className={`text-xs ${
                              overdue
                                ? "text-red-600 dark:text-red-400 font-semibold"
                                : "text-gray-400 dark:text-gray-500"
                            }`}
                          >
                            {overdue ? "overdue " : "due "}
                            {r.due_at.slice(0, 10)}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                )
              })}
              {openRequests.length > 8 && (
                <li className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
                  +{openRequests.length - 8} more open requests
                </li>
              )}
            </ul>
          )}
        </Panel>

        {/* Recent firm activity */}
        <Panel
          title="Recent activity"
          action={
            <Link
              href="/accounting/firm?tab=activity"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Full log →
            </Link>
          }
        >
          {activity.length === 0 ? (
            <EmptyRow text="No recent activity." />
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {activity.map((log) => (
                <li key={log.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {fmtAction(log.action_type)}
                    </p>
                    {log.metadata && typeof log.metadata.title === "string" && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                        {log.metadata.title}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">
                    {fmtRelative(log.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
