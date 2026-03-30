"use client"

import { useEffect, useState, useCallback } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { filterDeliveries, getRiders, updateDeliveryStatus, Rider, DeliveryFilters } from "@/lib/rider"
import { getCurrentBusiness } from "@/lib/business"
import { formatMoney } from "@/lib/money"

export default function DeliveriesPage() {
  const router = useRouter()
  const [deliveries, setDeliveries] = useState<any[]>([])
  const [riders, setRiders] = useState<Rider[]>([])
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState("")
  const [currencyCode, setCurrencyCode] = useState("GHS")
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statusModal, setStatusModal] = useState<{ open: boolean; delivery: any }>({
    open: false,
    delivery: null,
  })

  // Filters
  const [filters, setFilters] = useState<DeliveryFilters>({
    dateRange: "today",
    rider_id: "",
    payment_method: "all",
    status: "all",
    search: "",
    page: 1,
  })
  const [searchInput, setSearchInput] = useState("")
  const [customStartDate, setCustomStartDate] = useState("")
  const [customEndDate, setCustomEndDate] = useState("")

  const formatAmount = (amount: number) => formatMoney(amount, currencyCode)
  const getEffectiveFee = (delivery: any) =>
    Number(
      delivery.total_fee !== null && delivery.total_fee !== undefined
        ? delivery.total_fee
        : delivery.fee || 0
    )

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: searchInput, page: 1 }))
    }, 300)

    return () => clearTimeout(debounceTimer)
  }, [searchInput])

  useEffect(() => {
    if (businessId) {
      loadDeliveries()
    }
  }, [filters, businessId, customStartDate, customEndDate])

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)

      if (!business) {
        setLoading(false)
        return
      }

      setBusinessId(business.id)
      setCurrencyCode(business.default_currency || "GHS")
      const ridersList = await getRiders(business.id)
      setRiders(ridersList)
      setLoading(false)
    } catch (err: any) {
      setLoading(false)
    }
  }

  const loadDeliveries = async () => {
    if (!businessId) return

    setLoading(true)
    try {
      const filterParams: DeliveryFilters = { ...filters }
      
      // Only add custom dates if custom range is selected
      if (filters.dateRange === "custom") {
        if (customStartDate) filterParams.startDate = customStartDate
        if (customEndDate) filterParams.endDate = customEndDate
      }

      const result = await filterDeliveries(businessId, filterParams)
      setDeliveries(result.deliveries)
      setTotalCount(result.total_count)
      setCurrentPage(result.page)
      setTotalPages(result.total_pages)
    } catch (error) {
      // Error loading deliveries
    } finally {
      setLoading(false)
    }
  }

  const handleStatusUpdate = async (deliveryId: string, newStatus: string) => {
    try {
      await updateDeliveryStatus(deliveryId, newStatus)
      setStatusModal({ open: false, delivery: null })
      loadDeliveries()
    } catch (error) {
      // Error updating status
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const getStatusBadgeClass = (status: string) => {
    if (status === "completed") {
      return "bg-green-100 text-green-800"
    }
    return "bg-yellow-100 text-yellow-800"
  }

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <ProtectedLayout>
      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Deliveries</h1>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/rider/deliveries/new")}
              className="bg-blue-600 text-white px-4 py-2 rounded"
            >
              + New Delivery
            </button>
            <button
              onClick={async () => {
                await supabase.auth.signOut()
                window.location.href = "/login"
              }}
              className="bg-red-600 text-white px-4 py-1 rounded"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Filters Section */}
        <div className="bg-gray-50 p-4 rounded-lg mb-6 space-y-4">
          <div className={`grid grid-cols-1 md:grid-cols-4 gap-4 ${filters.dateRange === "custom" ? "md:grid-cols-6" : ""}`}>
            {/* Date Filter */}
            <div>
              <label className="block text-sm font-medium mb-1">Date</label>
              <select
                className="border p-2 w-full rounded"
                value={filters.dateRange || ""}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, dateRange: e.target.value, page: 1 }))
                  if (e.target.value !== "custom") {
                    setCustomStartDate("")
                    setCustomEndDate("")
                  }
                }}
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>

            {/* Custom Date Range */}
            {filters.dateRange === "custom" && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Start Date</label>
                  <input
                    type="date"
                    className="border p-2 w-full rounded"
                    value={customStartDate}
                    onChange={(e) => {
                      setCustomStartDate(e.target.value)
                      setFilters((prev) => ({ ...prev, page: 1 }))
                    }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">End Date</label>
                  <input
                    type="date"
                    className="border p-2 w-full rounded"
                    value={customEndDate}
                    onChange={(e) => {
                      setCustomEndDate(e.target.value)
                      setFilters((prev) => ({ ...prev, page: 1 }))
                    }}
                  />
                </div>
              </>
            )}

            {/* Rider Filter */}
            <div>
              <label className="block text-sm font-medium mb-1">Rider</label>
              <select
                className="border p-2 w-full rounded"
                value={filters.rider_id || ""}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, rider_id: e.target.value || "", page: 1 }))
                }
              >
                <option value="">All Riders</option>
                {riders.map((rider) => (
                  <option key={rider.id} value={rider.id}>
                    {rider.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Payment Method Filter */}
            <div>
              <label className="block text-sm font-medium mb-1">Payment</label>
              <select
                className="border p-2 w-full rounded"
                value={filters.payment_method || "all"}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, payment_method: e.target.value, page: 1 }))
                }
              >
                <option value="all">All</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="momo">MoMo</option>
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select
                className="border p-2 w-full rounded"
                value={filters.status || "all"}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, status: e.target.value, page: 1 }))
                }
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>

          {/* Search */}
          <div>
            <label className="block text-sm font-medium mb-1">Search</label>
            <input
              type="text"
              className="border p-2 w-full rounded"
              placeholder="Search by customer name, phone, or location..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
        </div>

        {/* Results Count */}
        <div className="mb-4 text-sm text-gray-600">
          Showing {deliveries.length} of {totalCount} deliveries
        </div>

        {/* Deliveries List */}
        {loading ? (
          <p>Loading...</p>
        ) : deliveries.length === 0 ? (
          <p className="text-gray-500">No deliveries found.</p>
        ) : (
          <div className="space-y-2 mb-6">
            {deliveries.map((delivery) => {
              const effectiveFee = getEffectiveFee(delivery)
              return (
                <div key={delivery.id} className="border p-4 rounded-lg">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="font-semibold">
                        {delivery.riders?.name || "Unknown Rider"}
                      </div>
                      <div className="text-sm text-gray-600">
                        {delivery.customer_name}
                        {delivery.customer_phone && ` • ${delivery.customer_phone}`}
                      </div>
                    </div>
                    <button
                      onClick={() => setStatusModal({ open: true, delivery })}
                      className={`px-3 py-1 rounded text-xs font-semibold cursor-pointer ${getStatusBadgeClass(
                        delivery.status
                      )}`}
                    >
                      {delivery.status}
                    </button>
                  </div>
                  <div className="text-sm text-gray-700 mb-2">
                    <div>📍 {delivery.pickup_location}</div>
                    <div>→ {delivery.dropoff_location}</div>
                  </div>
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-bold">{formatAmount(effectiveFee)}</span>
                      <span className="text-sm text-gray-500 ml-2">
                        {delivery.payment_method}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => router.push(`/rider/deliveries/${delivery.id}/edit`)}
                        className="bg-blue-600 text-white px-3 py-1 rounded text-xs"
                      >
                        Edit
                      </button>
                      <span className="text-sm text-gray-500">
                        {formatDate(delivery.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                    <p>
                      Distance:{" "}
                      {delivery.distance_km !== null && delivery.distance_km !== undefined
                        ? `${Number(delivery.distance_km).toFixed(1)} km`
                        : "N/A"}
                    </p>
                    <p>
                      Base fee:{" "}
                      {delivery.base_fee !== null && delivery.base_fee !== undefined
                        ? formatAmount(Number(delivery.base_fee))
                        : "—"}
                    </p>
                    <p>
                      Distance fee:{" "}
                      {delivery.distance_fee !== null && delivery.distance_fee !== undefined
                        ? formatAmount(Number(delivery.distance_fee))
                        : "—"}
                    </p>
                    <p>
                      Total fee:{" "}
                      {delivery.total_fee !== null && delivery.total_fee !== undefined
                        ? formatAmount(Number(delivery.total_fee))
                        : formatAmount(Number(delivery.fee || 0))}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-4 py-2 border rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => handlePageChange(page)}
                className={`px-4 py-2 border rounded ${
                  currentPage === page
                    ? "bg-blue-600 text-white"
                    : "bg-white hover:bg-gray-50"
                }`}
              >
                {page}
              </button>
            ))}
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-4 py-2 border rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}

        {/* Status Update Modal */}
        {statusModal.open && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
              <h2 className="text-xl font-bold mb-4">Update Delivery Status</h2>
              <p className="mb-4">
                Mark delivery as{" "}
                {statusModal.delivery?.status === "pending" ? "completed" : "pending"}?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const newStatus =
                      statusModal.delivery?.status === "pending" ? "completed" : "pending"
                    handleStatusUpdate(statusModal.delivery.id, newStatus)
                  }}
                  className="bg-blue-600 text-white px-4 py-2 rounded flex-1"
                >
                  {statusModal.delivery?.status === "pending" ? "Mark as Completed" : "Mark as Pending"}
                </button>
                <button
                  onClick={() => setStatusModal({ open: false, delivery: null })}
                  className="bg-gray-300 text-gray-800 px-4 py-2 rounded flex-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
