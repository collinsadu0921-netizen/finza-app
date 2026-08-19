"use client"

import { useCallback, useEffect, useState } from "react"
import { getActiveFirmId } from "@/lib/accounting/firm/session"
import {
  practiceStaffRoleDescription,
  practiceStaffRoleLabel,
  type PracticeStaffRole,
  type SafeStaffInvitation,
} from "@/lib/accounting/firm/staffInvitations"

type StaffMember = {
  user_id: string
  name: string
  role: string
  assigned_client_count: number
}

const INVITE_ROLES: PracticeStaffRole[] = ["senior", "junior", "readonly", "partner"]

type Props = {
  firmRole: string | null
  staff: StaffMember[]
  onStaffChange: () => void
}

export function FirmTeamPanel({ firmRole, staff, onStaffChange }: Props) {
  const isPartner = firmRole === "partner"
  const [invitations, setInvitations] = useState<SafeStaffInvitation[]>([])
  const [loadingInvites, setLoadingInvites] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<PracticeStaffRole>("senior")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const loadInvitations = useCallback(async () => {
    if (!isPartner) return
    setLoadingInvites(true)
    try {
      const firmId = getActiveFirmId()
      const qs = firmId ? `?firm_id=${encodeURIComponent(firmId)}` : ""
      const res = await fetch(`/api/accounting/firm/staff/invitations${qs}`)
      if (res.ok) {
        const data = await res.json()
        setInvitations(Array.isArray(data.invitations) ? data.invitations : [])
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingInvites(false)
    }
  }, [isPartner])

  useEffect(() => {
    void loadInvitations()
  }, [loadInvitations])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError("")
    setMessage("")
    try {
      const firmId = getActiveFirmId()
      const res = await fetch("/api/accounting/firm/staff/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firm_id: firmId, email, role }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Could not send invitation.")
        return
      }
      if (data.email_sent === false) {
        setMessage(data.email_error || "Invitation created, but email could not be sent. Try resend.")
      } else {
        setMessage("Invitation sent.")
      }
      setEmail("")
      setRole("senior")
      setDialogOpen(false)
      void loadInvitations()
    } catch {
      setError("Could not send invitation.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleResend = async (id: string) => {
    setError("")
    setMessage("")
    const firmId = getActiveFirmId()
    const res = await fetch(`/api/accounting/firm/staff/invitations/${id}/resend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firm_id: firmId }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || "Could not resend invitation.")
      return
    }
    setMessage(
      data.email_sent === false
        ? data.email_error || "Token rotated, but email could not be sent."
        : "Invitation resent."
    )
    void loadInvitations()
  }

  const handleRevoke = async (id: string) => {
    setError("")
    setMessage("")
    const firmId = getActiveFirmId()
    const res = await fetch(`/api/accounting/firm/staff/invitations/${id}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firm_id: firmId }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || "Could not revoke invitation.")
      return
    }
    setMessage("Invitation revoked.")
    void loadInvitations()
  }

  if (staff.length === 0 && !isPartner) return null

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Team</h2>
        {isPartner && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Invite team member
          </button>
        )}
      </div>

      {message && <p className="mb-2 text-xs text-green-700 dark:text-green-400">{message}</p>}
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {staff.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {staff.map((member) => (
            <li key={member.user_id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-gray-900 dark:text-white">
                {member.name}
                <span className="ml-2 capitalize text-gray-500">{member.role}</span>
              </span>
              <span className="text-gray-500">
                {member.assigned_client_count} client
                {member.assigned_client_count === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isPartner && (
        <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-700">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Pending invitations
          </h3>
          {loadingInvites ? (
            <p className="text-xs text-gray-500">Loading…</p>
          ) : invitations.length === 0 ? (
            <p className="text-xs text-gray-500">No pending invitations.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <span className="text-gray-900 dark:text-white">{inv.email_normalized}</span>
                    <span className="ml-2 capitalize text-gray-500">{inv.role}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      Expires{" "}
                      {new Date(inv.expires_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleResend(inv.id)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRevoke(inv.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Revoke
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg dark:bg-gray-800">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Invite team member</h3>
            <form onSubmit={(e) => void handleInvite(e)} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as PracticeStaffRole)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                >
                  {INVITE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {practiceStaffRoleLabel(r)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">{practiceStaffRoleDescription(role)}</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Send invitation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
