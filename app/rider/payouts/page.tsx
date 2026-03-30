"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getRiderBalances, RiderBalance } from "@/lib/rider"
import { getCurrentBusiness } from "@/lib/business"
import { formatMoney } from "@/lib/money"

export default function PayoutsPage() {
  const router = useRouter()
  const [balances, setBalances] = useState<RiderBalance[]>([])
  const [currencyCode, setCurrencyCode] = useState("GHS")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadBalances()
  }, [])

  const loadBalances = async () => {
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
        const balancesList = await getRiderBalances(business.id)
        setBalances(balancesList)
      } catch (error) {
        // Error loading balances
      } finally {
        setLoading(false)
      }
    } catch (err: any) {
      setLoading(false)
    }
  }

  const formatAmount = (amount: number) => formatMoney(amount, currencyCode)

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
          <h1 className="text-2xl font-bold">Rider Payouts</h1>
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
            <h2 className="text-lg font-semibold">Total Earned</h2>
            <p className="text-2xl font-bold mt-2">
              {formatAmount(balances.reduce((sum, b) => sum + b.earned, 0))}
            </p>
          </div>
          <div className="border p-4 rounded-lg">
            <h2 className="text-lg font-semibold">Total Paid</h2>
            <p className="text-2xl font-bold mt-2">
              {formatAmount(balances.reduce((sum, b) => sum + b.paid, 0))}
            </p>
          </div>
          <div className="border p-4 rounded-lg">
            <h2 className="text-lg font-semibold">Total Owed</h2>
            <p className="text-2xl font-bold mt-2">
              {formatAmount(balances.reduce((sum, b) => sum + b.balance, 0))}
            </p>
          </div>
        </div>

        {/* Riders Table */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold">Rider</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Earned</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Paid</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Balance</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {balances.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No riders found.
                  </td>
                </tr>
              ) : (
                balances.map((balance) => (
                  <tr key={balance.rider_id} className="border-t">
                    <td className="px-4 py-3">{balance.name}</td>
                    <td className="px-4 py-3">{formatAmount(balance.earned)}</td>
                    <td className="px-4 py-3">{formatAmount(balance.paid)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          balance.balance > 0
                            ? "text-green-600 font-semibold"
                            : "text-gray-600"
                        }
                      >
                        {formatAmount(balance.balance)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          router.push(`/rider/payouts/new?rid=${balance.rider_id}`)
                        }
                        className="bg-blue-600 text-white px-4 py-1 rounded text-sm"
                      >
                        Make Payout
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ProtectedLayout>
  )
}





