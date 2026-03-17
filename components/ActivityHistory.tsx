"use client"

import { useState, useEffect } from "react"
import { formatTimestamp } from "@/lib/formatTimestamp"

type AuditLog = {
  id: string
  user_id: string | null
  action_type: string
  entity_type: string
  entity_id: string | null
  old_values: Record<string, any> | null
  new_values: Record<string, any> | null
  description: string | null
  created_at: string
  user?: {
    id: string
    email: string
  } | null
}

interface ActivityHistoryProps {
  entityType: string
  entityId: string
}

export default function ActivityHistory({ entityType, entityId }: ActivityHistoryProps) {
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [expandedLog, setExpandedLog] = useState<string | null>(null)

  useEffect(() => {
    loadActivity()
  }, [entityType, entityId])

  const loadActivity = async () => {
    try {
      setLoading(true)
      
      if (!entityType || !entityId) {
        console.warn("ActivityHistory: Missing entityType or entityId", { entityType, entityId })
        setLogs([])
        setLoading(false)
        return
      }

      const response = await fetch(`/api/audit-logs/list?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`)
      
      if (!response.ok) {
        let errorData: any = {}
        let errorText = ""
        
        try {
          const contentType = response.headers.get("content-type")
          if (contentType && contentType.includes("application/json")) {
            errorData = await response.json()
          } else {
            errorText = await response.text()
          }
        } catch (parseError) {
          errorText = `Failed to parse error response: ${parseError}`
        }
        
        console.error("ActivityHistory API error:", {
          status: response.status,
          statusText: response.statusText,
          error: errorData,
          errorText: errorText || "No error details",
          entityType,
          entityId,
          url: response.url,
        })
        
        // Don't throw error, just show empty state
        // This is a non-critical feature, so we don't want to break the page
        setLogs([])
        setLoading(false)
        return
      }

      const data = await response.json()
      setLogs(data.logs || data || [])
      setLoading(false)
    } catch (err) {
      console.error("Error loading activity:", err)
      // Don't show error to user, just show empty state
      setLogs([])
      setLoading(false)
    }
  }

  const formatActionType = (actionType: string) => {
    return actionType.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
  }

  const getActionIcon = (actionType: string) => {
    if (actionType.includes("created")) return "➕"
    if (actionType.includes("edited") || actionType.includes("updated")) return "✏️"
    if (actionType.includes("deleted")) return "🗑️"
    if (actionType.includes("sent")) return "📤"
    if (actionType.includes("applied")) return "✅"
    if (actionType.includes("status_changed")) return "🔄"
    return "📝"
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
        <p className="text-gray-500 dark:text-gray-400">Loading activity...</p>
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Activity History</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm">No activity recorded yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Activity History</h2>
      <div className="space-y-3">
        {logs.map((log) => (
          <div key={log.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1">
                <span className="text-2xl">{getActionIcon(log.action_type)}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-900 dark:text-white text-sm">
                      {formatActionType(log.action_type)}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {formatTimestamp(log.created_at)}
                    </span>
                  </div>
                  {log.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{log.description}</p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    by {log.user ? log.user.email : "System"}
                  </p>
                  {(log.old_values || log.new_values) && (
                    <button
                      onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 mt-2"
                    >
                      {expandedLog === log.id ? "Hide details" : "Show details"}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {expandedLog === log.id && (log.old_values || log.new_values) && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 grid grid-cols-2 gap-4">
                {log.old_values && Object.keys(log.old_values).length > 0 && (
                  <div>
                    <h4 className="font-semibold text-xs text-gray-700 dark:text-gray-300 mb-1">Before:</h4>
                    <pre className="bg-gray-50 dark:bg-gray-900 p-2 rounded text-xs overflow-auto max-h-32 border border-gray-200 dark:border-gray-600">
                      {JSON.stringify(log.old_values, null, 2)}
                    </pre>
                  </div>
                )}
                {log.new_values && Object.keys(log.new_values).length > 0 && (
                  <div>
                    <h4 className="font-semibold text-xs text-gray-700 dark:text-gray-300 mb-1">After:</h4>
                    <pre className="bg-gray-50 dark:bg-gray-900 p-2 rounded text-xs overflow-auto max-h-32 border border-gray-200 dark:border-gray-600">
                      {JSON.stringify(log.new_values, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

