"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import LoadingScreen from "@/components/ui/LoadingScreen"

type InventoryRow = {
  id: string
  name: string
  quantity_on_hand: number
  last_movement_at: string | null
  last_movement_type: string | null
  last_movement_reference_id: string | null
}

export default function ServiceInventoryPage() {
  const router = useRouter()
  const [rows, setRows] = useState<InventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    try {
      setError("")
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setLoading(false)
        return
      }
      const { data, error: qErr } = await supabase
        .from("service_material_inventory")
        .select("id, name, quantity_on_hand")
        .eq("business_id", business.id)
        .order("name", { ascending: true })
      if (qErr) {
        setError(qErr.message || "Failed to load inventory")
        setLoading(false)
        return
      }
      const materials = (data ?? []) as { id: string; name: string; quantity_on_hand: number }[]
      if (materials.length > 0) {
        const { data: movements } = await supabase
          .from("service_material_movements")
          .select("material_id, created_at, movement_type, reference_id")
          .eq("business_id", business.id)
          .in("material_id", materials.map((m) => m.id))
          .order("created_at", { ascending: false })
        const lastByMaterial: Record<string, { created_at: string; movement_type: string; reference_id: string | null }> = {}
        if (movements) {
          for (const m of movements as { material_id: string; created_at: string; movement_type: string; reference_id: string | null }[]) {
            if (lastByMaterial[m.material_id] == null) {
              lastByMaterial[m.material_id] = { created_at: m.created_at, movement_type: m.movement_type, reference_id: m.reference_id ?? null }
            }
          }
        }
        setRows(
          materials.map((m) => {
            const last = lastByMaterial[m.id]
            return {
              id: m.id,
              name: m.name,
              quantity_on_hand: m.quantity_on_hand,
              last_movement_at: last?.created_at ?? null,
              last_movement_type: last?.movement_type ?? null,
              last_movement_reference_id: last?.reference_id ?? null,
            }
          })
        )
      } else {
        setRows([])
      }
      setLoading(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
      setLoading(false)
    }
  }

  if (loading) return <LoadingScreen />

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Service Inventory</h1>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Material name</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Quantity</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Last movement date</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Movement type</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Reference (e.g. project id)</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      No service materials in inventory. Add materials from the Materials page.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{row.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{Number(row.quantity_on_hand ?? 0)}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {row.last_movement_at ? new Date(row.last_movement_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{row.last_movement_type ?? "—"}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 font-mono text-xs">
                        {row.last_movement_reference_id ? (
                          row.last_movement_type === "job_usage" ? (
                            <a
                              href={`/service/jobs/${row.last_movement_reference_id}`}
                              className="text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {row.last_movement_reference_id.slice(0, 8)}…
                            </a>
                          ) : (
                            row.last_movement_reference_id.slice(0, 8) + "…"
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <button
                          onClick={() => router.push(`/service/materials/${row.id}/adjust`)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                        >
                          Adjust
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
