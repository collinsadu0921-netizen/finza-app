"use client"

import { useState, useEffect } from "react"
import {
  PERMISSION_GROUPS,
  ROLE_DEFAULTS,
  resolveEffectivePermissions,
  DEFAULT_CUSTOM_PERMISSIONS,
  type Permission,
  type CustomPermissions,
} from "@/lib/permissions"
import { NativeSelect } from "@/components/ui/NativeSelect"

type Member = {
  id: string
  user_id: string
  role: string
  display_name: string | null
  email: string | null
  invited_at: string | null
  created_at: string
  custom_permissions: CustomPermissions | null
}

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; desc: string }> = {
  admin: {
    label: "Admin",
    color: "text-purple-700",
    bg: "bg-purple-100",
    desc: "Full access — individual permissions can be revoked",
  },
  manager: {
    label: "Manager",
    color: "text-blue-700",
    bg: "bg-blue-100",
    desc: "Operational access — projects, invoices, customers",
  },
  accountant: {
    label: "Accountant",
    color: "text-emerald-700",
    bg: "bg-emerald-100",
    desc: "Ledger, reports, bills, expenses",
  },
  staff: {
    label: "Staff",
    color: "text-slate-600",
    bg: "bg-slate-100",
    desc: "View and update assigned projects",
  },
}

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role] ?? ROLE_CONFIG.staff
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
      {cfg.label}
    </span>
  )
}

