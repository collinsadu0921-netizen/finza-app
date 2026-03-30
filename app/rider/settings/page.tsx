"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { updateBusinessRiderPricing, DistanceTier } from "@/lib/rider"
import { getCurrentBusiness } from "@/lib/business"
import { getCurrencySymbol } from "@/lib/currency"

export default function RiderSettingsPage() {
  const router = useRouter()
  const [businessId, setBusinessId] = useState("")
  const [currencySymbol, setCurrencySymbol] = useState("₵")
  const [baseFee, setBaseFee] = useState("")
  const [pricePerKm, setPricePerKm] = useState("")
  const [distanceTiers, setDistanceTiers] = useState<DistanceTier[]>([])
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [loading, setLoading] = useState(true)
  const [businessError, setBusinessError] = useState("")
  const [isRiderBusiness, setIsRiderBusiness] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setError("")
      setBusinessError("")
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setBusinessError("Not logged in")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)

      if (!business) {
        setBusinessError("No business selected. Go back to dashboard.")
        setLoading(false)
        return
      }

      // Check if business is rider type
      if (business.industry !== "rider") {
        setBusinessError("Rider settings are only available for Rider mode businesses.")
        setLoading(false)
        return
      }

      setIsRiderBusiness(true)
      setBusinessId(business.id)
      const code = business.default_currency || "GHS"
      setCurrencySymbol(getCurrencySymbol(code))
      // Use safe defaults with nullish coalescing
      const tiers = business.rider_distance_tiers ?? []
      const baseFeeValue = business.rider_base_fee ?? null
      const pricePerKmValue = business.rider_price_per_km ?? null

      setBaseFee(baseFeeValue != null ? baseFeeValue.toString() : "")
      setPricePerKm(pricePerKmValue != null ? pricePerKmValue.toString() : "")
      setDistanceTiers(
        Array.isArray(tiers) && tiers.length > 0 ? (tiers as DistanceTier[]) : []
      )
      setLoading(false)
    } catch (err: any) {
      setBusinessError(err.message || "Failed to load settings")
      setLoading(false)
    }
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setError("")
    setSuccess("")

    const baseValue = baseFee ? Number(baseFee) : null
    const perKmValue = pricePerKm ? Number(pricePerKm) : null

    if (
      (baseValue !== null && baseValue < 0) ||
      (perKmValue !== null && perKmValue < 0)
    ) {
      setError("Values must be positive numbers")
      return
    }

    // Validate tiers
    for (const tier of distanceTiers) {
      if (tier.min_km < 0 || tier.max_km < 0 || tier.price < 0) {
        setError("Tier values must be positive numbers")
        return
      }
      if (tier.min_km >= tier.max_km) {
        setError("Tier max_km must be greater than min_km")
        return
      }
    }

    if (!businessId) {
      setError("Business ID not found")
      return
    }

    try {
      await updateBusinessRiderPricing(businessId, {
        rider_base_fee: baseValue,
        rider_price_per_km: perKmValue,
        rider_distance_tiers: distanceTiers.length > 0 ? distanceTiers : null,
      })
      setSuccess("Pricing settings saved successfully")
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(""), 3000)
    } catch (err: any) {
      setError(err.message || "Failed to save settings")
    }
  }

  const addTier = () => {
    const maxKm = distanceTiers.length > 0
      ? Math.max(...distanceTiers.map((t) => t.max_km || 0))
      : 0
    setDistanceTiers([
      ...distanceTiers,
      { min_km: maxKm, max_km: maxKm + 5, price: 20 },
    ])
  }

  const removeTier = (index: number) => {
    setDistanceTiers(distanceTiers.filter((_, i) => i !== index))
  }

  const updateTier = (index: number, field: keyof DistanceTier, value: number) => {
    const updated = [...distanceTiers]
    updated[index] = { ...updated[index], [field]: value }
    setDistanceTiers(updated)
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

  // Show error message if business not found or not rider
  if (businessError) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold">Rider Settings</h1>
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
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded mb-4">
            {businessError}
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
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Rider Settings</h1>
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

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
          {/* Delivery Pricing Section (Base Model) */}
          <div className="border rounded-lg p-6 bg-white">
            <h2 className="text-xl font-semibold mb-2">Delivery Pricing</h2>
            <p className="text-sm text-gray-600 mb-6">
              Configure base pricing for distance-based fees. Leave blank to use manual fees.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Base Fee ({currencySymbol})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="border p-2 w-full rounded"
                  placeholder="e.g., 10"
                  value={baseFee}
                  onChange={(e) => setBaseFee(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Maps to businesses.rider_base_fee
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Price Per KM ({currencySymbol})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="border p-2 w-full rounded"
                  placeholder="e.g., 2"
                  value={pricePerKm}
                  onChange={(e) => setPricePerKm(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Maps to businesses.rider_price_per_km
                </p>
              </div>
            </div>
          </div>

          {/* Fixed Distance Pricing Tiers */}
          <div className="border rounded-lg p-6 bg-white">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-xl font-semibold mb-2">Fixed Distance Pricing Tiers</h2>
                <p className="text-sm text-gray-600">
                  Set fixed prices for distance ranges. If configured, this takes priority over
                  per-km pricing. Stored in businesses.rider_distance_tiers (jsonb).
                </p>
              </div>
            </div>

            {distanceTiers.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                <p className="text-gray-500 mb-4">No pricing tiers configured</p>
                <button
                  type="button"
                  onClick={addTier}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                >
                  + Add Tier
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Min km</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Max km</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Price ({currencySymbol})</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {distanceTiers.map((tier, index) => (
                        <tr key={index} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              className="border p-2 w-full rounded text-sm"
                              value={tier.min_km}
                              onChange={(e) =>
                                updateTier(index, "min_km", Number(e.target.value))
                              }
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              className="border p-2 w-full rounded text-sm"
                              value={tier.max_km}
                              onChange={(e) =>
                                updateTier(index, "max_km", Number(e.target.value))
                              }
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="border p-2 w-full rounded text-sm"
                              value={tier.price}
                              onChange={(e) =>
                                updateTier(index, "price", Number(e.target.value))
                              }
                            />
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => removeTier(index)}
                              className="text-red-600 text-sm hover:text-red-800 font-medium"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={addTier}
                  className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300"
                >
                  + Add Tier
                </button>
              </div>
            )}
          </div>

          {/* Save Changes Button */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="bg-gray-300 text-gray-800 px-6 py-2 rounded hover:bg-gray-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 flex-1"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </ProtectedLayout>
  )
}

