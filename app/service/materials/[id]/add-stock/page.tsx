"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"
import { STOCK_IN_REASONS } from "@/lib/service/materialMovementLabels"

export default function ServiceMaterialAddStockPage() {
  const router = useRouter()
  const params = useParams()
  const id = typeof params?.id === "string" ? params.id : ""
  const [materialName, setMaterialName] = useState("")
  const [unit, setUnit] = useState("")
  const [onHand, setOnHand] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [quantity, setQuantity] = useState("")
  const [costPrice, setCostPrice] = useState("")
  const [reason, setReason] = useState("bought_material")
  const [movementDate, setMovementDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState("")

  useEffect(() => {
    if (!id) return
    fetch(`/api/service/materials/inventory/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.material) {
          setMaterialName(d.material.name)
          setUnit(d.material.unit)
          setOnHand(Number(d.material.quantity_on_hand ?? 0))
          const cp = d.material.default_cost_price ?? d.material.average_cost
          if (cp != null && cp > 0) setCostPrice(String(cp))
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSaving(true)
    try {
      const res = await fetch(`/api/service/materials/inventory/${id}/add-stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: parseFloat(quantity),
          cost_price_per_unit: costPrice.trim() ? parseFloat(costPrice) : null,
          reason,
          movement_date: movementDate,
          note: note.trim() || null,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "Failed to add stock")
      router.push(`/service/materials/${id}/history`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add stock")
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-lg mx-auto px-4 py-8">
        <PageHeader title="Add stock" subtitle={materialName}
          actions={<Button variant="outline" onClick={() => router.back()}>Back</Button>} />
        <p className="text-sm text-slate-600 mb-4">Quantity available: <strong>{onHand} {unit}</strong></p>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="bg-white border rounded-xl shadow p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Quantity added *</label>
            <input type="number" step="0.01" min="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} required disabled={saving}
              className="w-full border rounded-lg px-4 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cost price per unit</label>
            <input type="number" step="0.01" min="0" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} disabled={saving}
              className="w-full border rounded-lg px-4 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reason *</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving}
              className="w-full border rounded-lg px-4 py-2">
              {STOCK_IN_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} disabled={saving}
              className="w-full border rounded-lg px-4 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Note</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={saving}
              className="w-full border rounded-lg px-4 py-2" />
          </div>
          <Button type="submit" disabled={saving} className="w-full">{saving ? "Saving…" : "Add stock"}</Button>
        </form>
      </div>
    </div>
  )
}
