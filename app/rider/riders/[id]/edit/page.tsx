"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getRiderById, updateRider, Rider } from "@/lib/rider"

export default function EditRiderPage() {
  const router = useRouter()
  const params = useParams()
  const riderId = params.id as string

  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [vehicleType, setVehicleType] = useState("motorbike")
  const [commissionRate, setCommissionRate] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadRider()
  }, [riderId])

  const loadRider = async () => {
    try {
      const rider = await getRiderById(riderId)
      setName(rider.name)
      setPhone(rider.phone)
      setVehicleType(rider.vehicle_type)
      // Convert decimal to percentage for display
      const percent = rider.commission_rate
        ? (rider.commission_rate * 100).toString()
        : ""
      setCommissionRate(percent)
    } catch (err: any) {
      setError(err.message || "Failed to load rider")
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!name || !phone) {
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

      await updateRider(riderId, {
        name,
        phone,
        vehicle_type: vehicleType,
        commission_rate: decimalRate,
      })
      router.push("/rider/riders")
    } catch (err: any) {
      setError(err.message || "Failed to update rider")
    }
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
        <h1 className="text-2xl font-bold mb-4">Edit Rider</h1>

        {error && <p className="text-red-500 mb-3">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              className="border p-2 w-full rounded"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input
              className="border p-2 w-full rounded"
              placeholder="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Vehicle Type</label>
            <select
              className="border p-2 w-full rounded"
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
              required
            >
              <option value="motorbike">Motorbike</option>
              <option value="bicycle">Bicycle</option>
              <option value="car">Car</option>
              <option value="truck">Truck</option>
            </select>
          </div>

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
              Update Rider
            </button>
          </div>
        </form>
      </div>
    </ProtectedLayout>
  )
}

