"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type {
  PlatformAnnouncementAudienceScope,
  PlatformAnnouncementPlacement,
  PlatformAnnouncementRow,
  PlatformAnnouncementSeverity,
  PlatformAnnouncementStatus,
} from "@/lib/platform/announcementsTypes"
import { isAnnouncementActiveForDisplay } from "@/lib/platform/announcementsServer"

const STATUSES: PlatformAnnouncementStatus[] = ["draft", "active", "archived"]
const SEVERITIES: PlatformAnnouncementSeverity[] = ["info", "success", "warning", "critical"]
const PLACEMENTS: PlatformAnnouncementPlacement[] = ["global_banner", "dashboard_card", "modal"]
const AUDIENCES: PlatformAnnouncementAudienceScope[] = [
  "all_tenants",
  "service_workspace_only",
  "retail_workspace_only",
  "accounting_workspace_only",
]

const DEFAULT_FORM = {
  title: "",
  body: "",
  status: "draft" as PlatformAnnouncementStatus,
  severity: "warning" as PlatformAnnouncementSeverity,
  placement: "global_banner" as PlatformAnnouncementPlacement,
  audience_scope: "all_tenants" as PlatformAnnouncementAudienceScope,
  dismissible: true,
  start_at: "",
  end_at: "",
}

type EmailBatchResult = {
  sentOk: number
  sentFailed: number
  batchSize: number
  nextSkip: number
  moreRecipients: boolean
  totalDistinctEmails: number
  businessesScanned: number
  scanTruncated: boolean
  errors: string[]
}

