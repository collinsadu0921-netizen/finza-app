"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import type { ControlTowerWorkItem } from "@/lib/controlTower/types"

const SEVERITY_COLORS: Record<string, string> = {
  blocker: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  low: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
}

export interface WorkQueueProps {
  /** When set, show only work items for this client (client-side filter). */
  businessId?: string | null
  /** Max items to show (flat list) or per-client when grouped. Default 50. */
  limit?: number
  /** When true (default when no businessId), group by client with counts + top items and "Open Client Command Center". */
  groupByClient?: boolean
  /** Optional title above the list. */
  title?: string
  /** Optional class for the container. */
  className?: string
  /** Max height for scroll area (e.g. "400px"). */
  maxHeight?: string
  /** When provided, use these items instead of fetching (avoids duplicate fetch when parent already has data). */
  items?: ControlTowerWorkItem[] | null
  /** When true, show skeleton (e.g. when parent is fetching and will pass items). */
  loading?: boolean
}

function WorkQueueSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-14 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
      ))}
    </div>
  )
}

export function WorkQueue({
  businessId = null,
  limit = 50,
  groupByClient,
  title,
  className = "",
  maxHeight = "400px",
  items: externalItems = null,
  loading: externalLoading = false,
}: WorkQueueProps) {
  const effectiveGroupBy = groupByClient ?? !businessId
  const [internalItems, setInternalItems] = useState<ControlTowerWorkItem[]>([])
  const [internalLoading, setInternalLoading] = useState(true)
  const useExternal = externalItems != null
  const items = useExternal ? externalItems : internalItems
  const loading = useExternal ? externalLoading : internalLoading

  useEffect(() => {
    if (useExternal) {
      setInternalLoading(false)
      return
    }
    setInternalLoading(true)
    fetch("/api/accounting/control-tower/work-items?limit=100")
      .then((r) => r.json())
      .then((data) => {
        setInternalItems(Array.isArray(data.work_items) ? data.work_items : [])
      })
      .catch(() => setInternalItems([]))
      .finally(() => setInternalLoading(false))
  }, [useExternal])

  const filtered = useMemo(() => {
    if (!businessId) return items
    return items.filter((wi) => wi.business_id === businessId)
  }, [items, businessId])

  const sliced = useMemo(() => {
    return filtered.slice(0, limit)
  }, [filtered, limit])

  const byClient = useMemo(() => {
    if (!effectiveGroupBy) return null
    const map = new Map<string, { client_name: string; items: ControlTowerWorkItem[] }>()
    for (const wi of filtered) {
      const existing = map.get(wi.business_id)
      if (!existing) {
        map.set(wi.business_id, { client_name: wi.client_name, items: [wi] })
      } else {
        existing.items.push(wi)
      }
    }
    return Array.from(map.entries()).map(([bid, { client_name, items: list }]) => ({
      business_id: bid,
      client_name,
      items: list.slice(0, limit),
      total: list.length,
    }))
  }, [filtered, effectiveGroupBy, limit])

  if (loading) {
    return (
      <div className={className}>
        {title && (
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</h2>
        )}
        <WorkQueueSkeleton />
      </div>
    )
  }

  const emptyMessage = businessId
    ? "No work items for this client."
    : "No work items. Check Control Tower for client overview."

  if (effectiveGroupBy && byClient?.length) {
    return (
      <div className={className}>
        {title && (
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</h2>
        )}
        <div className="space-y-4" style={{ maxHeight, overflowY: "auto" }}>
          {byClient.map(({ business_id, client_name, items: clientItems, total }) => (
            <div
              key={business_id}
              className="rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden"
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {client_name}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                  {total} item{total !== 1 ? "s" : ""}
                </span>
                <Link
                  href={`/accounting/control-tower/${business_id}`}
                  className="shrink-0 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Open Client Command Center
                </Link>
              </div>
              <ul className="divide-y divide-gray-200 dark:divide-gray-600">
                {clientItems.map((wi) => (
                  <li key={wi.id}>
                    <Link
                      href={wi.drill_route}
                      className="flex items-start gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-left"
                    >
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                          SEVERITY_COLORS[wi.severity] ?? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                        }`}
                      >
                        {wi.severity}
                      </span>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase truncate">
                        {wi.work_item_type.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {wi.action_required}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (effectiveGroupBy && (!byClient || byClient.length === 0)) {
    return (
      <div className={className}>
        {title && (
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</h2>
        )}
        <p className="text-sm text-gray-500 dark:text-gray-400">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {title && (
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</h2>
      )}
      {sliced.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{emptyMessage}</p>
      ) : (
        <ul className="space-y-2" style={{ maxHeight, overflowY: "auto" }}>
          {sliced.map((wi) => (
            <li key={wi.id}>
              <Link
                href={wi.drill_route}
                className="block rounded-lg border border-gray-200 dark:border-gray-600 p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-left"
              >
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium mr-2 ${
                    SEVERITY_COLORS[wi.severity] ?? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                  }`}
                >
                  {wi.severity}
                </span>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  {wi.work_item_type.replace(/_/g, " ")}
                </span>
                {!businessId && (
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate mt-0.5">
                    {wi.client_name}
                  </p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {wi.action_required}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
