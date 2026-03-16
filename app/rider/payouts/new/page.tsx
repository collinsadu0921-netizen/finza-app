"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, useSearchParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getRiders, createPayout, Rider } from "@/lib/rider"
import { getCurrentBusiness } from "@/lib/business"

import { Suspense } from "react"

function NewPayoutContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const riderIdParam = searchParams.get("rid")

  const [riders, setRiders] = useState<Rider[]>([])
  const [riderId, setRiderId] = useState(riderIdParam || "")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (riderIdParam) {
      setRiderId(riderIdParam)
    }
  }, [riderIdParam])

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)

      if (!business) return

      setBusinessId(business.id)
      const ridersList = await getRiders(business.id)
      setRiders(ridersList)
    } catch (err: any) {
      // Error loading data
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!riderId || !amount || !businessId) {
      setError("Please fill in all required fields")
      return
    }

    try {
      await createPayout({
        business_id: businessId,
        rider_id: riderId,
        amount: Number(amount),
        note: note || undefined,
      })
      router.push("/rider/payouts")
    } catch (err: any) {
      setError(err.message || "Failed to create payout")
    }
  }

  return (
    <ProtectedLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">New Payout</h1>

        {error && <p className="text-red-500 mb-3">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium mb-1">Rider</label>
            <select
              className="border p-2 w-full rounded"
              value={riderId}
              onChange={(e) => setRiderId(e.target.value)}
              required
            >
              <option value="">Select Rider</option>
              {riders.map((rider) => (
                <option key={rider.id} value={rider.id}>
                  {rider.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Amount (GHS)</label>
            <input
              type="number"
              step="0.01"
              className="border p-2 w-full rounded"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Note (optional)</label>
            <textarea
              className="border p-2 w-full rounded"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note about this payout..."
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded flex-1"
            >
              Create Payout
            </button>
          </div>
        </form>
      </div>
    </ProtectedLayout>
  )
}

export default function NewPayoutPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <NewPayoutContent />
    </Suspense>
  )
}





