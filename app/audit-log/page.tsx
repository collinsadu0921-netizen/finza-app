"use client"

import React, { useState, useEffect, useRef } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import EmptyState from "@/components/ui/EmptyState"
import { formatTimestamp } from "@/lib/formatTimestamp"

type AuditLog = {
  id: string
  business_id: string
  user_id: string | null
  action_type: string // Correct field name
  entity_type: string // Correct field name
  entity_id: string | null
  old_values: Record<string, any> | null // Correct field name (plural)
  new_values: Record<string, any> | null // Correct field name (plural)
  ip_address: string | null
  user_agent: string | null
  description: string | null
  created_at: string // Correct field name (not timestamp)
  user?: {
    id: string
    email: string
  } | null
}

export default function AuditLogPage() {
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [error, setError] = useState("")
  const [filters, setFilters] = useState({
    start_date: "",
    end_date: "",
    user_id: "",
    action_type: "",
    entity_type: "",
  })
  const [searchInput, setSearchInput] = useState<string>("")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [isSearching, setIsSearching] = useState(false)
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)

  // Debounced search effect - updates searchQuery after user stops typing
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    if (searchInput.trim()) {
      setIsSearching(true)
    }

    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput)
      setIsSearching(false)
    }, 300)

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [searchInput])

  useEffect(() => {
    loadLogs()
  }, [filters, searchQuery])

  const loadLogs = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (filters.start_date) params.append("start_date", filters.start_date)
      if (filters.end_date) params.append("end_date", filters.end_date)
      if (filters.user_id) params.append("user_id", filters.user_id)
      if (filters.action_type) params.append("action_type", filters.action_type)
      if (filters.entity_type) params.append("entity_type", filters.entity_type)
      if (searchQuery) params.append("search", searchQuery)

      const response = await fetch(`/api/audit-logs/list?${params.toString()}`)
      
      if (!response.ok) {
        throw new Error("Failed to load audit logs")
      }

      const { logs: data } = await response.json()
      // Ensure we have an array and handle empty case
      if (!data || !Array.isArray(data)) {
        setLogs([])
      } else {
        setLogs(data)
      }
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load audit logs")
      setLoading(false)
    }
  }

  const formatActionType = (actionType: string) => {
    return actionType.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
  }

  const getActionColor = (actionType: string) => {
    if (actionType.includes("created")) return "bg-green-100 text-green-800"
    if (actionType.includes("edited") || actionType.includes("updated")) return "bg-blue-100 text-blue-800"
    if (actionType.includes("deleted")) return "bg-red-100 text-red-800"
    if (actionType.includes("sent")) return "bg-purple-100 text-purple-800"
    return "bg-gray-100 text-gray-800"
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <LoadingScreen />
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageHeader
            title="Audit Log"
            subtitle="Complete activity history and change tracking"
          />

          {error && (
            <div className="bg-red-50 border-l-4 border-red-400 text-red-700 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Filters */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Start Date</label>
                <input
                  type="date"
                  value={filters.start_date}
                  onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">End Date</label>
                <input
                  type="date"
                  value={filters.end_date}
                  onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Action Type</label>
                <select
                  value={filters.action_type}
                  onChange={(e) => setFilters({ ...filters, action_type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="">All Actions</option>
                  <option value="invoice.created">Invoice Created</option>
                  <option value="invoice.edited">Invoice Edited</option>
                  <option value="invoice.sent_whatsapp">Invoice Sent (WhatsApp)</option>
                  <option value="payment.added">Payment Added</option>
                  <option value="credit_note.applied">Credit Note Applied</option>
                  <option value="expense.created">Expense Created</option>
                  <option value="bill.created">Bill Created</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Entity Type</label>
                <select
                  value={filters.entity_type}
                  onChange={(e) => setFilters({ ...filters, entity_type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="">All Entities</option>
                  <option value="invoice">Invoice</option>
                  <option value="payment">Payment</option>
                  <option value="credit_note">Credit Note</option>
                  <option value="expense">Expense</option>
                  <option value="bill">Bill</option>
                  <option value="account">Account</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Search</label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search..."
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setFilters({ start_date: "", end_date: "", user_id: "", action_type: "", entity_type: "" })
                    setSearchInput("")
                    setSearchQuery("")
                  }}
                  className="w-full bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 font-medium transition-all"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          {/* Logs Table */}
          {logs.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              }
              title="No audit logs found for this business"
              description="Activity logs will appear here as you use the system."
            />
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Date/Time</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">User</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Action</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Entity</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Summary</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {logs.map((log) => (
                      <React.Fragment key={log.id}>
                        <tr className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            {formatTimestamp(log.created_at)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            {log.user ? log.user.email : <span className="text-gray-400 italic">System</span>}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${getActionColor(log.action_type)}`}>
                              {formatActionType(log.action_type)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                            {log.entity_type} {log.entity_id ? `#${log.entity_id.substring(0, 8)}` : ""}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">
                            {log.description || "—"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <button
                              onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                              className="text-indigo-600 hover:text-indigo-800 text-sm font-medium transition-colors"
                            >
                              {expandedLog === log.id ? "Hide" : "View"}
                            </button>
                          </td>
                        </tr>
                        {expandedLog === log.id && (
                          <tr>
                            <td colSpan={6} className="px-6 py-4 bg-gray-50">
                              <div className="grid grid-cols-2 gap-4">
                                {log.old_values && Object.keys(log.old_values).length > 0 && (
                                  <div>
                                    <h4 className="font-semibold text-sm text-gray-900 mb-2">Old Values:</h4>
                                    <pre className="bg-white p-3 rounded text-xs overflow-auto max-h-48 border border-gray-200">
                                      {JSON.stringify(log.old_values || {}, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {log.new_values && Object.keys(log.new_values).length > 0 && (
                                  <div>
                                    <h4 className="font-semibold text-sm text-gray-900 mb-2">New Values:</h4>
                                    <pre className="bg-white p-3 rounded text-xs overflow-auto max-h-48 border border-gray-200">
                                      {JSON.stringify(log.new_values || {}, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {(!log.old_values || Object.keys(log.old_values || {}).length === 0) && 
                                 (!log.new_values || Object.keys(log.new_values || {}).length === 0) && (
                                  <div className="col-span-2 text-sm text-gray-500">
                                    No detailed change information available
                                  </div>
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
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}


