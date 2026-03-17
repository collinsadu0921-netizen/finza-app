"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import { EngagementStatusBadge } from "@/components/EngagementStatusBadge"
import type { ControlTowerWorkItem } from "@/lib/controlTower/types"

/** Client shape from GET /api/accounting/firm/clients */
export interface FirmClient {
  business_id: string
  business_name: string
  engagement_status: string
  access_level: string
  effective_from?: string
  effective_to?: string | null
  status?: {
    period_status?: string
    pending_adjustments_count?: number
    exceptions_count?: { critical?: number; warning?: number; info?: number; total?: number }
  }
}

export type ClientsPanelSort = "name" | "engagement_status" | "issues"

export interface ClientsPanelProps {
  /** Optional title above the panel. */
  title?: string
  /** Optional class for the container. */
  className?: string
  /** Max height for the client list scroll area (e.g. "360px"). */
  maxHeight?: string
  /** Optional work items to derive issue count per client for sorting (if not provided, uses API status counts). */
  workItems?: ControlTowerWorkItem[] | null
  /** Initial sort. Default "name". */
  defaultSort?: ClientsPanelSort
}

const ENGAGEMENT_ORDER: Record<string, number> = {
  pending: 0,
  accepted: 1,
  active: 2,
  suspended: 3,
  terminated: 4,
}

function ClientsPanelSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="h-16 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
      ))}
    </div>
  )
}

function issueCount(client: FirmClient, workCountByBusiness: Map<string, number>): number {
  const fromWork = workCountByBusiness.get(client.business_id) ?? 0
  const fromStatus =
    (client.status?.pending_adjustments_count ?? 0) +
    (client.status?.exceptions_count?.total ?? 0)
  return fromWork > 0 ? fromWork : fromStatus
}

export function ClientsPanel({
  title = "Clients",
  className = "",
  maxHeight = "360px",
  workItems = null,
  defaultSort = "name",
}: ClientsPanelProps) {
  const [clients, setClients] = useState<FirmClient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<ClientsPanelSort>(defaultSort)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch("/api/accounting/firm/clients")
      .then((r: Response): Promise<{ err?: string; clients?: FirmClient[] }> => {
        if (!r.ok) return r.json().then((d: { error?: string }) => ({ err: d.error || "Failed to load clients" }))
        return r.json().then((d: { clients?: FirmClient[] }) => ({ clients: d.clients ?? [] }))
      })
      .then((result) => {
        if (result.err) {
          setError(result.err)
          setClients([])
        } else {
          setClients(result.clients ?? [])
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load clients")
        setClients([])
      })
      .finally(() => setLoading(false))
  }, [])

  const workCountByBusiness = useMemo(() => {
    if (!workItems || workItems.length === 0) return new Map<string, number>()
    const map = new Map<string, number>()
    for (const wi of workItems) {
      map.set(wi.business_id, (map.get(wi.business_id) ?? 0) + 1)
    }
    return map
  }, [workItems])

  const filteredAndSorted = useMemo(() => {
    let list = clients
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (c) =>
          c.business_name.toLowerCase().includes(q) ||
          c.business_id.toLowerCase().includes(q)
      )
    }
    if (sort === "name") {
      list = [...list].sort((a, b) => a.business_name.localeCompare(b.business_name))
    } else if (sort === "engagement_status") {
      list = [...list].sort((a, b) => {
        const oa = ENGAGEMENT_ORDER[a.engagement_status?.toLowerCase() ?? ""] ?? 99
        const ob = ENGAGEMENT_ORDER[b.engagement_status?.toLowerCase() ?? ""] ?? 99
        if (oa !== ob) return oa - ob
        return a.business_name.localeCompare(b.business_name)
      })
    } else {
      list = [...list].sort((a, b) => {
        const ia = issueCount(a, workCountByBusiness)
        const ib = issueCount(b, workCountByBusiness)
        if (ib !== ia) return ib - ia
        return a.business_name.localeCompare(b.business_name)
      })
    }
    return list
  }, [clients, search, sort, workCountByBusiness])

  if (loading) {
    return (
      <div className={className}>
        {title && (
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</h2>
        )}
        <ClientsPanelSkeleton />
      </div>
    )
  }

  return (
    <div className={className}>
      {title && (
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</h2>
      )}
      <Link
        href="/accounting/control-tower"
        className="inline-block mb-3 px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
      >
        Open Control Tower
      </Link>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
      )}

      <input
        type="search"
        placeholder="Search by client name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full mb-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm px-3 py-2"
        aria-label="Search clients"
      />

      <div className="mb-2 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-gray-400">Sort:</span>
        <button
          type="button"
          onClick={() => setSort("name")}
          className={`text-xs font-medium px-2 py-1 rounded ${sort === "name" ? "bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400 hover:underline"}`}
        >
          Name
        </button>
        <button
          type="button"
          onClick={() => setSort("engagement_status")}
          className={`text-xs font-medium px-2 py-1 rounded ${sort === "engagement_status" ? "bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400 hover:underline"}`}
        >
          Status
        </button>
        <button
          type="button"
          onClick={() => setSort("issues")}
          className={`text-xs font-medium px-2 py-1 rounded ${sort === "issues" ? "bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400 hover:underline"}`}
        >
          Most issues
        </button>
      </div>

      {filteredAndSorted.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {clients.length === 0
            ? "No clients. Add clients from Control Tower or firm setup."
            : "No clients match your search."}
        </p>
      ) : (
        <ul
          className="space-y-2"
          style={{ maxHeight, overflowY: "auto" }}
        >
          {filteredAndSorted.map((client) => {
            const issues = issueCount(client, workCountByBusiness)
            return (
              <li
                key={client.business_id}
                className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/50 overflow-hidden"
              >
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {client.business_name}
                    </span>
                    <EngagementStatusBadge
                      status={
                        client.engagement_status === "accepted"
                          ? "active"
                          : client.engagement_status
                      }
                    />
                  </div>
                  {issues > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                      {issues} work item{issues !== 1 ? "s" : ""}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/accounting/control-tower/${client.business_id}`}
                      className="inline-block px-2 py-1 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Open
                    </Link>
                    <Link
                      href={`/accounting/open?business_id=${encodeURIComponent(client.business_id)}`}
                      className="inline-block px-2 py-1 text-xs font-medium rounded border border-blue-600 dark:border-blue-500 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    >
                      Open Accounting
                    </Link>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
