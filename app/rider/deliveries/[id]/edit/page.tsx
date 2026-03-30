"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import {
  getDeliveryById,
  getRiders,
  updateDelivery,
  Rider,
  calculateDeliveryFee,
  DistanceTier,
} from "@/lib/rider"
import { getCurrentBusiness } from "@/lib/business"
import { formatMoney } from "@/lib/money"
import { getCurrencySymbol } from "@/lib/currency"

export default function EditDeliveryPage() {
  const router = useRouter()
  const params = useParams()
  const deliveryId = params.id as string

  const [riders, setRiders] = useState<Rider[]>([])
  const [riderId, setRiderId] = useState("")
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [pickupLocation, setPickupLocation] = useState("")
  const [dropoffLocation, setDropoffLocation] = useState("")
  const [fee, setFee] = useState("")
  const [distance, setDistance] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [status, setStatus] = useState("pending")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState("")
  const [pricing, setPricing] = useState<{
    base: number | null
    perKm: number | null
    tiers: DistanceTier[] | null
  }>({ base: null, perKm: null, tiers: null })
  const [existingBaseFee, setExistingBaseFee] = useState<number | null>(null)
  const [existingDistanceFee, setExistingDistanceFee] = useState<number | null>(null)
  const [existingTotalFee, setExistingTotalFee] = useState<number | null>(null)
  const [currencyCode, setCurrencyCode] = useState("GHS")

  useEffect(() => {
    loadData()
  }, [deliveryId])

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
      setCurrencyCode(business.default_currency || "GHS")
      // Use safe defaults - don't block rendering if values are null
      const tiers = business.rider_distance_tiers ?? []
      const baseFeeValue = business.rider_base_fee ?? null
      const pricePerKmValue = business.rider_price_per_km ?? null

      setPricing({
        base: baseFeeValue ?? null,
        perKm: pricePerKmValue ?? null,
        tiers: Array.isArray(tiers) && tiers.length > 0 ? (tiers as DistanceTier[]) : null,
      })

      try {
        const [delivery, ridersList] = await Promise.all([
          getDeliveryById(deliveryId),
          getRiders(business.id),
        ])

        setRiders(ridersList)
        setRiderId(delivery.rider_id)
        setCustomerName(delivery.customer_name)
        setCustomerPhone(delivery.customer_phone || "")
        setPickupLocation(delivery.pickup_location)
        setDropoffLocation(delivery.dropoff_location)
        setFee(delivery.fee?.toString() || "")
        setDistance(delivery.distance_km?.toString() || "")
        setPaymentMethod(delivery.payment_method)
        setStatus(delivery.status)
        setExistingBaseFee(delivery.base_fee ?? null)
        setExistingDistanceFee(delivery.distance_fee ?? null)
        setExistingTotalFee(delivery.total_fee ?? null)
      } catch (err: any) {
        setError(err.message || "Failed to load delivery")
      } finally {
        setLoading(false)
      }
    } catch (err: any) {
      setError(err.message || "Failed to load data")
      setLoading(false)
    }
  }

  const computeFeeBreakdown = () => {
    const numericDistance = distance ? Number(distance) : null
    const manualFee = Number(fee || 0)

    // Use existing values if available and distance hasn't changed
    if (
      existingTotalFee !== null &&
      existingBaseFee !== null &&
      existingDistanceFee !== null &&
      numericDistance === null
    ) {
      return {
        base_fee: existingBaseFee,
        distance_fee: existingDistanceFee,
        total_fee: existingTotalFee,
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
  }

  const feePreview = computeFeeBreakdown()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!riderId || !customerName || !pickupLocation || !dropoffLocation || !fee) {
      setError("Please fill in all required fields")
      return
    }

    const numericDistance = distance ? Number(distance) : null
    const breakdown = computeFeeBreakdown()

    try {
      await updateDelivery(deliveryId, {
        rider_id: riderId,
        customer_name: customerName,
        customer_phone: customerPhone,
        pickup_location: pickupLocation,
        dropoff_location: dropoffLocation,
        fee: Number(fee),
        distance_km: numericDistance,
        base_fee: breakdown.base_fee,
        distance_fee: breakdown.distance_fee,
        total_fee: breakdown.total_fee,
        payment_method: paymentMethod,
        status,
      })
      router.push("/rider/deliveries")
    } catch (err: any) {
      setError(err.message || "Failed to update delivery")
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
          <h1 className="text-2xl font-bold mb-4">Edit Delivery</h1>
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
        <h1 className="text-2xl font-bold mb-4">Edit Delivery</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          {/* TODO: Replace manual distance entry with auto-calculated routes once mapping is available. */}
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
                  {rider.name} ({rider.vehicle_type})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Customer Name</label>
            <input
              className="border p-2 w-full rounded"
              placeholder="Customer Name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Customer Phone</label>
            <input
              className="border p-2 w-full rounded"
              placeholder="Customer Phone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Pickup Location</label>
            <input
              className="border p-2 w-full rounded"
              placeholder="Pickup Location"
              value={pickupLocation}
              onChange={(e) => setPickupLocation(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Dropoff Location</label>
            <input
              className="border p-2 w-full rounded"
              placeholder="Dropoff Location"
              value={dropoffLocation}
              onChange={(e) => setDropoffLocation(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Delivery Fee ({getCurrencySymbol(currencyCode)})
            </label>
            <input
              type="number"
              step="0.01"
              className="border p-2 w-full rounded"
              placeholder="0.00"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Distance (km)</label>
            <input
              type="number"
              step="0.1"
              className="border p-2 w-full rounded"
              placeholder="Distance"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
          </div>

          <div className="bg-gray-50 border rounded p-3 text-sm text-gray-700 space-y-1">
            {feePreview.pricing_model === "tier" && feePreview.tier_info ? (
              <>
                <p className="font-semibold text-blue-600">
                  Pricing Tier Applied: {feePreview.tier_info.min_km}–{feePreview.tier_info.max_km} km →{" "}
                  {formatMoney(feePreview.total_fee, currencyCode)}
                </p>
              </>
            ) : feePreview.pricing_model === "per_km" ? (
              <>
                <p>Base fee: {formatMoney(feePreview.base_fee, currencyCode)}</p>
                <p>Distance fee: {formatMoney(feePreview.distance_fee, currencyCode)}</p>
                <p className="font-semibold">
                  Total fee: {formatMoney(feePreview.total_fee, currencyCode)}
                </p>
              </>
            ) : (
              <p className="font-semibold">
                Manual fee: {formatMoney(feePreview.total_fee, currencyCode)}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Payment Method</label>
            <select
              className="border p-2 w-full rounded"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              required
            >
              <option value="cash">Cash</option>
              <option value="momo">MoMo</option>
              <option value="card">Card</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Status</label>
            <select
              className="border p-2 w-full rounded"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              required
            >
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
            </select>
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
              Update Delivery
            </button>
          </div>
        </form>
      </div>
    </ProtectedLayout>
  )
}

