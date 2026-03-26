"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

type FirmDocumentRow = {
  id: string
  client_business_id: string
  client_name: string | null
  title: string
  category: string
  file_name: string
  created_at: string
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-"
  try {
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" })
      .format(new Date(iso))
  } catch {
    return iso
  }
}

function shortId(value: string): string {
  return `${value.slice(0, 8)}...`
}

export default function FirmDocumentsPage() {
  const [allDocuments, setAllDocuments] = useState<FirmDocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [clientFilter, setClientFilter] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/accounting/documents?limit=500")
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Failed to load (${res.status})`)
        setAllDocuments([])
        return
      }
      setAllDocuments(data.documents ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents")
      setAllDocuments([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const clients = useMemo(() => {
    const seen = new Map<string, string>()
    for (const document of allDocuments) {
      if (!seen.has(document.client_business_id)) {
        seen.set(
          document.client_business_id,
          document.client_name ?? shortId(document.client_business_id)
        )
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allDocuments])

  const categories = useMemo(() => {
    return Array.from(
      new Set(allDocuments.map((document) => document.category).filter((category) => Boolean(category?.trim())))
    ).sort((a, b) => a.localeCompare(b))
  }, [allDocuments])

  const filtered = useMemo(() => {
    return allDocuments.filter((document) => {
      if (clientFilter && document.client_business_id !== clientFilter) return false
      if (categoryFilter && document.category !== categoryFilter) return false
      return true
    })
  }, [allDocuments, clientFilter, categoryFilter])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Documents</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Documents across all firm clients. Open a client document page to view file details.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="h-7 w-7 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Client</label>
                <select
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All clients</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Category</label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {filtered.length} document{filtered.length !== 1 ? "s" : ""}
              {filtered.length !== allDocuments.length ? ` (filtered from ${allDocuments.length})` : ""}
            </p>
            {(clientFilter || categoryFilter) && (
              <button
                onClick={() => {
                  setClientFilter("")
                  setCategoryFilter("")
                }}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Client name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Title
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Category
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    File name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Created date
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                      No documents match your filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((document) => {
                    const clientHref = `/accounting/clients/${encodeURIComponent(document.client_business_id)}/documents`
                    return (
                      <tr key={document.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-4 py-3 text-sm">
                          <Link
                            href={clientHref}
                            className="font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                          >
                            {document.client_name ?? shortId(document.client_business_id)}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{document.title}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{document.category || "-"}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{document.file_name}</td>
                        <td className="px-4 py-3 text-sm whitespace-nowrap text-gray-500 dark:text-gray-400">
                          {fmtDate(document.created_at)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
