"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import LoadingScreen from "@/components/ui/LoadingScreen"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type ServiceCatalogRow = {
  id: string
  name: string
  default_price: number
  tax_code: string | null
  is_active: boolean
}

export default function ServiceServicesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { format } = useBusinessCurrency()
  const PAGE_SIZE = 25
  const [rows, setRows] = useState<ServiceCatalogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [page, setPage] = useState(() => {
    const p = Number.parseInt(searchParams.get("page") || "1", 10)
    return Number.isFinite(p) && p > 0 ? p : 1
  })
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: PAGE_SIZE,
    totalCount: 0,
    totalPages: 0,
  })

  useEffect(() => {
    load()
  }, [page])

  const load = async () => {
    try {
      setLoading(true)
      setError("")
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("limit", String(PAGE_SIZE))
      const res = await fetch(`/api/service/services/workspace?${params.toString()}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Failed to load services")
        setLoading(false)
        return
      }
      setRows((data.rows ?? []) as ServiceCatalogRow[])
      setPagination(
        data.pagination || { page, pageSize: PAGE_SIZE, totalCount: 0, totalPages: 0 }
      )
      setLoading(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
      setLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (page <= 1) params.delete("page")
    else params.set("page", String(page))
    router.replace(`/service/services?${params.toString()}`)
  }, [page, router, searchParams])

  if (loading) return <LoadingScreen />

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Services</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {pagination.totalCount} service{pagination.totalCount !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            type="button"
            data-tour="service-services-add"
            onClick={() => router.push("/service/services/new")}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
          >
            Add Service
          </button>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        <div
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden"
          data-tour="service-services-list"
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Default price</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Tax code</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Active</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      No services yet. Add your first service to get started.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{row.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{format(Number(row.default_price ?? 0))}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{row.tax_code ?? "—"}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{row.is_active ? "Yes" : "No"}</td>
                      <td className="px-6 py-4 text-sm">
                        <button
                          onClick={() => router.push(`/service/services/${row.id}/edit`)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-700/20">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-gray-600 dark:text-gray-300">
                Page {pagination.page} of {pagination.totalPages} ({pagination.totalCount} total)
              </span>
              <button
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
