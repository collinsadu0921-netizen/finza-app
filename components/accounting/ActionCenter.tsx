"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import type { ControlTowerWorkItem, WorkItemType } from "@/lib/controlTower/types"

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

export interface ActionCenterProps {
  businessId?: string | null
  /** When provided, use these items instead of fetching (e.g. from page). */
  items?: ControlTowerWorkItem[] | null
}

export default function ActionCenter({ businessId, items: externalItems }: ActionCenterProps) {
  const [items, setItems] = useState<ControlTowerWorkItem[]>([])
  const [loading, setLoading] = useState(!externalItems)

  useEffect(() => {
    if (externalItems != null) {
      const list = Array.isArray(externalItems) ? externalItems : []
      setItems(businessId ? list.filter((w) => w.business_id === businessId) : list)
      setLoading(false)
      return
    }
    setLoading(true)
    fetch("/api/accounting/control-tower/work-items?limit=100")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data.work_items) ? data.work_items : []
        setItems(businessId ? list.filter((w: ControlTowerWorkItem) => w.business_id === businessId) : list)
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [externalItems, businessId])

  const critical = items.filter((w) => w.severity === "blocker" || w.severity === "critical")
  const high = items.filter((w) => w.severity === "high")
  const medium = items.filter((w) => w.severity === "medium")

  const renderGroup = (label: string, list: ControlTowerWorkItem[]) => {
    if (list.length === 0) return null
    return (
      <div key={label} className="mb-3">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
          {label}
        </div>
        <ul className="space-y-1">
          {list.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-gray-700 dark:text-gray-300 truncate">
                {TYPE_LABELS[w.work_item_type]} — {w.client_name}
              </span>
              <Link
                href={w.drill_route}
                className="text-blue-600 dark:text-blue-400 hover:underline shrink-0"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <section className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4">
      <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        Action center
      </h2>
      {loading ? (
        <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      ) : critical.length === 0 && high.length === 0 && medium.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No actionable items.</p>
      ) : (
        <>
          {renderGroup("Critical", critical)}
          {renderGroup("High", high)}
          {renderGroup("Medium", medium)}
        </>
      )}
    </section>
  )
}
