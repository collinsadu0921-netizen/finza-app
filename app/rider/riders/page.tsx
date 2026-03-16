"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getRiders, Rider } from "@/lib/rider"
import { getCurrentBusiness } from "@/lib/business"

export default function RidersPage() {
  const router = useRouter()
  const [riders, setRiders] = useState<Rider[]>([])
  const [businessId, setBusinessId] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadRiders()
  }, [])

  const loadRiders = async () => {
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
      const ridersList = await getRiders(business.id)
      setRiders(ridersList)
      setLoading(false)
    } catch (err: any) {
      setLoading(false)
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
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Riders</h1>
          <button
            onClick={() => router.push("/rider/riders/new")}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            + Add Rider
          </button>
        </div>

        {riders.length === 0 && (
          <p className="text-gray-500">No riders added yet.</p>
        )}

        <div className="space-y-2">
          {riders.map((rider) => (
            <div
              key={rider.id}
              className="border p-4 rounded-lg flex justify-between items-center"
            >
              <div>
                <div className="font-semibold">{rider.name}</div>
                <div className="text-sm text-gray-600">{rider.phone}</div>
                <div className="text-sm text-gray-500">
                  {rider.vehicle_type}
                  {rider.commission_rate !== null && (
                    <span className="ml-2">
                      • {((rider.commission_rate || 0) * 100).toFixed(0)}% commission
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => router.push(`/rider/riders/${rider.id}/edit`)}
                className="bg-blue-600 text-white px-4 py-1 rounded text-sm"
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      </div>
    </ProtectedLayout>
  )
}