export default function InternalAnnouncementsPage() {
  const [list, setList] = useState<PlatformAnnouncementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(DEFAULT_FORM)
  /** Next skip index per announcement for batched Resend sends */
  const [emailSkipById, setEmailSkipById] = useState<Record<string, number>>({})
  const [emailResultById, setEmailResultById] = useState<Record<string, EmailBatchResult | null>>({})
  const [emailSendingId, setEmailSendingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/internal/announcements", { credentials: "same-origin" })
      if (res.status === 403) {
        setError("Forbidden")
        setList([])
        return
      }
      if (!res.ok) {
        setError("Failed to load")
        setList([])
        return
      }
      const json = (await res.json()) as { announcements?: PlatformAnnouncementRow[] }
      setList(json.announcements ?? [])
    } catch {
      setError("Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const resetForm = () => {
    setEditingId(null)
    setForm(DEFAULT_FORM)
  }

  const startEdit = (row: PlatformAnnouncementRow) => {
    setEditingId(row.id)
    setForm({
      title: row.title,
      body: row.body,
      status: row.status,
      severity: row.severity,
      placement: row.placement,
      audience_scope: row.audience_scope,
      dismissible: row.dismissible,
      start_at: row.start_at ? row.start_at.slice(0, 16) : "",
      end_at: row.end_at ? row.end_at.slice(0, 16) : "",
    })
  }

  const submitCreate = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/internal/announcements", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          start_at: form.start_at || null,
          end_at: form.end_at || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((json as { error?: string }).error || "Save failed")
        return
      }
      resetForm()
      await load()
    } finally {
      setSaving(false)
    }
  }

  const submitPatch = async () => {
    if (!editingId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/internal/announcements/${editingId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          start_at: form.start_at || null,
          end_at: form.end_at || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((json as { error?: string }).error || "Update failed")
        return
      }
      resetForm()
      await load()
    } finally {
      setSaving(false)
    }
  }

  const sendEmailBatch = async (row: PlatformAnnouncementRow, useSkip: number) => {
    if (!isAnnouncementActiveForDisplay(row)) return
    if (
      useSkip === 0 &&
      !window.confirm(
        `Send up to one batch of emails for: "${row.title}"?\n\nRecipients follow audience "${row.audience_scope}": business profile + owner emails (or accounting firm users for accounting-only).`
      )
    ) {
      return
    }
    setEmailSendingId(row.id)
    setError(null)
    try {
      const res = await fetch(`/api/internal/announcements/${row.id}/send-email`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip: useSkip }),
      })
      const json = (await res.json()) as EmailBatchResult & { error?: string }
      if (!res.ok) {
        setError(json.error || "Email send failed")
        return
      }
      setEmailResultById((m) => ({ ...m, [row.id]: json }))
      setEmailSkipById((m) => ({ ...m, [row.id]: json.nextSkip }))
    } catch {
      setError("Email send failed")
    } finally {
      setEmailSendingId(null)
    }
  }

  const patchStatus = async (id: string, status: PlatformAnnouncementStatus) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/internal/announcements/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((json as { error?: string }).error || "Update failed")
        return
      }
      if (editingId === id) setForm((f) => ({ ...f, status }))
      await load()
    } finally {
      setSaving(false)
    }
  }

  const sortedList = useMemo(
    () => [...list].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [list]
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Announcements</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Internal only. Tenants see active items in-app (banner, dashboard cards, or modal) per audience and dates.
        </p>
        <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
          <p className="font-semibold">How to access</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Add your work email to <code className="rounded bg-white/80 px-1 dark:bg-sky-900">INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS</code> in{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-sky-900">.env.local</code> (local) or Vercel env (production). Comma-separated
              list.
            </li>
            <li>
              Ensure <code className="rounded bg-white/80 px-1 dark:bg-sky-900">SUPABASE_SERVICE_ROLE_KEY</code> is set (already required for
              other server jobs).
            </li>
            <li>
              Sign in with that Supabase user, then open{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-sky-900">/internal/announcements</code> on your app host (e.g.{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-sky-900">https://your-domain.com/internal/announcements</code>).
            </li>
          </ol>
          <p className="mt-2 text-xs text-sky-900/80 dark:text-sky-200/90">
            Email broadcasts use Resend (<code className="rounded px-0.5">RESEND_API_KEY</code>, optional{" "}
            <code className="rounded px-0.5">INTERNAL_ANNOUNCEMENT_EMAIL_FROM</code>). Sends are batched; click again for the next batch if
            prompted.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {editingId ? "Edit announcement" : "Create announcement"}
        </h2>
        <div className="mt-4 grid gap-3">
          <label className="block text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Title</span>
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-950"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Body</span>
            <textarea
              rows={8}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm dark:border-slate-600 dark:bg-slate-950"
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">Status</span>
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-950"
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as PlatformAnnouncementStatus }))
                }
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">Severity</span>
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-950"
                value={form.severity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, severity: e.target.value as PlatformAnnouncementSeverity }))
                }
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">Placement</span>
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-950"
                value={form.placement}
                onChange={(e) =>
                  setForm((f) => ({ ...f, placement: e.target.value as PlatformAnnouncementPlacement }))
                }
              >
                {PLACEMENTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">Audience</span>
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-950"
                value={form.audience_scope}
                onChange={(e) =>
                  setForm((f) => ({ ...f, audience_scope: e.target.value as PlatformAnnouncementAudienceScope }))
                }
              >
                {AUDIENCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.dismissible}
                onChange={(e) => setForm((f) => ({ ...f, dismissible: e.target.checked }))}
              />
              <span className="font-medium text-slate-700 dark:text-slate-300">Dismissible</span>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">Start (local)</span>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-950"
                value={form.start_at}
                onChange={(e) => setForm((f) => ({ ...f, start_at: e.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">End (local)</span>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-950"
                value={form.end_at}
                onChange={(e) => setForm((f) => ({ ...f, end_at: e.target.value }))}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {editingId ? (
              <>
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                  onClick={() => void submitPatch()}
                >
                  Save changes
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600"
                  onClick={resetForm}
                >
                  Cancel edit
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={saving}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                onClick={() => void submitCreate()}
              >
                Create
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">All announcements</h2>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        ) : sortedList.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
            {sortedList.map((row) => (
              <li key={row.id} className="py-4 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{row.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {row.status} · {row.severity} · {row.placement} · {row.audience_scope}
                      {row.dismissible ? "" : " · not dismissible"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      start: {row.start_at ?? "—"} · end: {row.end_at ?? "—"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-0.5 text-xs dark:border-slate-600"
                      onClick={() => startEdit(row)}
                    >
                      Edit
                    </button>
                    {row.status !== "active" && (
                      <button
                        type="button"
                        className="rounded border border-emerald-600 px-2 py-0.5 text-xs text-emerald-800 dark:text-emerald-300"
                        onClick={() => void patchStatus(row.id, "active")}
                      >
                        Activate
                      </button>
                    )}
                    {row.status === "active" && (
                      <button
                        type="button"
                        className="rounded border border-amber-600 px-2 py-0.5 text-xs text-amber-900 dark:text-amber-200"
                        onClick={() => void patchStatus(row.id, "draft")}
                      >
                        Deactivate (draft)
                      </button>
                    )}
                    {row.status !== "archived" && (
                      <button
                        type="button"
                        className="rounded border border-slate-400 px-2 py-0.5 text-xs"
                        onClick={() => void patchStatus(row.id, "archived")}
                      >
                        Archive
                      </button>
                    )}
                    {isAnnouncementActiveForDisplay(row) && (
                      <>
                        <button
                          type="button"
                          disabled={emailSendingId === row.id}
                          className="rounded border border-violet-600 px-2 py-0.5 text-xs text-violet-900 disabled:opacity-50 dark:text-violet-200"
                          onClick={() => void sendEmailBatch(row, emailSkipById[row.id] ?? 0)}
                        >
                          {emailSkipById[row.id] ? "Email next batch" : "Email tenants (batch)"}
                        </button>
                        {emailSkipById[row.id] ? (
                          <button
                            type="button"
                            className="rounded border border-slate-400 px-2 py-0.5 text-xs"
                            onClick={() => {
                              setEmailSkipById((m) => ({ ...m, [row.id]: 0 }))
                              setEmailResultById((m) => ({ ...m, [row.id]: null }))
                            }}
                          >
                            Reset email progress
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
                {emailResultById[row.id] != null && (
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                    Last batch: {emailResultById[row.id]!.sentOk} ok, {emailResultById[row.id]!.sentFailed} failed — total distinct{" "}
                    {emailResultById[row.id]!.totalDistinctEmails}, next skip {emailResultById[row.id]!.nextSkip}
                    {emailResultById[row.id]!.moreRecipients ? " — more recipients remain." : " — batch complete for discovered list."}
                    {emailResultById[row.id]!.scanTruncated ? " (business scan hit cap; increase INTERNAL_ANNOUNCEMENT_EMAIL_MAX_BUSINESSES_SCAN if needed.)" : ""}
                  </p>
                )}
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-800 dark:bg-slate-950 dark:text-slate-200">
                  {row.body}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
