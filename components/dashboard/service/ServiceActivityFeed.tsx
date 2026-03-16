"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

type AuditLogEntry = {
  id: string
  action_type: string
  entity_type: string
  entity_id: string | null
  description: string | null
  created_at: string
}

export type ServiceActivityFeedProps = {
  businessId: string
  limit?: number
}

export default function ServiceActivityFeed({ businessId, limit = 15 }: ServiceActivityFeedProps) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchLogs() {
      try {
        const res = await fetch(
          `/api/accounting/audit?businessId=${encodeURIComponent(businessId)}&limit=${limit}`
        )
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled && data.logs) setLogs(data.logs)
      } catch {
        if (!cancelled) setLogs([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchLogs()
    return () => { cancelled = true }
  }, [businessId, limit])

  const actionLabel = (action: string, entity: string) => {
    const a = action ?? ""
    const e = entity ?? ""
    if (a && e) return `${a} · ${e}`
    if (a) return a
    if (e) return e
    return "Activity"
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString()
  }

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-gray-700/80 dark:bg-gray-800/80">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Recent activity</h3>
        <Link
          href="/accounting/audit"
          className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          View all
        </Link>
      </div>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 rounded bg-gray-100 dark:bg-gray-700/50 animate-pulse" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No recent activity</p>
      ) : (
        <ul className="space-y-2 max-h-80 overflow-y-auto">
          {logs.map((log) => (
            <li
              key={log.id}
              className="flex items-start gap-2 py-2 border-b border-gray-100 dark:border-gray-700/50 last:border-0 last:pb-0"
            >
              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                {formatDate(log.created_at)}
              </span>
              <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                {log.description || actionLabel(log.action_type, log.entity_type)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
