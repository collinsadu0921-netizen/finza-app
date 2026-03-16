"use client"

import React, { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { buildServiceRoute } from "@/lib/service/routes"
import type { ScreenProps } from "./types"

type AuditLog = {
  id: string
  business_id: string
  user_id: string | null
  action_type: string
  entity_type: string
  entity_id: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  description: string | null
  created_at: string
}

const ACTION_TYPES = [
  "",
  "reversal",
  "adjustment",
  "period_close",
  "period_reopen",
  "approval",
  "forensic_ack",
  "forensic_resolve",
  "forensic_escalate",
  "tenant_archive",
  "tenant_reactivate",
]

const ENTITY_TYPES = ["", "journal_entry", "period", "forensic_failure", "tenant"]

export default function AuditScreen({ mode, businessId }: ScreenProps) {
  const [loading, setLoading] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState("")

  const [logs, setLogs] = useState<AuditLog[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [filters, setFilters] = useState({
    actionType: "",
    entityType: "",
    userId: "",
    entityId: "",
    startDate: "",
    endDate: "",
  })

  const loadLogs = useCallback(
    async (cursor: string | null = null, append: boolean = false) => {
      if (!businessId) return
      if (!append) setLoading(true)
      setError("")
      setForbidden(false)
      try {
        const params = new URLSearchParams()
        params.set("businessId", businessId)
        if (filters.actionType) params.set("actionType", filters.actionType)
        if (filters.entityType) params.set("entityType", filters.entityType)
        if (filters.userId) params.set("userId", filters.userId)
        if (filters.entityId) params.set("entityId", filters.entityId)
        if (filters.startDate) params.set("startDate", filters.startDate)
        if (filters.endDate) params.set("endDate", filters.endDate)
        params.set("limit", "50")
        if (cursor) params.set("cursor", cursor)

        const res = await fetch(`/api/accounting/audit?${params}`)
        if (res.status === 403) {
          setForbidden(true)
          setLogs([])
          setNextCursor(null)
          return
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        const data = await res.json()
        const next = data.logs ?? []
        if (append) {
          setLogs((prev) => [...prev, ...next])
        } else {
          setLogs(next)
        }
        setNextCursor(data.nextCursor ?? null)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load audit log")
        if (!append) setLogs([])
        setNextCursor(null)
      } finally {
        setLoading(false)
      }
    },
    [businessId, filters.actionType, filters.entityType, filters.userId, filters.entityId, filters.startDate, filters.endDate]
  )

  useEffect(() => {
    setNoContext(!businessId)
  }, [businessId])

  useEffect(() => {
    if (!businessId) return
    loadLogs(null)
  }, [businessId, loadLogs])

  const handleApplyFilters = () => {
    if (!businessId) return
    loadLogs(null)
  }

  const loadMore = () => {
    if (nextCursor && businessId) loadLogs(nextCursor, true)
  }

  const formatDate = (s: string) =>
    new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })

  const backHref = mode === "service" ? buildServiceRoute("/service/accounting", businessId) : "/accounting"

  return (
    
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <Link
              href={backHref}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            >
              ← Accounting
            </Link>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
              Audit timeline
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Read-only operational activity history. Newest first.
            </p>
          </div>

          {noContext && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6">
              <p className="text-amber-800 dark:text-amber-200">
                No business selected. Select a client or business to view audit logs.
              </p>
            </div>
          )}

          {!noContext && businessId && (
            <>
              {/* Filters */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-6">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  Filters
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Action type
                    </label>
                    <select
                      value={filters.actionType}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, actionType: e.target.value }))
                      }
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                    >
                      <option value="">All</option>
                      {ACTION_TYPES.filter(Boolean).map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Entity type
                    </label>
                    <select
                      value={filters.entityType}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, entityType: e.target.value }))
                      }
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                    >
                      <option value="">All</option>
                      {ENTITY_TYPES.filter(Boolean).map((e) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Entity ID (journal entry / period)
                    </label>
                    <input
                      type="text"
                      value={filters.entityId}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, entityId: e.target.value.trim() }))
                      }
                      placeholder="UUID"
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      User ID
                    </label>
                    <input
                      type="text"
                      value={filters.userId}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, userId: e.target.value.trim() }))
                      }
                      placeholder="UUID"
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      From date
                    </label>
                    <input
                      type="date"
                      value={filters.startDate}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, startDate: e.target.value }))
                      }
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      To date
                    </label>
                    <input
                      type="date"
                      value={filters.endDate}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, endDate: e.target.value }))
                      }
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleApplyFilters}
                  className="mt-3 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                >
                  Apply filters
                </button>
              </div>

              {forbidden && (
                <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 mb-6">
                  <p className="text-red-800 dark:text-red-200">
                    You do not have permission to view audit logs for this business.
                  </p>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 mb-6">
                  <p className="text-red-800 dark:text-red-200">{error}</p>
                </div>
              )}

              {loading && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
                  <p className="text-gray-500 dark:text-gray-400">Loading…</p>
                </div>
              )}

              {!loading && !forbidden && logs.length === 0 && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
                  <p className="text-gray-500 dark:text-gray-400">No audit entries match the filters.</p>
                </div>
              )}

              {!loading && !forbidden && logs.length > 0 && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-700/50">
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Timestamp
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Actor
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Action type
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Entity type
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Entity ID
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Reason / Description
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Business
                          </th>
                          <th className="px-4 py-3 w-10" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {logs.map((log) => (
                          <React.Fragment key={log.id}>
                            <tr
                              key={log.id}
                              className="hover:bg-gray-50 dark:hover:bg-gray-700/30"
                            >
                              <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                                {formatDate(log.created_at)}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 font-mono">
                                {log.user_id ?? "—"}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
                                {log.action_type}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
                                {log.entity_type}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 font-mono truncate max-w-[120px]">
                                {log.entity_id ?? "—"}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 max-w-[200px] truncate">
                                {log.description ?? "—"}
                              </td>
                              <td className="px-4 py-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                                  {log.business_id.slice(0, 8)}…
                                </span>
                              </td>
                              <td className="px-4 py-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedId((id) => (id === log.id ? null : log.id))
                                  }
                                  className="text-blue-600 dark:text-blue-400 text-sm"
                                  aria-expanded={expandedId === log.id}
                                >
                                  {expandedId === log.id ? "Hide" : "Details"}
                                </button>
                              </td>
                            </tr>
                            {expandedId === log.id && (
                              <tr key={`${log.id}-expanded`}>
                                <td colSpan={8} className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                    {log.old_values &&
                                      Object.keys(log.old_values).length > 0 && (
                                        <div>
                                          <p className="font-medium text-gray-600 dark:text-gray-400 mb-1">
                                            old_values
                                          </p>
                                          <pre className="p-3 rounded bg-gray-100 dark:bg-gray-900 overflow-auto max-h-48 font-mono">
                                            {JSON.stringify(log.old_values, null, 2)}
                                          </pre>
                                        </div>
                                      )}
                                    {log.new_values &&
                                      Object.keys(log.new_values).length > 0 && (
                                        <div>
                                          <p className="font-medium text-gray-600 dark:text-gray-400 mb-1">
                                            new_values
                                          </p>
                                          <pre className="p-3 rounded bg-gray-100 dark:bg-gray-900 overflow-auto max-h-48 font-mono">
                                            {JSON.stringify(log.new_values, null, 2)}
                                          </pre>
                                        </div>
                                      )}
                                    {(!log.old_values ||
                                      Object.keys(log.old_values).length === 0) &&
                                      (!log.new_values ||
                                        Object.keys(log.new_values).length === 0) && (
                                        <p className="text-gray-500 dark:text-gray-400">
                                          No metadata
                                        </p>
                                      )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {nextCursor && (
                    <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                      <button
                        type="button"
                        onClick={loadMore}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Load more
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    
  )
}

