"use client"

import { useCallback, useEffect, useState } from "react"

type InvitationRow = {
  id: string
  email_normalized: string
  business_name: string
  status: string
  expires_at: string
  created_at: string
  accepted_at: string | null
  accepted_business_id: string | null
  revoked_at: string | null
  last_email_provider_status: string | null
  last_email_error: string | null
  token_version: number
}

type EmailResult = { provider_status: string; provider_id?: string; error?: string } | null

const STATUSES = ["pending", "accepted", "expired", "revoked", "all"] as const

function formatWhen(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export default function InternalRetailOnboardingPage() {
  const [rows, setRows] = useState<InvitationRow[]>([])
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [businessName, setBusinessName] = useState("")
  const [note, setNote] = useState("")
  const [sendEmail, setSendEmail] = useState(true)
  const [activationUrl, setActivationUrl] = useState<string | null>(null)
  const [emailResult, setEmailResult] = useState<EmailResult>(null)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ status, page: String(page), page_size: "20" })
      const res = await fetch(`/api/internal/retail-invitations?${qs.toString()}`, { credentials: "same-origin" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || "Failed to load invitations")
        setRows([])
        return
      }
      setRows(json.rows ?? [])
      setTotal(json.total ?? 0)
    } catch {
      setError("Failed to load invitations")
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => {
    void load()
  }, [load])

  async function createInvite(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setActivationUrl(null)
    setEmailResult(null)
    const res = await fetch("/api/internal/retail-invitations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, businessName, note, sendEmail }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(json.error || "Could not create invitation")
      return
    }
    setActivationUrl(json.activationUrl ?? null)
    setEmailResult(json.email ?? null)
    setEmail("")
    setBusinessName("")
    setNote("")
    if (status === "pending" && page === 1) {
      await load()
    } else {
      setPage(1)
      setStatus("pending")
    }
  }

  async function copyLink() {
    if (!activationUrl) return
    await navigator.clipboard.writeText(activationUrl)
  }

  async function rotate(id: string) {
    setError(null)
    setActivationUrl(null)
    const res = await fetch(`/api/internal/retail-invitations/${id}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rotate", sendEmail: true }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(json.error || "Could not resend invitation")
      return
    }
    setActivationUrl(json.activationUrl ?? null)
    setEmailResult(json.email ?? null)
    await load()
  }

  async function revoke(id: string) {
    setError(null)
    const res = await fetch(`/api/internal/retail-invitations/${id}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke", confirm: true }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(json.error || "Could not revoke invitation")
      return
    }
    setConfirmRevokeId(null)
    await load()
  }

  const pageCount = Math.max(1, Math.ceil(total / 20))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Retail onboarding</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Invitation-only. A resend replaces the previous link. Email provider acceptance is not inbox delivery.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <form onSubmit={createInvite} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">Create invitation</h2>
        <label className="block text-sm">
          Owner email
          <input className="mt-1 w-full rounded border px-2 py-1.5" value={email} onChange={(e) => setEmail(e.target.value)} required type="email" />
        </label>
        <label className="block text-sm">
          Retail business name
          <input className="mt-1 w-full rounded border px-2 py-1.5" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required maxLength={200} />
        </label>
        <label className="block text-sm">
          Internal note
          <textarea className="mt-1 w-full rounded border px-2 py-1.5" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          Ask the email provider to send the invitation
        </label>
        <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">
          Create invitation
        </button>
      </form>

      {activationUrl && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Activation link — copy it now. It is not shown again.</p>
          <p className="mt-2 break-all font-mono text-xs">{activationUrl}</p>
          <button type="button" className="mt-2 rounded border px-2 py-1" onClick={() => void copyLink()}>
            Copy link
          </button>
          {emailResult && (
            <p className="mt-2">
              Email provider status: {emailResult.provider_status}
              {emailResult.provider_status === "accepted"
                ? " (accepted for sending, not confirmed delivered)"
                : emailResult.error
                  ? ` — ${emailResult.error}`
                  : ""}
            </p>
          )}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="text-sm">
            Status
            <select
              className="mt-1 block rounded border px-2 py-1.5"
              value={status}
              onChange={(e) => {
                setPage(1)
                setStatus(e.target.value as (typeof STATUSES)[number])
              }}
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 text-sm">
            <button type="button" className="rounded border px-2 py-1" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {pageCount}
            </span>
            <button type="button" className="rounded border px-2 py-1" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No invitations on this page.</p>
        ) : (
          <ul className="mt-4 divide-y">
            {rows.map((row) => (
              <li key={row.id} className="py-3 text-sm">
                <p className="font-medium">
                  {row.business_name} · {row.email_normalized}
                </p>
                <p className="text-slate-600">
                  {row.status} · created {formatWhen(row.created_at)} · expires {formatWhen(row.expires_at)}
                  {row.accepted_at ? ` · accepted ${formatWhen(row.accepted_at)}` : ""}
                  {row.revoked_at ? ` · revoked ${formatWhen(row.revoked_at)}` : ""}
                </p>
                <p className="text-slate-500">
                  Email provider: {row.last_email_provider_status ?? "not recorded"}
                  {row.last_email_error ? ` — ${row.last_email_error}` : ""}
                </p>
                {row.accepted_business_id && (
                  <p className="font-mono text-xs">Retail business {row.accepted_business_id}</p>
                )}
                {row.status === "pending" && (
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="rounded border px-2 py-1" onClick={() => void rotate(row.id)}>
                      Resend (new link)
                    </button>
                    {confirmRevokeId === row.id ? (
                      <>
                        <button type="button" className="rounded border border-red-400 px-2 py-1 text-red-700" onClick={() => void revoke(row.id)}>
                          Confirm revoke
                        </button>
                        <button type="button" className="rounded border px-2 py-1" onClick={() => setConfirmRevokeId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className="rounded border px-2 py-1" onClick={() => setConfirmRevokeId(row.id)}>
                        Revoke
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
