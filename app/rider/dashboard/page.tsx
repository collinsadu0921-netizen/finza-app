"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getRiderStats, getRecentDeliveries, RiderStats } from "@/lib/rider"
import { getCurrentBusiness } from "@/lib/business"
import { formatMoney, formatMoneyWithCode } from "@/lib/money"

export default function RiderDashboardPage() {
  const router = useRouter()
  const [stats, setStats] = useState<RiderStats>({
    total_riders: 0,
    deliveries_today: 0,
    fees_today: 0,
  })
  const [recentDeliveries, setRecentDeliveries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState("")
  const [business, setBusiness] = useState<any>(null)

  useEffect(() => {
    loadDashboard()
  }, [])

  const loadDashboard = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      const businessData = await getCurrentBusiness(supabase, user.id)

      if (!businessData) {
        setLoading(false)
        return
      }

      setBusiness(businessData)
      setBusinessId(businessData.id)

      // Load stats and recent deliveries
      const [statsData, recentData] = await Promise.all([
        getRiderStats(businessData.id),
        getRecentDeliveries(businessData.id, 10),
      ])

      setStats(statsData)
      setRecentDeliveries(recentData)
      setLoading(false)
    } catch (err: any) {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
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

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="p-6">
        {/* Currency Setup Banner */}
        {!business?.default_currency && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-300 mb-1">Currency Not Configured</h3>
                <p className="text-sm text-yellow-700 dark:text-yellow-400 mb-3">
                  Please set your business currency in Business Profile to display amounts correctly.
                </p>
                <button
                  onClick={() => router.push("/settings/business-profile")}
                  className="text-sm font-medium text-yellow-800 dark:text-yellow-300 hover:text-yellow-900 dark:hover:text-yellow-200 underline"
                >
                  Go to Business Profile →
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Rider Dashboard</h1>
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

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="border p-4 rounded-lg">
            <h2 className="text-lg font-semibold">Total Riders</h2>
            <p className="text-2xl font-bold mt-2">{stats.total_riders}</p>
          </div>

          <div className="border p-4 rounded-lg">
            <h2 className="text-lg font-semibold">Deliveries Today</h2>
            <p className="text-2xl font-bold mt-2">{stats.deliveries_today}</p>
          </div>

          <div className="border p-4 rounded-lg">
            <h2 className="text-lg font-semibold">Fees Collected Today</h2>
            <p className="text-2xl font-bold mt-2">{formatMoney(stats.fees_today, business?.default_currency)}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
          <a
            href="/rider/deliveries/new"
            className="border p-4 rounded-lg bg-blue-600 text-white text-center flex items-center justify-center"
          >
            + New Delivery
          </a>

          <a
            href="/rider/deliveries"
            className="border p-4 rounded-lg bg-gray-600 text-white text-center flex items-center justify-center"
          >
            View All Deliveries
          </a>

          <a
            href="/rider/riders"
            className="border p-4 rounded-lg bg-green-600 text-white text-center flex items-center justify-center"
          >
            View Riders
          </a>

          <a
            href="/rider/payouts"
            className="border p-4 rounded-lg bg-purple-600 text-white text-center flex items-center justify-center"
          >
            View Payouts
          </a>

          <a
            href="/rider/analytics"
            className="border p-4 rounded-lg bg-indigo-600 text-white text-center flex items-center justify-center"
          >
            Analytics
          </a>

          <a
            href="/rider/settings"
            className="border p-4 rounded-lg bg-yellow-500 text-white text-center flex items-center justify-center"
          >
            Settings
          </a>
        </div>

        {/* Recent Deliveries */}
        <h2 className="text-xl font-bold mb-2">Recent Deliveries</h2>

        <div className="space-y-2">
          {recentDeliveries.length === 0 && (
            <p className="text-gray-500">No deliveries yet.</p>
          )}

          {recentDeliveries.map((delivery) => (
            <div
              key={delivery.id}
              className="border p-4 rounded-lg"
            >
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
                <span
                  className={`px-2 py-1 rounded text-xs font-semibold ${getStatusBadgeClass(
                    delivery.status
                  )}`}
                >
                  {delivery.status}
                </span>
              </div>
              <div className="text-sm text-gray-700 mb-2">
                <div>📍 {delivery.pickup_location}</div>
                <div>→ {delivery.dropoff_location}</div>
              </div>
              <div className="flex justify-between items-center">
                <div>
                  <span className="font-bold">{formatMoney(delivery.fee, business?.default_currency)}</span>
                  <span className="text-sm text-gray-500 ml-2">
                    {delivery.payment_method}
                  </span>
                </div>
                <span className="text-sm text-gray-500">
                  {formatDate(delivery.created_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ProtectedLayout>
  )
}

