"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"

type MovementRow = {
  id: string
  date: string
  action: string
  quantity: number
  cost: number
  reason: string
  note: string | null
}

export default function ServiceMaterialHistoryPage() {
  const router = useRouter()
  const params = useParams()
  const id = typeof params?.id === "string" ? params.id : ""
  const { format } = useBusinessCurrency()
  const [materialName, setMaterialName] = useState("")
  const [unit, setUnit] = useState("")
  const [rows, setRows] = useState<MovementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!id) return
    fetch(`/api/service/materials/inventory/${id}/movements`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(typeof d.error === "string" ? d.error : "Failed to load")
        setMaterialName(d.material?.name ?? "")
        setUnit(d.material?.unit ?? "")
        setRows(d.movements ?? [])
        setLoading(false)
      })
      .catch((e) => {
        setError(e.message || "Failed to load")
        setLoading(false)
      })
  }, [id])

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
        <PageHeader title="Stock history" subtitle={materialName}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => router.push(`/service/materials/${id}/add-stock`)}>Add stock</Button>
              <Button variant="outline" onClick={() => router.push("/service/materials")}>Back</Button>
            </div>
          } />
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>}

        {rows.length === 0 ? (
          <div className="bg-white border rounded-xl p-8 text-center text-slate-500 text-sm">No stock history yet.</div>
        ) : (
          <div className="bg-white border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3 text-right">Quantity</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {new Date(row.date).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">{row.action}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.quantity > 0 ? "+" : ""}{row.quantity} {unit}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{format(row.cost)}</td>
                    <td className="px-4 py-3">{row.reason}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">{row.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
