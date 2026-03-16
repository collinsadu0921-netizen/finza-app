"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { getActiveFirmId } from "@/lib/firmSession"
import type { FirmRole } from "@/lib/firmAuthority"
import { DisabledActionButton } from "@/components/AuthorityGuard"
import { EngagementStatusBadge } from "@/components/EngagementStatusBadge"

type ClientStatus = {
  period_status: string
  period_start: string | null
  period_end: string | null
  pending_adjustments_count: number
  afs_status: "none" | "draft" | "finalized"
  exceptions_count: {
    critical: number
    warning: number
    info: number
    total: number
  }
}

type Client = {
  id: string
  business_id: string
  business_name: string
  access_level: "read" | "write" | "approve"
  engagement_status?: "pending" | "active" | "suspended" | "terminated"
  effective_from?: string
  effective_to?: string | null
  granted_at: string
  accepted_at?: string | null
  status: ClientStatus
  engagementId?: string
}

type Metrics = {
  total_clients: number
  clients_with_draft_afs: number
  clients_blocked_by_preflight: number
}

type ActivityLog = {
  id: string
  firm_id: string
  actor_user_id: string
  action_type: string
  entity_type: string
  entity_id: string | null
  metadata: any
  created_at: string
}

export default function FirmDashboardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get("tab")
  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState<Client[]>([])
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState<"clients" | "activity">(
    tabParam === "activity" ? "activity" : "clients"
  )
  const [filters, setFilters] = useState({
    period_start: "",
    jurisdiction: "",
    risk: "",
  })
  const [activityFilters, setActivityFilters] = useState({
    date_from: "",
    date_to: "",
    action_type: "",
    actor_user_id: "",
  })
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityTotal, setActivityTotal] = useState(0)
  const [activityPage, setActivityPage] = useState(1)
  const [firmRole, setFirmRole] = useState<FirmRole | null>(null)

  useEffect(() => {
    if (tabParam === "activity") setActiveTab("activity")
  }, [tabParam])

  useEffect(() => {
    loadMetrics()
    loadFirmRole()
    loadClients()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  useEffect(() => {
    if (activeTab === "activity") {
      loadActivity()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activityFilters, activityPage])

  const loadMetrics = async () => {
    try {
      const response = await fetch("/api/accounting/firm/metrics")
      if (response.ok) {
        const data = await response.json()
        setMetrics(data)
      }
    } catch (err) {
      console.error("Error loading metrics:", err)
    }
  }

  const loadFirmRole = async () => {
    try {
      const firmId = getActiveFirmId()
      if (!firmId) return

      const response = await fetch("/api/accounting/firm/firms")
      if (response.ok) {
        const data = await response.json()
        const firm = data.firms?.find((f: any) => f.firm_id === firmId)
        if (firm) {
          setFirmRole((firm.role as FirmRole) ?? null)
        }
      }
    } catch (err) {
      console.error("Error loading firm role:", err)
    }
  }

  const loadClients = async () => {
    try {
      setLoading(true)
      setError("")

      const params = new URLSearchParams()
      if (filters.period_start) {
        params.append("period_start", filters.period_start)
      }
      if (filters.jurisdiction) {
        params.append("jurisdiction", filters.jurisdiction)
      }
      if (filters.risk) {
        params.append("risk", filters.risk)
      }

      const response = await fetch(`/api/accounting/firm/clients?${params.toString()}`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load clients")
      }

      const data = await response.json()
      setClients(data.clients || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load clients")
      setLoading(false)
    }
  }

  const loadActivity = async () => {
    try {
      setActivityLoading(true)
      const params = new URLSearchParams()
      if (activityFilters.date_from) {
        params.append("date_from", activityFilters.date_from)
      }
      if (activityFilters.date_to) {
        params.append("date_to", activityFilters.date_to)
      }
      if (activityFilters.action_type) {
        params.append("action_type", activityFilters.action_type)
      }
      if (activityFilters.actor_user_id) {
        params.append("actor_user_id", activityFilters.actor_user_id)
      }
      params.append("limit", "50")
      params.append("offset", ((activityPage - 1) * 50).toString())

      const response = await fetch(`/api/accounting/firm/activity?${params.toString()}`)
      if (!response.ok) {
        throw new Error("Failed to load activity")
      }

      const data = await response.json()
      setActivityLogs(data.logs || [])
      setActivityTotal(data.total || 0)
      setActivityLoading(false)
    } catch (err: any) {
      console.error("Error loading activity:", err)
      setActivityLoading(false)
    }
  }

  const handleBulkPreflight = async () => {
    if (!confirm("Run bulk preflight validation for all clients?")) return

    try {
      const businessIds = clients.map((c) => c.business_id)
      const response = await fetch("/api/accounting/firm/bulk/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_ids: businessIds,
          operation: "afs_finalize",
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        alert(`Error: ${errorData.error || "Failed to run bulk preflight"}`)
        return
      }

      const data = await response.json()
      alert(`Preflight complete. ${data.results?.length || 0} clients validated.`)
      loadMetrics()
    } catch (err: any) {
      alert(`Error: ${err.message || "Failed to run bulk preflight"}`)
    }
  }

  const handleBulkAFSFinalize = async () => {
    if (!confirm("Finalize AFS for all clients with draft AFS? This action cannot be undone.")) return

    try {
      const businessIds = clients.filter((c) => c.status.afs_status === "draft").map((c) => c.business_id)
      if (businessIds.length === 0) {
        alert("No clients with draft AFS found")
        return
      }

      const confirmations = businessIds.map((id) => ({ business_id: id, confirmed: true }))
      const response = await fetch("/api/accounting/firm/bulk/afs/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_ids: businessIds,
          confirmations,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        alert(`Error: ${errorData.error || "Failed to finalize AFS"}`)
        return
      }

      alert("AFS finalized successfully")
      loadMetrics()
      loadClients()
    } catch (err: any) {
      alert(`Error: ${err.message || "Failed to finalize AFS"}`)
    }
  }

  const getPeriodStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; color: string }> = {
      open: { label: "Open", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
      soft_closed: { label: "Soft Closed", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
      locked: { label: "Locked", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" },
      none: { label: "No Period", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" },
    }
    const statusInfo = statusMap[status] || { label: status, color: "bg-gray-100 text-gray-800" }
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusInfo.color}`}>
        {statusInfo.label}
      </span>
    )
  }

  const getAFSStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; color: string }> = {
      none: { label: "None", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" },
      draft: { label: "Draft", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
      finalized: { label: "Finalized", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
    }
    const statusInfo = statusMap[status] || { label: status, color: "bg-gray-100 text-gray-800" }
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusInfo.color}`}>
        {statusInfo.label}
      </span>
    )
  }

  const getAccessLevelBadge = (level: string) => {
    const levelMap: Record<string, { label: string; color: string }> = {
      read: { label: "Read", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" },
      write: { label: "Write", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
      approve: { label: "Approve", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
    }
    const levelInfo = levelMap[level] || { label: level, color: "bg-gray-100 text-gray-800" }
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${levelInfo.color}`}>
        {levelInfo.label}
      </span>
    )
  }

  const formatPeriod = (periodStart: string | null) => {
    if (!periodStart) return "—"
    const date = new Date(periodStart)
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short" })
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8 flex justify-between items-start">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Firm Dashboard
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Multi-client overview and management
              </p>
            </div>
            <button
              onClick={() => router.push("/accounting/firm/authority")}
              className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              View Authority Matrix
            </button>
          </div>

          {/* Metrics Cards */}
          {metrics && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Total Clients
                </div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">
                  {metrics.total_clients}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Clients with Draft AFS
                </div>
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                  {metrics.clients_with_draft_afs}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Clients Blocked by Preflight
                </div>
                <div className="text-3xl font-bold text-red-600 dark:text-red-400">
                  {metrics.clients_blocked_by_preflight}
                </div>
              </div>
            </div>
          )}

          {/* Quick Actions */}
          {firmRole && (
            <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Quick Actions
                </h2>
                <Link
                  href="/accounting/firm/ops"
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  View Operations →
                </Link>
              </div>
              <div className="flex gap-4 flex-wrap">
                <DisabledActionButton
                  userRole={firmRole}
                  engagementAccess={null}
                  actionType="create_engagement"
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => router.push("/accounting/firm/clients/add")}
                >
                  Add Client
                </DisabledActionButton>
                <DisabledActionButton
                  userRole={firmRole}
                  engagementAccess={null}
                  actionType="bulk_operations"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleBulkPreflight}
                >
                  Bulk Preflight (Firm-wide)
                </DisabledActionButton>
                <DisabledActionButton
                  userRole={firmRole}
                  engagementAccess={null}
                  actionType="bulk_operations"
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleBulkAFSFinalize}
                >
                  Bulk AFS Finalize (Firm-wide)
                </DisabledActionButton>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab("clients")}
                className={`px-4 py-2 font-medium ${
                  activeTab === "clients"
                    ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                Clients
              </button>
              <button
                onClick={() => setActiveTab("activity")}
                className={`px-4 py-2 font-medium ${
                  activeTab === "activity"
                    ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                Activity
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Filters</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Period
                </label>
                <input
                  type="month"
                  value={filters.period_start}
                  onChange={(e) => setFilters({ ...filters, period_start: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Jurisdiction
                </label>
                <input
                  type="text"
                  placeholder="Filter by jurisdiction"
                  value={filters.jurisdiction}
                  onChange={(e) => setFilters({ ...filters, jurisdiction: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled
                />
                <p className="text-xs text-gray-500 mt-1">Coming soon</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Risk
                </label>
                <select
                  value={filters.risk}
                  onChange={(e) => setFilters({ ...filters, risk: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">All Clients</option>
                  <option value="critical">Critical Exceptions</option>
                </select>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Loading clients...</p>
            </div>
          )}

          {/* Clients Tab */}
          {activeTab === "clients" && (
            <>
              {/* Filters */}
              <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Filters</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Period
                    </label>
                    <input
                      type="month"
                      value={filters.period_start}
                      onChange={(e) => setFilters({ ...filters, period_start: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Jurisdiction
                    </label>
                    <input
                      type="text"
                      placeholder="Filter by jurisdiction"
                      value={filters.jurisdiction}
                      onChange={(e) => setFilters({ ...filters, jurisdiction: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled
                    />
                    <p className="text-xs text-gray-500 mt-1">Coming soon</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Risk
                    </label>
                    <select
                      value={filters.risk}
                      onChange={(e) => setFilters({ ...filters, risk: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">All Clients</option>
                      <option value="critical">Critical Exceptions</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Clients List */}
              {!loading && !error && (
                <>
                  {clients.length === 0 ? (
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
                      <p className="text-gray-600 dark:text-gray-400">No clients found</p>
                    </div>
                  ) : (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Business Name
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Access Level
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Period Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Period
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Pending Adjustments
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            AFS Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Exceptions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {clients.map((client) => (
                          <tr
                            key={client.id}
                            className="hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => router.push(`/accounting?business_id=${client.business_id}`)}
                                  className="text-sm font-medium text-gray-900 dark:text-white hover:underline text-left"
                                >
                                  {client.business_name}
                                </button>
                                <Link
                                  href={`/accounting/firm/engagements/${client.engagementId ?? client.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                  Manage engagement
                                </Link>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex flex-col gap-1">
                                {getAccessLevelBadge(client.access_level)}
                                {client.engagement_status && (
                                  <EngagementStatusBadge
                                    status={client.engagement_status as any}
                                  />
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {getPeriodStatusBadge(client.status.period_status)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                              {formatPeriod(client.status.period_start)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`text-sm font-medium ${
                                  client.status.pending_adjustments_count > 0
                                    ? "text-orange-600 dark:text-orange-400"
                                    : "text-gray-500 dark:text-gray-400"
                                }`}
                              >
                                {client.status.pending_adjustments_count}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {getAFSStatusBadge(client.status.afs_status)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex gap-2">
                                {client.status.exceptions_count.critical > 0 && (
                                  <span className="text-xs font-medium text-red-600 dark:text-red-400">
                                    {client.status.exceptions_count.critical} Critical
                                  </span>
                                )}
                                {client.status.exceptions_count.warning > 0 && (
                                  <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">
                                    {client.status.exceptions_count.warning} Warning
                                  </span>
                                )}
                                {client.status.exceptions_count.total === 0 && (
                                  <span className="text-xs text-gray-500 dark:text-gray-400">—</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
          </>)}

          {/* Activity Tab */}
          {activeTab === "activity" && (
            <>
              {/* Activity Filters */}
              <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Filters</h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Date From
                    </label>
                    <input
                      type="date"
                      value={activityFilters.date_from}
                      onChange={(e) => {
                        setActivityFilters({ ...activityFilters, date_from: e.target.value })
                        setActivityPage(1)
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Date To
                    </label>
                    <input
                      type="date"
                      value={activityFilters.date_to}
                      onChange={(e) => {
                        setActivityFilters({ ...activityFilters, date_to: e.target.value })
                        setActivityPage(1)
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Action Type
                    </label>
                    <select
                      value={activityFilters.action_type}
                      onChange={(e) => {
                        setActivityFilters({ ...activityFilters, action_type: e.target.value })
                        setActivityPage(1)
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">All Actions</option>
                      <option value="bulk_preflight">Bulk Preflight</option>
                      <option value="bulk_afs_finalize">Bulk AFS Finalize</option>
                      <option value="single_afs_finalize">Single AFS Finalize</option>
                      <option value="client_access_granted">Client Access Granted</option>
                      <option value="client_access_revoked">Client Access Revoked</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Actor User ID
                    </label>
                    <input
                      type="text"
                      placeholder="Filter by user"
                      value={activityFilters.actor_user_id}
                      onChange={(e) => {
                        setActivityFilters({ ...activityFilters, actor_user_id: e.target.value })
                        setActivityPage(1)
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Activity Timeline */}
              {activityLoading ? (
                <div className="text-center py-12">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <p className="mt-4 text-gray-600 dark:text-gray-400">Loading activity...</p>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                  <div className="space-y-4">
                    {activityLogs.length === 0 ? (
                      <p className="text-gray-600 dark:text-gray-400 text-center py-8">No activity logs found</p>
                    ) : (
                      activityLogs.map((log) => (
                        <div
                          key={log.id}
                          className="border-l-4 border-blue-500 pl-4 py-2"
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-medium text-gray-900 dark:text-white">
                                {log.action_type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                              </div>
                              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                {new Date(log.created_at).toLocaleString()}
                              </div>
                              {log.metadata && Object.keys(log.metadata).length > 0 && (
                                <div className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                                  {JSON.stringify(log.metadata, null, 2)}
                                </div>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              Actor: {log.actor_user_id.slice(0, 8)}...
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Pagination */}
                  {activityTotal > 50 && (
                    <div className="mt-6 flex justify-between items-center">
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Showing {(activityPage - 1) * 50 + 1} to {Math.min(activityPage * 50, activityTotal)} of {activityTotal}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                          disabled={activityPage === 1}
                          className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Previous
                        </button>
                        <button
                          onClick={() => setActivityPage((p) => p + 1)}
                          disabled={activityPage * 50 >= activityTotal}
                          className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
