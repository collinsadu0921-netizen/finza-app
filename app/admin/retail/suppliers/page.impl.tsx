"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import Link from "next/link"

type Supplier = {
  id: string
  name: string
  phone: string | null
  email: string | null
  status: "active" | "blocked"
  created_at: string
}

export default function SuppliersPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  useEffect(() => {
    loadSuppliers()
  }, [statusFilter])

  const loadSuppliers = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      const params = new URLSearchParams()
      if (statusFilter !== "all") {
        params.append("status", statusFilter)
      }
      if (searchQuery) {
        params.append("search", searchQuery)
      }

      const response = await fetch(`/api/suppliers?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to load suppliers")
      }

      setSuppliers(data.suppliers || [])
    } catch (err: any) {
      console.error("Error loading suppliers:", err)
      setError(err.message || "Failed to load suppliers")
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    loadSuppliers()
  }

  const getStatusBadge = (status: string) => {
    return (
      <span
        className={`px-2 py-1 rounded text-xs font-semibold ${
          status === "active"
            ? "bg-green-100 text-green-800"
            : "bg-red-100 text-red-800"
        }`}
      >
        {status.toUpperCase()}
      </span>
    )
  }

  if (loading) {
    return (
      <>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading suppliers...</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Suppliers</h1>
            <p className="text-gray-600 mt-1">
              Manage your suppliers and purchase orders
            </p>
          </div>
          <Link
            href="/admin/retail/suppliers/new"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            + New Supplier
          </Link>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Search and Filters */}
        <div className="mb-4 flex gap-2">
          <input
            type="text"
            placeholder="Search suppliers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1 border rounded px-4 py-2"
          />
          <button
            onClick={handleSearch}
            className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300"
          >
            Search
          </button>
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-4 py-2 rounded ${
              statusFilter === "all"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setStatusFilter("active")}
            className={`px-4 py-2 rounded ${
              statusFilter === "active"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setStatusFilter("blocked")}
            className={`px-4 py-2 rounded ${
              statusFilter === "blocked"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Blocked
          </button>
        </div>

        {/* Suppliers Table */}
        {suppliers.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-600">No suppliers found</p>
            <Link
              href="/admin/retail/suppliers/new"
              className="text-blue-600 hover:underline mt-2 inline-block"
            >
              Create your first supplier
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {suppliers.map((supplier) => (
                  <tr key={supplier.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {supplier.name}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div>{supplier.phone || "-"}</div>
                      <div>{supplier.email || "-"}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(supplier.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(supplier.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <Link
                        href={`/admin/retail/suppliers/${supplier.id}`}
                        className="text-blue-600 hover:text-blue-900 mr-4"
                      >
                        View
                      </Link>
                      <Link
                        href={`/admin/retail/purchase-orders/new?supplier_id=${supplier.id}`}
                        className="text-green-600 hover:text-green-900"
                      >
                        New PO
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
