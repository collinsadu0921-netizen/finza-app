"use client"

/**
 * Shared client command center content.
 * Rendered by /accounting/clients/[id]/overview (canonical URL).
 * Accepts businessId as a prop so it can be reused without coupling to a specific route's params.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import ProtectedLayout from "@/components/ProtectedLayout"
import type { ControlTowerClientSummary } from "@/lib/accounting/controlTower/types"
import type { Engagement } from "@/lib/accounting/firm/engagements"
import { evaluateEngagementState } from "@/lib/accounting/evaluateEngagementState"
import OpenAccountingButton from "@/components/accounting/OpenAccountingButton"
import { WorkQueue } from "@/components/accounting/WorkQueue"
import EngagementLifecyclePanel from "@/components/accounting/EngagementLifecyclePanel"

interface Props {
  businessId: string
}

export default function ClientCommandCenter({ businessId }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [summary, setSummary] = useState<ControlTowerClientSummary | null>(null)
  const [engagement, setEngagement] = useState<Engagement | null>(null)
  const [firmRole, setFirmRole] = useState<string | null>(null)
  const [activityLogs, setActivityLogs] = useState<
    { id: string; action_type: string; created_at: string; metadata?: Record<string, unknown> }[]
  >([])

  const loadSummary = useCallback(async () => {
    if (!businessId) return null
    const res = await fetch(
      `/api/accounting/control-tower/client-summary?business_id=${encodeURIComponent(businessId)}`
    )
    if (!res.ok) return null
    return res.json()
  }, [businessId])

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    async function load() {
      try {
        if (!cancelled) {
          setLoading(true)
          setError("")
        }
        const summaryRes = await fetch(
          `/api/accounting/control-tower/client-summary?business_id=${encodeURIComponent(businessId)}`
        )
        const summaryData = summaryRes.ok ? await summaryRes.json() : null
        if (cancelled) return
        if (!summaryRes.ok || !summaryData) {
          const errData = await summaryRes.json().catch(() => ({}))
          if (!cancelled) {
            if (summaryRes.status === 403) setError(errData.reason || "Access denied")
            else if (summaryRes.status === 400) setError("Missing business context")
            else setError(errData.error || "Failed to load")
            setSummary(null)
            setEngagement(null)
            setFirmRole(null)
          }
          return
        }
        setSummary(summaryData)

        const firmsRes = await fetch("/api/accounting/firm/firms")
        if (!firmsRes.ok || cancelled) return
        const firmsData = await firmsRes.json()
        const firms = firmsData.firms ?? []
        const firmIds = firms.map((f: { firm_id: string }) => f.firm_id)

        for (const firmId of firmIds) {
          if (cancelled) return
          const engRes = await fetch(
            `/api/accounting/firm/engagements?firm_id=${encodeURIComponent(firmId)}`
          )
          if (!engRes.ok || cancelled) continue
          const engData = await engRes.json()
          const list = engData.engagements ?? []
          const found = list.find((e: Engagement) => e.client_business_id === businessId)
          if (found) {
            if (!cancelled) {
              setEngagement(found)
              const firm = firms.find((f: { firm_id: string }) => f.firm_id === firmId)
              setFirmRole(firm?.role ?? null)
            }
            if (found.id && !cancelled) {
              const actRes = await fetch(
                `/api/accounting/firm/activity?engagement_id=${encodeURIComponent(found.id)}&limit=50`
              )
              if (actRes.ok && !cancelled) {
                const actData = await actRes.json()
                if (!cancelled) setActivityLogs(actData.logs ?? [])
              }
            }
            break
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load")
          setSummary(null)
          setEngagement(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [businessId, loadSummary])

  const evaluatorResult =
    engagement
      ? evaluateEngagementState({
          engagement: {
            status: engagement.status,
            effective_from: engagement.effective_from,
            effective_to: engagement.effective_to ?? null,
          },
        })
      : summary?.engagement
        ? evaluateEngagementState({
            engagement: {
              status: summary.engagement.status,
              effective_from: summary.engagement.effective_from,
              effective_to: summary.engagement.effective_to ?? null,
            },
          })
        : null
  const isActive = evaluatorResult?.state === "ACTIVE"

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4" />
            <p className="text-gray-600 dark:text-gray-400">Loading client summary...</p>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  if (error || !summary) {
    return (
      <ProtectedLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200">
            {error || "Client not found"}
          </div>
          <Link
            href="/accounting/clients"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Back to Clients
          </Link>
        </div>
      </ProtectedLayout>
    )
  }

  const { counts, periods, links } = summary
  const clientName = summary.client_name ?? ""

  if (!isActive) {
    return (
      <ProtectedLayout>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
            {clientName}
          </h1>
          <EngagementLifecyclePanel
            engagement={engagement}
            evaluatorResult={evaluatorResult ?? null}
            authoritySource="accountant"
            firmRole={firmRole}
            clientName={clientName}
            businessName={clientName}
            activityLogs={activityLogs}
            onUpdated={() => {
              loadSummary().then((s) => s && setSummary(s))
              if (engagement?.accounting_firm_id) {
                fetch(
                  `/api/accounting/firm/engagements?firm_id=${encodeURIComponent(engagement.accounting_firm_id)}`
                )
                  .then((r) => r.json())
                  .then((d) => {
                    const found = (d.engagements ?? []).find(
                      (e: Engagement) => e.client_business_id === businessId
                    )
                    if (found) setEngagement(found)
                  })
              }
            }}
          />
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {clientName}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Engagement: {summary.engagement.status} · Access: {summary.engagement.access_level}{" "}
              · Effective {summary.engagement.effective_from}
              {summary.engagement.effective_to
                ? ` – ${summary.engagement.effective_to}`
                : " – ongoing"}
            </p>
          </div>
          <OpenAccountingButton businessId={businessId}>Open Accounting →</OpenAccountingButton>
        </div>

        <div className="space-y-6 mb-8">
          <EngagementLifecyclePanel
            engagement={engagement}
            evaluatorResult={evaluatorResult ?? null}
            authoritySource="accountant"
            firmRole={firmRole}
            clientName={clientName}
            businessName={clientName}
            activityLogs={activityLogs}
            onUpdated={() => {
              loadSummary().then((s) => s && setSummary(s))
              if (engagement?.accounting_firm_id) {
                fetch(
                  `/api/accounting/firm/engagements?firm_id=${encodeURIComponent(engagement.accounting_firm_id)}`
                )
                  .then((r) => r.json())
                  .then((d) => {
                    const found = (d.engagements ?? []).find(
                      (e: Engagement) => e.client_business_id === businessId
                    )
                    if (found) setEngagement(found)
                  })
              }
            }}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <CountCard label="Approvals pending" value={counts.approvals_pending} />
            <CountCard label="Approved, unposted" value={counts.approved_unposted} />
            <CountCard label="OB pending" value={counts.ob_pending} />
            <CountCard label="OB unposted" value={counts.ob_unposted} />
            <CountCard label="Recon exceptions" value={counts.recon_exceptions} />
            <CountCard label="Period blockers" value={counts.period_blockers} />
          </div>

          {periods.current_period_id && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Periods</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Current period: {periods.current_status ?? "—"} · Last closed:{" "}
                {periods.last_closed_period_id ? "Yes" : "—"}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
            <WorkQueue
              businessId={businessId}
              limit={20}
              groupByClient={false}
              title="Work items"
              maxHeight="360px"
            />
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Drill links</h3>
            <div className="flex flex-wrap gap-3">
              <Link href={links.ledger} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Ledger</Link>
              <Link href={links.journals} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Journals</Link>
              <Link href={links.openingBalances} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Opening balances</Link>
              <Link href={links.reconciliation} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Reconciliation</Link>
              <Link href={links.periods} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Periods</Link>
              <Link href={links.reports} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Reports</Link>
            </div>
          </div>

          <NotesPanel businessId={businessId} />
        </div>
      </div>
    </ProtectedLayout>
  )
}

// ---------- notes panel ------------------------------------------------------

type ClientNote = {
  id: string
  author_user_id: string
  body: string
  created_at: string
}

function fmtNoteDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function NotesPanel({ businessId }: { businessId: string }) {
  const [notes, setNotes] = useState<ClientNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/accounting/clients/${encodeURIComponent(businessId)}/notes`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Failed to load notes (${res.status})`)
        return
      }
      setNotes(data.notes ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    load()
  }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    setSaving(true)
    setSaveError("")
    try {
      const res = await fetch(`/api/accounting/clients/${encodeURIComponent(businessId)}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(data.error || `Failed to save (${res.status})`)
        return
      }
      setDraft("")
      await load()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
        Internal notes
      </h3>

      {/* Add note form */}
      <form onSubmit={handleSubmit} className="mb-5">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a note… (⌘↵ to save)"
          rows={3}
          disabled={saving}
          className="w-full resize-y rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        {saveError && (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{saveError}</p>
        )}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Internal only — not visible to the client
          </span>
          <button
            type="submit"
            disabled={saving || !draft.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <span className="inline-block h-3 w-3 rounded-full border-b-2 border-white animate-spin" />
                Saving…
              </>
            ) : (
              "Add note"
            )}
          </button>
        </div>
      </form>

      {/* Timeline */}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 mb-3">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
          No notes yet.
        </p>
      ) : (
        <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-2 space-y-4">
          {notes.map((note) => (
            <li key={note.id} className="pl-4">
              {/* Timeline dot */}
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white dark:border-gray-800 bg-blue-500" />
              <time className="text-xs text-gray-400 dark:text-gray-500 block mb-1">
                {fmtNoteDate(note.created_at)}
              </time>
              <p className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap leading-relaxed">
                {note.body}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">{label}</h3>
      <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  )
}
