"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { EngagementStatusBadge } from "@/components/EngagementStatusBadge"

type Client = {
  id: string
  business_id: string
  business_name: string
  access_level: "read" | "write" | "approve"
  engagement_status?: "pending" | "active" | "suspended" | "terminated"
  granted_at: string
  accepted_at?: string | null
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export default function ClientsPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        setError("")
        const res = await fetch("/api/accounting/firm/clients")
        if (cancelled) return
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.error || `Failed to load clients (${res.status})`)
          return
        }
        const data = await res.json()
        if (!cancelled) setClients(data.clients ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load clients")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const filtered = search.trim()
    ? clients.filter((c) =>
        c.business_name.toLowerCase().includes(search.toLowerCase())
      )
    : clients

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Clients</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            All engaged clients. Click a row to open the client command center.
          </p>
        </div>
        <Link
          href="/accounting/firm/clients/add"
          className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Add client
        </Link>
      </div>

      <div className="mb-4">
        <input
          type="search"
          placeholder="Search by client name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-72 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-6 py-16 text-center text-sm text-gray-500 dark:text-gray-400">
          {search ? "No clients match that search." : "No clients found. Add one to get started."}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Client
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Last activity
                </th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filtered.map((client) => (
                <tr
                  key={client.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/accounting/clients/${client.business_id}/overview`)}
                >
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {client.business_name}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {client.engagement_status ? (
                      <EngagementStatusBadge status={client.engagement_status} />
                    ) : (
                      <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(client.accepted_at ?? client.granted_at)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/accounting/clients/${client.business_id}/overview`}
                      className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
