"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { getActiveFirmId } from "@/lib/accounting/firm/session"

type StaffRow = { user_id: string; role: string; name: string; assigned_count: number }

export default function AssignmentEnforcementBanner() {
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [firmId, setFirmId] = useState<string | null>(null)
  const [effectiveCount, setEffectiveCount] = useState(0)
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const active = getActiveFirmId()
      const qs = active ? `?firm_id=${encodeURIComponent(active)}` : ""
      const res = await fetch(`/api/accounting/firm/assignment-scope${qs}`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCanManage(false)
        return
      }
      setFirmId(data.firm_id ?? active)
      setCanManage(Boolean(data.can_manage))
      setEnabled(Boolean(data.enabled))
      setEffectiveCount(data.effective_client_count ?? 0)
      setStaff(data.restricted_staff ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function enable() {
    if (!firmId) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/accounting/firm/assignment-scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firm_id: firmId, enabled: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Failed to enable assignment controls")
        return
      }
      setConfirming(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (loading || !canManage || enabled) return null

  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-medium">Client assignment is not enforced yet.</p>
      <p className="mt-1 text-amber-900">
        Senior, Junior and Readonly members currently retain access to all engaged clients.
      </p>
      {error && <p className="mt-2 text-red-700">{error}</p>}
      {confirming ? (
        <div className="mt-3 space-y-2">
          <p>
            {staff.length} restricted staff · {effectiveCount} effective clients
          </p>
          <ul className="space-y-1">
            {staff.map((row) => (
              <li key={row.user_id}>
                {row.name} — assigned {row.assigned_count} of {effectiveCount}
              </li>
            ))}
          </ul>
          <p>Enabling assignments will restrict staff to their assigned clients.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={enable}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              Enable assignment controls
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/accounting/clients"
            className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium"
          >
            Review assignments
          </Link>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white"
          >
            Enable assignment controls
          </button>
        </div>
      )}
    </div>
  )
}
