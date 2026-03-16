"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import {
  getRiders,
  createDelivery,
  calculateDeliveryFee,
  DistanceTier,
} from "@/lib/rider"
import { getCurrentBusiness } from "@/lib/business"

export default function NewDeliveryPage() {
  const router = useRouter()
  const [riders, setRiders] = useState<any[]>([])
  const [riderId, setRiderId] = useState("")
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [pickupLocation, setPickupLocation] = useState("")
  const [dropoffLocation, setDropoffLocation] = useState("")
  const [fee, setFee] = useState("")
  const [distance, setDistance] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [pricing, setPricing] = useState<{
    base: number | null
    perKm: number | null
    tiers: DistanceTier[] | null
  }>({ base: null, perKm: null, tiers: null })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setError("Not logged in")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)

      if (!business) {
        setError("No business selected")
        setLoading(false)
        return
      }

      setBusinessId(business.id)
      // Use safe defaults - don't block rendering if values are null
      const tiers = business.rider_distance_tiers ?? []
      const baseFeeValue = business.rider_base_fee ?? null
      const pricePerKmValue = business.rider_price_per_km ?? null

      setPricing({
        base: baseFeeValue != null ? Number(baseFeeValue) : null,
        perKm: pricePerKmValue != null ? Number(pricePerKmValue) : null,
        tiers: Array.isArray(tiers) && tiers.length > 0 ? (tiers as DistanceTier[]) : null,
      })
      const ridersList = await getRiders(business.id)
      setRiders(ridersList)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load data")
      setLoading(false)
    }
  }

  const computeFeeBreakdown = () => {
    try {
      const numericDistance = distance ? Number(distance) : null
      // Handle NaN from invalid input
      if (numericDistance !== null && isNaN(numericDistance)) {
        return {
          base_fee: 0,
          distance_fee: 0,
          total_fee: Number(fee) || 0,
          pricing_model: "manual" as const,
        }
      }

      const manualFee = fee ? Number(fee) : null
      // Handle NaN from invalid input
      if (manualFee !== null && isNaN(manualFee)) {
        return {
          base_fee: 0,
          distance_fee: 0,
          total_fee: 0,
          pricing_model: "manual" as const,
        }
      }

      return calculateDeliveryFee(
        numericDistance,
        pricing.base,
        pricing.perKm,
        pricing.tiers,
        manualFee
      )
    } catch (err) {
      // Fallback to manual fee if calculation fails
      return {
        base_fee: Number(fee) || 0,
        distance_fee: 0,
        total_fee: Number(fee) || 0,
        pricing_model: "manual" as const,
      }
    }
  }

  const feePreview = computeFeeBreakdown()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!riderId || !customerName || !pickupLocation || !dropoffLocation || !fee) {
      setError("Please fill in all required fields")
      return
    }

    if (!businessId) {
      setError("Business ID not found")
      return
    }

    // Safely parse numeric inputs
    const numericDistance = distance ? Number(distance) : null
    const manualFee = Number(fee)

    // Validate inputs
    if (isNaN(manualFee) || manualFee < 0) {
      setError("Invalid delivery fee")
      return
    }

    if (numericDistance !== null && (isNaN(numericDistance) || numericDistance < 0)) {
      setError("Invalid distance")
      return
    }

      // Calculate fees safely
      let baseFee = 0
      let distanceFee = 0
      let totalFee = manualFee

      try {
        const breakdown = computeFeeBreakdown()
        baseFee = breakdown.base_fee
        distanceFee = breakdown.distance_fee
        totalFee = breakdown.total_fee || manualFee
      } catch (err) {
        // Fallback to manual fee if calculation fails
        baseFee = manualFee
        distanceFee = 0
        totalFee = manualFee
      }

    try {
      await createDelivery({
        rider_id: riderId,
        business_id: businessId,
        customer_name: customerName,
        customer_phone: customerPhone,
        pickup_location: pickupLocation,
        dropoff_location: dropoffLocation,
        fee: totalFee, // Use calculated total or manual fee
        distance_km: numericDistance,
        base_fee: baseFee,
        distance_fee: distanceFee,
        total_fee: totalFee,
        payment_method: paymentMethod,
        status: "pending",
      })
      router.push("/rider/deliveries")
    } catch (err: any) {
      setError(err.message || "Failed to create delivery")
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

  if (!businessId && error === "No business selected") {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-4">New Delivery</h1>
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded mb-4">
            No business selected. Please go back to the dashboard.
          </div>
          <button
            onClick={() => router.push("/dashboard")}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            Go to Dashboard
          </button>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">New Delivery</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* TODO: Auto-calculate distance using pickup/dropoff when geocoding is available. */}
          <select
            className="border p-2 w-full"
            value={riderId}
            onChange={(e) => setRiderId(e.target.value)}
            required
          >
            <option value="">Select Rider</option>
            {riders.map((rider) => (
              <option key={rider.id} value={rider.id}>
                {rider.name} ({rider.vehicle_type})
              </option>
            ))}
          </select>

          <input
            className="border p-2 w-full"
            placeholder="Customer Name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            required
          />

          <input
            className="border p-2 w-full"
            placeholder="Customer Phone"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
          />

          <input
            className="border p-2 w-full"
            placeholder="Pickup Location"
            value={pickupLocation}
            onChange={(e) => setPickupLocation(e.target.value)}
            required
          />

          <input
            className="border p-2 w-full"
            placeholder="Dropoff Location"
            value={dropoffLocation}
            onChange={(e) => setDropoffLocation(e.target.value)}
            required
          />

          <input
            className="border p-2 w-full"
            type="number"
            placeholder="Delivery Fee (GHS)"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            required
          />

          <input
            className="border p-2 w-full"
            type="number"
            step="0.1"
            placeholder="Distance (km)"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
          />

          <div className="bg-gray-50 border rounded p-3 text-sm text-gray-700 space-y-1">
            {feePreview.pricing_model === "tier" && feePreview.tier_info ? (
              <>
                <p className="font-semibold text-blue-600">
                  Pricing Tier Applied: {feePreview.tier_info.min_km}–{feePreview.tier_info.max_km} km → GHS{" "}
                  {(feePreview.total_fee || 0).toFixed(2)}
                </p>
              </>
            ) : feePreview.pricing_model === "per_km" ? (
              <>
                <p>Base fee: GHS {(feePreview.base_fee || 0).toFixed(2)}</p>
                <p>Distance fee: GHS {(feePreview.distance_fee || 0).toFixed(2)}</p>
                <p className="font-semibold">
                  Total fee: GHS {(feePreview.total_fee || 0).toFixed(2)}
                </p>
              </>
            ) : (
              <p className="font-semibold">
                Manual fee: GHS {(feePreview.total_fee || 0).toFixed(2)}
              </p>
            )}
          </div>

          <select
            className="border p-2 w-full"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            required
          >
            <option value="cash">Cash</option>
            <option value="momo">MoMo</option>
            <option value="card">Card</option>
          </select>

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
              Save Delivery
            </button>
          </div>
        </form>
      </div>
    </ProtectedLayout>
  )
}

