"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { createRider } from "@/lib/rider"
import { getCurrentBusiness } from "@/lib/business"

export default function NewRiderPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [vehicleType, setVehicleType] = useState("motorbike")
  const [commissionRate, setCommissionRate] = useState("")
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")

  useEffect(() => {
    loadBusiness()
  }, [])

  const loadBusiness = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)

      if (business) {
        setBusinessId(business.id)
      }
    } catch (err: any) {
      // Error loading business
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!name || !phone || !businessId) {
      setError("Please fill in all required fields")
      return
    }

    // Validate commission rate if provided
    if (commissionRate) {
      const rate = Number(commissionRate)
      if (isNaN(rate) || rate < 0 || rate > 100) {
        setError("Commission must be between 0–100%")
        return
      }
    }

    try {
      // Convert percentage to decimal
      const decimalRate = commissionRate
        ? Number(commissionRate) / 100
        : null

      await createRider({
        business_id: businessId,
        name,
        phone,
        vehicle_type: vehicleType,
        commission_rate: decimalRate,
      })
      router.push("/rider/riders")
    } catch (err: any) {
      setError(err.message || "Failed to create rider")
    }
  }

  return (
    <ProtectedLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Add Rider</h1>

        {error && <p className="text-red-500 mb-3">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            className="border p-2 w-full"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <input
            className="border p-2 w-full"
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />

          <select
            className="border p-2 w-full"
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value)}
            required
          >
            <option value="motorbike">Motorbike</option>
            <option value="bicycle">Bicycle</option>
            <option value="car">Car</option>
            <option value="truck">Truck</option>
          </select>

          <div>
            <label className="block text-sm font-medium mb-1">
              Commission Rate % (optional)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              className="border p-2 w-full rounded"
              placeholder="e.g., 80 for 80% (leave empty for 100%)"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">
              Enter a percentage from 0 to 100. Leave empty for 100% commission.
            </p>
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
              Save
            </button>
          </div>
        </form>
      </div>
    </ProtectedLayout>
  )
}

