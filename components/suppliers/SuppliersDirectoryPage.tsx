"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useServicePageBusiness } from "@/lib/hooks/useServicePageBusiness"
import { parseSupplierRecord, type SupplierRecord } from "@/lib/suppliers/createSupplier"
import SupplierEditorModal from "@/components/suppliers/SupplierEditorModal"

type DirectoryRow = SupplierRecord

export default function SuppliersDirectoryPage() {
  const router = useRouter()
  const { businessId, ready: workspaceReady, error: workspaceError } = useServicePageBusiness()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [suppliers, setSuppliers] = useState<DirectoryRow[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [submittedSearch, setSubmittedSearch] = useState("")
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    if (!workspaceReady) return
    if (workspaceError) {
      setError(workspaceError)
      setLoading(false)
      return
    }
    if (!businessId) {
      setError("Business not found")
      setLoading(false)
      return
    }
    void loadSuppliers(businessId, submittedSearch)
  }, [workspaceReady, workspaceError, businessId, submittedSearch])

  const loadSuppliers = async (bid: string, search: string) => {
    try {
      setLoading(true)
      setError("")
      const params = new URLSearchParams()
      params.set("business_id", bid)
      if (search.trim()) params.set("search", search.trim())
      const response = await fetch(`/api/suppliers?${params.toString()}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || "Unable to load suppliers")
      }
      const rows = Array.isArray(data.suppliers)
        ? data.suppliers
            .map(parseSupplierRecord)
            .filter((row: DirectoryRow | null): row is DirectoryRow => !!row)
        : null
      if (!rows) {
        throw new Error("Unable to load suppliers")
      }
      setSuppliers(rows)
    } catch (err: unknown) {
      setSuppliers([])
      setError(err instanceof Error ? err.message : "Unable to load suppliers")
    } finally {
      setLoading(false)
    }
  }

  if (!workspaceReady || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading suppliers…</p>
        </div>
      </div>
    )
  }

  const emptyUnfiltered = suppliers.length === 0 && !submittedSearch && !error

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Suppliers</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            Manage supplier contacts for purchasing and supplier bills.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          disabled={!businessId}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50"
        >
          Add Supplier
        </button>
      </div>

      {error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded text-sm">
          {error}
        </div>
      ) : null}

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="search"
            placeholder="Search by name, phone, or email…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSubmittedSearch(searchQuery.trim())
            }}
            className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <button
            type="button"
            onClick={() => setSubmittedSearch(searchQuery.trim())}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            Search
          </button>
        </div>
      </div>

      {emptyUnfiltered ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-12 text-center">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">No suppliers yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Add suppliers here or while creating a supplier bill.
          </p>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
          >
            Add Supplier
          </button>
        </div>
      ) : suppliers.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-12 text-center">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">No suppliers match your search</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Try a different name, phone, or email.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Supplier
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Phone
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {suppliers.map((supplier) => (
                  <tr key={supplier.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-6 py-4">
                      <Link
                        href={`/service/suppliers/${supplier.id}`}
                        className="font-medium text-gray-900 dark:text-white hover:text-blue-600"
                      >
                        {supplier.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{supplier.phone || "—"}</td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{supplier.email || "—"}</td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <Link
                        href={`/service/suppliers/${supplier.id}`}
                        className="text-blue-600 dark:text-blue-400 font-medium mr-4"
                      >
                        Open
                      </Link>
                      <Link
                        href={`/service/suppliers/${supplier.id}?edit=1`}
                        className="text-gray-600 dark:text-gray-300 font-medium"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {businessId ? (
        <SupplierEditorModal
          isOpen={addOpen}
          onClose={() => setAddOpen(false)}
          businessId={businessId}
          existingSuppliers={suppliers}
          onCreated={(created) => {
            setSuppliers((prev) => {
              if (prev.some((row) => row.id === created.id)) return prev
              return [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
            })
            router.push(`/service/suppliers/${created.id}`)
          }}
        />
      ) : null}
    </div>
  )
}
