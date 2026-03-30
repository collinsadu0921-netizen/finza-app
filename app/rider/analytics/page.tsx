"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import {
  getBusinessDeliveryStats,
  getDeliveriesPerRider,
  getWeeklyDeliveryCounts,
  getRiderEarningsChart,
  getRouteHeatmap,
  BusinessDeliveryStats,
  DeliveriesPerRider,
  WeeklyDeliveryCount,
  RiderEarningsChart,
  RouteHeatmap,
} from "@/lib/rider"
import { getCurrentBusiness } from "@/lib/business"
import { formatMoney } from "@/lib/money"
import { getCurrencySymbol } from "@/lib/currency"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

export default function AnalyticsPage() {
  const router = useRouter()
  const [stats, setStats] = useState<BusinessDeliveryStats | null>(null)
  const [riderStats, setRiderStats] = useState<DeliveriesPerRider[]>([])
  const [weeklyData, setWeeklyData] = useState<WeeklyDeliveryCount[]>([])
  const [earningsData, setEarningsData] = useState<RiderEarningsChart[]>([])
  const [routeData, setRouteData] = useState<RouteHeatmap[]>([])
  const [loading, setLoading] = useState(true)
  const [currencyCode, setCurrencyCode] = useState("GHS")

  useEffect(() => {
    loadAnalytics()
  }, [])

  const loadAnalytics = async () => {
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

      setCurrencyCode(business.default_currency || "GHS")

      try {
        const [
          statsData,
          riderStatsData,
          weeklyDataResult,
        earningsDataResult,
        routeDataResult,
      ] = await Promise.all([
        getBusinessDeliveryStats(business.id),
        getDeliveriesPerRider(business.id),
        getWeeklyDeliveryCounts(business.id),
        getRiderEarningsChart(business.id),
        getRouteHeatmap(business.id),
      ])

      setStats(statsData)
      setRiderStats(riderStatsData)
      setWeeklyData(weeklyDataResult)
      setEarningsData(earningsDataResult)
      setRouteData(routeDataResult)
      } catch (error) {
        // Error loading analytics
      } finally {
        setLoading(false)
      }
    } catch (err: any) {
      setLoading(false)
    }
  }

  const formatAmount = (amount: number) => formatMoney(amount, currencyCode)
  const earningsLegend = `Earnings (${getCurrencySymbol(currencyCode)})`

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  // Format weekly data for chart
  const weeklyChartData = weeklyData.map((item) => ({
    date: formatDate(item.date),
    deliveries: item.count,
  }))

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
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Rider Analytics</h1>
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="border p-4 rounded-lg">
            <h2 className="text-lg font-semibold">Total Deliveries</h2>
            <p className="text-2xl font-bold mt-2">{stats?.total_deliveries || 0}</p>
          </div>

          <div className="border p-4 rounded-lg">
            <h2 className="text-lg font-semibold">Completed Deliveries</h2>
            <p className="text-2xl font-bold mt-2">{stats?.total_completed || 0}</p>
          </div>

          <div className="border p-4 rounded-lg">
            <h2 className="text-lg font-semibold">Total Fees Earned</h2>
            <p className="text-2xl font-bold mt-2">
              {formatAmount(stats?.total_fees || 0)}
            </p>
          </div>

          <div className="border p-4 rounded-lg">
            <h2 className="text-lg font-semibold">Average Delivery Fee</h2>
            <p className="text-2xl font-bold mt-2">
              {formatAmount(stats?.average_fee || 0)}
            </p>
          </div>
        </div>

        {/* Deliveries Per Rider Table */}
        <div className="mb-6">
          <h2 className="text-xl font-bold mb-4">Deliveries Per Rider</h2>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Rider</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">
                    Completed
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">
                    Total Fees
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">
                    Avg Fee
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">
                    Commission
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">
                    Earnings Owed
                  </th>
                </tr>
              </thead>
              <tbody>
                {riderStats.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No rider data available.
                    </td>
                  </tr>
                ) : (
                  riderStats.map((rider) => (
                    <tr key={rider.rider_id} className="border-t">
                      <td className="px-4 py-3 font-semibold">{rider.rider_name}</td>
                      <td className="px-4 py-3">{rider.completed_deliveries_count}</td>
                      <td className="px-4 py-3">
                        {formatAmount(rider.total_fees)}
                      </td>
                      <td className="px-4 py-3">
                        {formatAmount(rider.average_fee)}
                      </td>
                      <td className="px-4 py-3">
                        {rider.commission_rate !== null
                          ? `${(rider.commission_rate * 100).toFixed(0)}%`
                          : "100%"}
                      </td>
                      <td className="px-4 py-3">
                        {formatAmount(rider.earnings_after_commission)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Weekly Delivery Chart */}
        <div className="mb-6">
          <h2 className="text-xl font-bold mb-4">Weekly Deliveries (Last 7 Days)</h2>
          <div className="border p-4 rounded-lg bg-white">
            {weeklyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={weeklyChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="deliveries" fill="#3b82f6" name="Completed Deliveries" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-gray-500 py-8">
                No delivery data for the last 7 days.
              </p>
            )}
          </div>
        </div>

        {/* Rider Earnings Chart */}
        <div className="mb-6">
          <h2 className="text-xl font-bold mb-4">Rider Earnings</h2>
          <div className="border p-4 rounded-lg bg-white">
            {earningsData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={earningsData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="rider_name" type="category" width={80} />
                  <Tooltip formatter={(value: number) => formatAmount(value)} />
                  <Legend />
                  <Bar
                    dataKey="earnings"
                    fill="#10b981"
                    name={earningsLegend}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-gray-500 py-8">
                No earnings data available.
              </p>
            )}
          </div>
        </div>

        {/* Route Heatmap Table */}
        <div className="mb-6">
          <h2 className="text-xl font-bold mb-4">Popular Delivery Routes</h2>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold">
                    Pickup Location
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">
                    Dropoff Location
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">
                    Delivery Count
                  </th>
                </tr>
              </thead>
              <tbody>
                {routeData.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                      No route data available.
                    </td>
                  </tr>
                ) : (
                  routeData.map((route, index) => (
                    <tr key={index} className="border-t">
                      <td className="px-4 py-3">📍 {route.pickup_location}</td>
                      <td className="px-4 py-3">→ {route.dropoff_location}</td>
                      <td className="px-4 py-3 font-semibold">{route.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}





