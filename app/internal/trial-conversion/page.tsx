"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

type TrialConversionRow = {
  business_id: string
  business_name: string
  owner_email: string | null
  phone: string | null
  whatsapp_phone: string | null
  signup_goal_label: string
  signup_source: string | null
  signup_utm_source: string | null
  signup_utm_medium: string | null
  signup_utm_campaign: string | null
  trial_contact_consent: boolean
  service_subscription_tier: string | null
  trial_status: string | null
  trial_ends_at: string | null
  subscription_grace_until: string | null
  onboarding_step: string | null
  activation_state: string
  activation_events: string[]
  next_recommended_action: string
  suggested_whatsapp_message: string
  whatsapp_url: string | null
  is_paid: boolean
}

type QueueResponse = {
  ok?: boolean
  filter?: string
  count?: number
  queue?: TrialConversionRow[]
  error?: string
}

const FILTERS = [
  { value: "all_unpaid", label: "All unpaid" },
  { value: "trialing_only", label: "Trialing only" },
  { value: "ending_soon", label: "Ending soon" },
  { value: "expired_unpaid", label: "Expired unpaid" },
  { value: "no_activation", label: "No activation" },
  { value: "invoice_no_payment", label: "Invoice, no payment" },
  { value: "pricing_viewed", label: "Pricing viewed" },
  { value: "consent_yes", label: "Consent yes" },
  { value: "consent_missing", label: "Consent missing/no" },
]

function sourceSummary(row: TrialConversionRow): string {
  const parts = [
    row.signup_source ? `source: ${row.signup_source}` : null,
    row.signup_utm_source ? `utm_source: ${row.signup_utm_source}` : null,
    row.signup_utm_medium ? `utm_medium: ${row.signup_utm_medium}` : null,
    row.signup_utm_campaign ? `utm_campaign: ${row.signup_utm_campaign}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : "—"
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function trialDelta(iso: string | null): string {
  if (!iso) return "No trial end"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "Invalid date"
  const diffDays = Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  if (diffDays > 0) return `${diffDays} day${diffDays === 1 ? "" : "s"} left`
  if (diffDays === 0) return "Ends today"
  const since = Math.abs(diffDays)
  return `${since} day${since === 1 ? "" : "s"} expired`
}

function mailtoFor(row: TrialConversionRow): string | null {
  if (!row.owner_email) return null
  const subject = `Quick help with your Finza trial for ${row.business_name || "your business"}`
  const body = [
    `Hi ${row.business_name || "there"},`,
    "",
    row.suggested_whatsapp_message,
    "",
    "Best,",
    "Finza",
  ].join("\n")
  return `mailto:${encodeURIComponent(row.owner_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

async function copyText(text: string | null | undefined): Promise<boolean> {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function InternalTrialConversionPage() {
  const [rows, setRows] = useState<TrialConversionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState("all_unpaid")
  const [limit, setLimit] = useState(100)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        filter,
        limit: String(limit),
      })
      const res = await fetch(`/api/internal/trial-conversion-queue?${qs.toString()}`, {
        credentials: "same-origin",
      })
      const json = (await res.json().catch(() => ({}))) as QueueResponse
      if (!res.ok) {
        setError(json.error || "Failed to load trial conversion queue")
        setRows([])
        return
      }
      setRows(json.queue ?? [])
    } catch {
      setError("Failed to load trial conversion queue")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [filter, limit])

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo(() => {
    const consent = rows.filter((r) => r.trial_contact_consent).length
    const withWhatsApp = rows.filter((r) => r.whatsapp_url).length
    const invoiceNoPayment = rows.filter(
      (r) => r.activation_events.includes("invoice_created") && !r.activation_events.includes("payment_recorded")
    ).length
    return { consent, withWhatsApp, invoiceNoPayment }
  }, [rows])

  const markCopied = async (key: string, text: string | null | undefined) => {
    const ok = await copyText(text)
    if (!ok) return
    setCopied(key)
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Trial Conversion</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Internal only. Review unpaid Service trials and act on suggested one-to-one WhatsApp or email follow-ups.
          Broadcast announcements remain separate.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">Filter</span>
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-950"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">Limit</span>
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-950"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                {[50, 100, 250, 500].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
          <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-950">
            <p className="text-xs text-slate-500">Rows</p>
            <p className="mt-1 text-lg font-semibold">{rows.length}</p>
          </div>
          <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-950">
            <p className="text-xs text-slate-500">Consent yes</p>
            <p className="mt-1 text-lg font-semibold">{stats.consent}</p>
          </div>
          <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-950">
            <p className="text-xs text-slate-500">WhatsApp ready</p>
            <p className="mt-1 text-lg font-semibold">{stats.withWhatsApp}</p>
          </div>
          <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-950">
            <p className="text-xs text-slate-500">Invoice, no payment</p>
            <p className="mt-1 text-lg font-semibold">{stats.invoiceNoPayment}</p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Unpaid trial queue</h2>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No rows for this filter.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
            {rows.map((row) => {
              const mailto = mailtoFor(row)
              return (
                <li key={row.business_id} className="py-5 first:pt-0">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                    <div>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {row.business_name || "Unnamed business"}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {row.owner_email ?? "No owner email"} · {row.phone ?? "No phone"} · WhatsApp:{" "}
                            {row.whatsapp_phone ?? "—"}
                          </p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {row.trial_status ?? "status unknown"} · {row.service_subscription_tier ?? "tier unknown"}
                        </span>
                      </div>

                      <dl className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-400 sm:grid-cols-2">
                        <div>
                          <dt className="font-medium text-slate-700 dark:text-slate-300">Goal</dt>
                          <dd>{row.signup_goal_label}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-700 dark:text-slate-300">Source / UTM</dt>
                          <dd>{sourceSummary(row)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-700 dark:text-slate-300">Trial end</dt>
                          <dd>
                            {formatDate(row.trial_ends_at)} · {trialDelta(row.trial_ends_at)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-700 dark:text-slate-300">Onboarding</dt>
                          <dd>{row.onboarding_step ?? "—"}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-700 dark:text-slate-300">Activation state</dt>
                          <dd>{row.activation_state}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-700 dark:text-slate-300">Consent</dt>
                          <dd>{row.trial_contact_consent ? "Yes" : "Missing/no"}</dd>
                        </div>
                      </dl>

                      <p className="mt-3 text-xs text-slate-500">
                        Events: {row.activation_events.length ? row.activation_events.join(", ") : "none"}
                      </p>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {row.next_recommended_action}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                        {row.suggested_whatsapp_message}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {row.whatsapp_url ? (
                          <a
                            href={row.whatsapp_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded border border-emerald-600 px-2 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-300"
                          >
                            Open WhatsApp
                          </a>
                        ) : (
                          <span className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 dark:border-slate-700">
                            No WhatsApp link
                          </span>
                        )}
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
                          onClick={() =>
                            void markCopied(`${row.business_id}:message`, row.suggested_whatsapp_message)
                          }
                        >
                          {copied === `${row.business_id}:message` ? "Copied" : "Copy message"}
                        </button>
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
                          onClick={() => void markCopied(`${row.business_id}:phone`, row.whatsapp_phone ?? row.phone)}
                        >
                          {copied === `${row.business_id}:phone` ? "Copied" : "Copy phone"}
                        </button>
                        {mailto ? (
                          <a
                            href={mailto}
                            className="rounded border border-violet-600 px-2 py-1 text-xs font-medium text-violet-900 dark:text-violet-200"
                          >
                            Mail owner
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