function initials(name: string | null, email: string | null): string {
  const src = name || email || "?"
  return src.split(/\s+|@/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || "?"
}

// ── Permission editor modal ───────────────────────────────────────────────────

function PermissionEditor({
  member,
  onClose,
  onSave,
}: {
  member: Member
  onClose: () => void
  onSave: (memberId: string, customPermissions: CustomPermissions) => Promise<void>
}) {
  const roleDefaults = new Set<Permission>(ROLE_DEFAULTS[member.role] ?? [])
  const existing: CustomPermissions = member.custom_permissions ?? DEFAULT_CUSTOM_PERMISSIONS

  // Local state: for each permission, track override: "default" | "granted" | "revoked"
  const [overrides, setOverrides] = useState<Record<string, "default" | "granted" | "revoked">>(() => {
    const map: Record<string, "default" | "granted" | "revoked"> = {}
    for (const g of PERMISSION_GROUPS) {
      for (const p of g.permissions) {
        if (existing.granted.includes(p.key as Permission)) {
          map[p.key] = "granted"
        } else if (existing.revoked.includes(p.key as Permission)) {
          map[p.key] = "revoked"
        } else {
          map[p.key] = "default"
        }
      }
    }
    return map
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const effective = resolveEffectivePermissions(member.role, {
    granted: Object.entries(overrides).filter(([, v]) => v === "granted").map(([k]) => k as Permission),
    revoked: Object.entries(overrides).filter(([, v]) => v === "revoked").map(([k]) => k as Permission),
  })

  function toggle(key: string) {
    setOverrides(prev => {
      const current = prev[key]
      const isDefault = roleDefaults.has(key as Permission)

      // Cycle: default → revoked (if in defaults) or granted (if not in defaults) → default
      if (current === "default") {
        return { ...prev, [key]: isDefault ? "revoked" : "granted" }
      }
      return { ...prev, [key]: "default" }
    })
  }

  async function handleSave() {
    setSaving(true)
    setError("")
    const granted = Object.entries(overrides).filter(([, v]) => v === "granted").map(([k]) => k as Permission)
    const revoked = Object.entries(overrides).filter(([, v]) => v === "revoked").map(([k]) => k as Permission)
    try {
      await onSave(member.id, { granted, revoked })
      onClose()
    } catch (e: any) {
      setError(e.message || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = JSON.stringify(overrides) !== JSON.stringify(
    (() => {
      const map: Record<string, "default" | "granted" | "revoked"> = {}
      for (const g of PERMISSION_GROUPS) {
        for (const p of g.permissions) {
          if (existing.granted.includes(p.key as Permission)) map[p.key] = "granted"
          else if (existing.revoked.includes(p.key as Permission)) map[p.key] = "revoked"
          else map[p.key] = "default"
        }
      }
      return map
    })()
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              Edit Permissions — {member.display_name || member.email}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Role default: <RoleBadge role={member.role} />
              <span className="ml-2">·  Click any permission to override</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Legend */}
        <div className="px-6 pt-3 pb-2 flex gap-4 text-xs shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> Granted (added)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-blue-400 inline-block" /> Role default
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-red-400 inline-block" /> Revoked (removed)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-gray-200 inline-block" /> Not available
          </span>
        </div>

        {/* Permission list */}
        <div className="overflow-y-auto flex-1 px-6 pb-4 space-y-5">
          {PERMISSION_GROUPS.map(group => (
            <div key={group.group}>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{group.group}</p>
              <div className="space-y-1.5">
                {group.permissions.map(p => {
                  const override = overrides[p.key] ?? "default"
                  const isDefault = roleDefaults.has(p.key as Permission)
                  const isEffective = effective.has(p.key as Permission)

                  let bg = "bg-gray-100 dark:bg-gray-800 text-gray-400"
                  let indicator = "bg-gray-200 dark:bg-gray-700"
                  let statusLabel = "Not available"

                  if (override === "granted") {
                    bg = "bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-700"
                    indicator = "bg-green-500"
                    statusLabel = "Granted"
                  } else if (override === "revoked") {
                    bg = "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 line-through"
                    indicator = "bg-red-400"
                    statusLabel = "Revoked"
                  } else if (isDefault) {
                    bg = "bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700"
                    indicator = "bg-blue-400"
                    statusLabel = "Role default"
                  }

                  return (
                    <button
                      key={p.key}
                      onClick={() => toggle(p.key)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-all ${bg} hover:opacity-80`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${indicator}`} />
                      <span className="flex-1">{p.label}</span>
                      <span className="text-xs opacity-60 shrink-0">{statusLabel}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && (
            <p className="text-xs text-gray-500">
              {effective.size} permission{effective.size !== 1 ? "s" : ""} active
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {saving ? "Saving…" : "Save Permissions"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ServiceTeamPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [showInvite, setShowInvite] = useState(false)
  const [editingMember, setEditingMember] = useState<Member | null>(null)

  // Invite form state
  const [invEmail, setInvEmail] = useState("")
  const [invName, setInvName] = useState("")
  const [invRole, setInvRole] = useState("staff")
  const [invPassword, setInvPassword] = useState("")
  const [invAutoPassword, setInvAutoPassword] = useState(true)
  const [inviting, setInviting] = useState(false)
  const [invError, setInvError] = useState("")
  const [invSuccess, setInvSuccess] = useState("")

  const [changingRole, setChangingRole] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => { loadTeam() }, [])

  const loadTeam = async () => {
    try {
      setLoading(true)
      const r = await fetch("/api/service/team")
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Failed to load team")
      setMembers(d.members ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInvError("")
    setInvSuccess("")
    if (!invEmail.trim()) { setInvError("Email is required"); return }
    setInviting(true)
    try {
      const r = await fetch("/api/service/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: invEmail.trim(),
          display_name: invName.trim() || undefined,
          role: invRole,
          password: invAutoPassword ? undefined : invPassword,
          auto_generate_password: invAutoPassword,
        }),
      })
      const d = await r.json()
      if (!r.ok) { setInvError(d.error || "Failed to invite"); return }
      const msg = d.isExistingUser
        ? `${invEmail} already has a Finza account and has been added to this workspace.`
        : `Invited ${invEmail} successfully.`
      setInvSuccess(msg)
      setInvEmail(""); setInvName(""); setInvPassword("")
      await loadTeam()
      setTimeout(() => { setInvSuccess(""); setShowInvite(false) }, 4000)
    } catch (e: any) {
      setInvError(e.message || "Failed to invite")
    } finally {
      setInviting(false)
    }
  }

  const handleRoleChange = async (memberId: string, newRole: string) => {
    setChangingRole(memberId)
    try {
      const r = await fetch(`/api/service/team/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Failed to update role")
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setChangingRole(null)
    }
  }

  const handleSavePermissions = async (memberId: string, customPermissions: CustomPermissions) => {
    const r = await fetch(`/api/service/team/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: members.find(m => m.id === memberId)?.role, custom_permissions: customPermissions }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || "Failed to save permissions")
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, custom_permissions: customPermissions } : m))
  }

  const handleRemove = async (memberId: string, memberName: string | null) => {
    if (!confirm(`Remove ${memberName || "this member"} from the workspace?`)) return
    setRemoving(memberId)
    try {
      const r = await fetch(`/api/service/team/${memberId}`, { method: "DELETE" })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Failed to remove member")
      setMembers(prev => prev.filter(m => m.id !== memberId))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRemoving(null)
    }
  }

  function getOverrideCount(member: Member): { granted: number; revoked: number } {
    return {
      granted: member.custom_permissions?.granted?.length ?? 0,
      revoked: member.custom_permissions?.revoked?.length ?? 0,
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6" data-tour="service-users-overview">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Team Members</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Roles set starting permissions. Any permission can be individually granted or revoked per member.
          </p>
        </div>
        <button
          onClick={() => { setShowInvite(true); setInvError(""); setInvSuccess("") }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          data-tour="service-users-invite"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          Add Member
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>
      )}

      {/* Role legend */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
          <div key={key} className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-3">
            <RoleBadge role={key} />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{cfg.desc}</p>
          </div>
        ))}
      </div>

      {/* Members list */}
      <div
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden"
        data-tour="service-users-list"
      >
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Loading team…</div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-slate-500 text-sm">No team members yet</p>
            <p className="text-slate-400 text-xs mt-1">Add members so they can access this workspace</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {members.map((m) => {
              const { granted, revoked } = getOverrideCount(m)
              const hasOverrides = granted > 0 || revoked > 0

              return (
                <li key={m.id} className="flex items-center gap-4 px-5 py-4">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-600 dark:text-slate-300 shrink-0">
                    {initials(m.display_name, m.email)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 dark:text-white text-sm truncate">
                      {m.display_name || m.email || "Unknown"}
                    </p>
                    {m.email && m.display_name && (
                      <p className="text-xs text-slate-400 truncate">{m.email}</p>
                    )}
                    {hasOverrides && (
                      <div className="flex gap-2 mt-1">
                        {granted > 0 && (
                          <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">
                            +{granted} granted
                          </span>
                        )}
                        {revoked > 0 && (
                          <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                            −{revoked} revoked
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Role selector */}
                  <NativeSelect
                    value={m.role}
                    onChange={e => handleRoleChange(m.id, e.target.value)}
                    disabled={changingRole === m.id}
                    size="sm"
                    wrapperClassName="w-auto shrink-0 min-w-[8.5rem]"
                  >
                    {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </NativeSelect>

                  {/* Edit permissions */}
                  <button
                    onClick={() => setEditingMember(m)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline shrink-0 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                    title="Edit individual permissions"
                  >
                    Permissions
                  </button>

                  {/* Remove */}
                  <button
                    onClick={() => handleRemove(m.id, m.display_name)}
                    disabled={removing === m.id}
                    className="text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40 shrink-0"
                    title="Remove from workspace"
                  >
                    {removing === m.id ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
                      </svg>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">Add Team Member</h2>
              <button onClick={() => setShowInvite(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleInvite} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Email address <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={invEmail}
                  onChange={e => setInvEmail(e.target.value)}
                  placeholder="team@example.com"
                  className="w-full border border-slate-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                  required
                />
                <p className="text-xs text-slate-400 mt-1">
                  If this email already has a Finza account, they'll be added automatically.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Full name</label>
                <input
                  type="text"
                  value={invName}
                  onChange={e => setInvName(e.target.value)}
                  placeholder="e.g. Kwame Asante"
                  className="w-full border border-slate-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Role <span className="text-red-500">*</span>
                </label>
                <NativeSelect value={invRole} onChange={e => setInvRole(e.target.value)}>
                  {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
                    <option key={key} value={key}>{cfg.label} — {cfg.desc}</option>
                  ))}
                </NativeSelect>
                <p className="text-xs text-slate-400 mt-1">You can customise individual permissions after adding.</p>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    id="autoPassword"
                    checked={invAutoPassword}
                    onChange={e => setInvAutoPassword(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="autoPassword" className="text-sm text-slate-600 dark:text-slate-300">
                    Auto-generate a password
                  </label>
                </div>
                {!invAutoPassword && (
                  <input
                    type="password"
                    value={invPassword}
                    onChange={e => setInvPassword(e.target.value)}
                    placeholder="Temporary password (min. 6 chars)"
                    minLength={6}
                    className="w-full border border-slate-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                  />
                )}
              </div>

              {invError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{invError}</p>
              )}
              {invSuccess && (
                <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{invSuccess}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInvite(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                >
                  {inviting ? "Adding…" : "Add to Workspace"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permission editor modal */}
      {editingMember && (
        <PermissionEditor
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSave={handleSavePermissions}
        />
      )}
    </div>
  )
}
