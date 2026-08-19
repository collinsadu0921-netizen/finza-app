"use client"

import { useCallback, useEffect, useState } from "react"
import { getActiveFirmId } from "@/lib/accounting/firm/session"

type StaffRow = {
  user_id: string
  role: string
  name: string
  assigned: boolean
}

export default function ClientAssignmentPanel({ businessId }: { businessId: string }) {
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const firmId = getActiveFirmId()
      const qs = firmId ? `?firm_id=${encodeURIComponent(firmId)}` : ""
      const res = await fetch(`/api/accounting/clients/${businessId}/assignments${qs}`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Unable to load assignments")
        setStaff([])
        return
      }
      const rows: StaffRow[] = data.staff ?? []
      setStaff(rows)
      setSelected(rows.filter((row) => row.assigned).map((row) => row.user_id))
      setCanManage(Boolean(data.can_manage))
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    setSaving(true)
    setError("")
    try {
      const firmId = getActiveFirmId()
      const res = await fetch(`/api/accounting/clients/${businessId}/assignments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firm_id: firmId, user_ids: selected }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Failed to save assignments")
        return
      }
      setEditing(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const assigned = staff.filter((row) => row.assigned)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Assigned staff</h3>
          <p className="text-xs text-gray-500">Who may work on this client.</p>
        </div>
        {canManage && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Manage
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : editing ? (
        <div className="space-y-2">
          {staff.length === 0 ? (
            <p className="text-sm text-gray-500">No firm members to assign.</p>
          ) : (
            staff.map((row) => (
              <label key={row.user_id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <span className="font-medium text-gray-900">{row.name}</span>
                  <span className="ml-2 capitalize text-gray-500">{row.role}</span>
                </span>
                <input
                  type="checkbox"
                  checked={selected.includes(row.user_id)}
                  onChange={(e) => {
                    setSelected((current) =>
                      e.target.checked
                        ? [...current, row.user_id]
                        : current.filter((id) => id !== row.user_id)
                    )
                  }}
                />
              </label>
            ))
          )}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              Save assignments
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setSelected(assigned.map((row) => row.user_id))
              }}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : assigned.length === 0 ? (
        <p className="text-sm text-gray-500">No staff assigned yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {assigned.map((row) => (
            <li key={row.user_id} className="text-gray-800">
              {row.name}
              <span className="ml-2 capitalize text-gray-500">{row.role}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
