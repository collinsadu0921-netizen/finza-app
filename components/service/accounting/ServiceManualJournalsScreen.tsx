"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { buildServiceRoute } from "@/lib/service/routes"
import {
  isServiceManualControlAccount,
  type ServiceManualJournalAccount,
  type ServiceManualJournalLine,
} from "@/lib/service/accounting/manualJournal"
import {
  formatManualJournalPeriod,
  periodForManualJournalDate,
  sortManualJournalPeriods,
} from "@/lib/service/accounting/manualJournalPeriods"

type DraftStatus = "draft" | "posted" | "reversed"

type Draft = {
  id: string
  business_id: string
  entry_date: string
  description: string
  reference: string | null
  lines: ServiceManualJournalLine[]
  total_debit: number | string
  total_credit: number | string
  status: DraftStatus
  created_by: string
  created_at: string
  updated_at: string
  posted_by: string | null
  posted_at: string | null
  journal_entry_id: string | null
  reversal_journal_entry_id: string | null
}

type Period = {
  id: string
  period_start: string
  period_end: string
  status: string
}

type FormLine = {
  account_id: string
  debit: string
  credit: string
  memo: string
}

const EMPTY_LINE: FormLine = { account_id: "", debit: "", credit: "", memo: "" }

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function newIdempotencyKey() {
  const cryptoApi = globalThis.crypto as Crypto | undefined
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  return `svc-mj-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatMoney(value: number | string, currency: string) {
  const amount = Number(value || 0)
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString()
}

function shortId(value: string | null | undefined) {
  return value ? `${value.slice(0, 8)}…` : "—"
}

function StatusBadge({ status }: { status: DraftStatus }) {
  const styles: Record<DraftStatus, string> = {
    draft: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600",
    posted: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700",
    reversed: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700",
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${styles[status]}`}>
      {status}
    </span>
  )
}

export default function ServiceManualJournalsScreen({ businessId }: { businessId: string }) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [accounts, setAccounts] = useState<ServiceManualJournalAccount[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [canWrite, setCanWrite] = useState(false)
  const [role, setRole] = useState("")
  const [currency, setCurrency] = useState("GHS")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showPeriods, setShowPeriods] = useState(false)
  const [entryDate, setEntryDate] = useState(todayIso())
  const [description, setDescription] = useState("")
  const [reference, setReference] = useState("")
  const [formLines, setFormLines] = useState<FormLine[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }])
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)
  const [showReversal, setShowReversal] = useState(false)
  const [reversalDate, setReversalDate] = useState(todayIso())
  const [reversalReason, setReversalReason] = useState("")

  const postableAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.is_postable === true &&
          account.deleted_at === null &&
          !isServiceManualControlAccount(account.code, account.is_system)
      ),
    [accounts]
  )

  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedId) || null,
    [drafts, selectedId]
  )
  const sortedPeriods = useMemo(() => sortManualJournalPeriods(periods), [periods])
  const selectedEntryPeriod = useMemo(
    () => periodForManualJournalDate(sortedPeriods, entryDate),
    [sortedPeriods, entryDate]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(
        `/api/service/accounting/manual-journals?business_id=${encodeURIComponent(businessId)}`,
        { cache: "no-store" }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || "Unable to load manual journals.")
      }
      setDrafts((data.drafts || []) as Draft[])
      setAccounts((data.accounts || []) as ServiceManualJournalAccount[])
      setPeriods((data.periods || []) as Period[])
      setCanWrite(Boolean(data.canWrite))
      setRole(typeof data.role === "string" ? data.role : "")
      setCurrency(typeof data.defaultCurrency === "string" && data.defaultCurrency ? data.defaultCurrency : "GHS")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load manual journals.")
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    void load()
  }, [load])

  function resetForm() {
    setEntryDate(todayIso())
    setDescription("")
    setReference("")
    setFormLines([{ ...EMPTY_LINE }, { ...EMPTY_LINE }])
    setIdempotencyKey(newIdempotencyKey())
    setShowForm(false)
  }

  function updateLine(index: number, patch: Partial<FormLine>) {
    setFormLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line))
    )
  }

  function onAmountChange(index: number, field: "debit" | "credit", value: string) {
    updateLine(index, {
      [field]: value,
      ...(value.trim() !== "" ? { [field === "debit" ? "credit" : "debit"]: "" } : {}),
    })
  }

  async function handleSave() {
    if (!canWrite || busy) return
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const response = await fetch("/api/service/accounting/manual-journals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          business_id: businessId,
          entry_date: entryDate,
          description,
          reference: reference.trim() || null,
          idempotency_key: idempotencyKey,
          lines: formLines.map((line) => ({
            account_id: line.account_id,
            debit: line.debit.trim() === "" ? 0 : Number(line.debit),
            credit: line.credit.trim() === "" ? 0 : Number(line.credit),
            memo: line.memo.trim() || null,
          })),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || "Unable to save the manual journal.")
      }
      setMessage("Draft saved.")
      setSelectedId(data.draft_id || null)
      resetForm()
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to save the manual journal.")
    } finally {
      setBusy(false)
    }
  }

  async function handlePost(draft: Draft) {
    if (!canWrite || busy) return
    if (!window.confirm("Post this manual journal to the ledger? Posted entries cannot be edited.")) return
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const response = await fetch(
        `/api/service/accounting/manual-journals/${draft.id}/post`,
        { method: "POST" }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || "Unable to post the manual journal.")
      }
      setMessage("Manual journal posted.")
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to post the manual journal.")
    } finally {
      setBusy(false)
    }
  }

  async function handleReverse() {
    if (!canWrite || busy || !selectedDraft?.journal_entry_id) return
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const response = await fetch(
        `/api/service/accounting/manual-journals/${selectedDraft.journal_entry_id}/reverse`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reversal_date: reversalDate, reason: reversalReason }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || "Unable to reverse the manual journal.")
      }
      setMessage("Reversal posted. The original entry is preserved.")
      setShowReversal(false)
      setReversalReason("")
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to reverse the manual journal.")
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="p-6"><p>Loading manual journals…</p></div>
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Manual journals</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Record a balanced manual journal for this Service business. Posted entries are immutable; corrections use a linked reversal.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Access: {role || "unknown"} · {canWrite ? "Create and post enabled" : "Read only"}
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => { setShowForm((value) => !value); setError(""); setMessage("") }}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
          >
            {showForm ? "Close form" : "New manual journal"}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          {message}
        </div>
      )}

      {showForm && canWrite && (
        <section className="mb-6 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-lg font-semibold mb-3">New draft</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-3">
            <label className="text-sm">
              <span className="block mb-1 text-gray-600 dark:text-gray-400">Entry date</span>
              <input
                type="date"
                value={entryDate}
                onChange={(event) => setEntryDate(event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block mb-1 text-gray-600 dark:text-gray-400">Description</span>
              <input
                value={description}
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What is this journal for?"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              />
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-gray-600 dark:text-gray-400">Reference (optional)</span>
              <input
                value={reference}
                maxLength={200}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Document / ticket no."
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              />
            </label>
          </div>

          <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                Entry date period
              </span>
              {selectedEntryPeriod ? (
                <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
                  Open · {formatManualJournalPeriod(selectedEntryPeriod)}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                  No open period covers {entryDate || "this date"}
                </span>
              )}
              {sortedPeriods.length > 0 && (
                <button
                  type="button"
                  aria-expanded={showPeriods}
                  aria-controls="manual-journal-open-periods"
                  onClick={() => setShowPeriods((value) => !value)}
                  className="ml-auto text-xs font-medium text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:text-blue-400"
                >
                  {showPeriods
                    ? "Hide open periods"
                    : `Show all open periods (${sortedPeriods.length})`}
                </button>
              )}
            </div>

            {showPeriods && (
              <ul
                id="manual-journal-open-periods"
                className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
              >
                {sortedPeriods.map((period) => {
                  const isSelected = selectedEntryPeriod?.id === period.id
                  return (
                    <li
                      key={period.id}
                      className={`rounded-md border px-2.5 py-1.5 text-xs ${
                        isSelected
                          ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-100"
                          : "border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                      }`}
                    >
                      <div className="font-medium">{formatManualJournalPeriod(period)}</div>
                      <div className="mt-0.5 text-[11px] capitalize text-gray-500 dark:text-gray-400">
                        {period.status}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600 dark:border-gray-700 dark:text-gray-400">
                  <th className="py-2 pr-2 font-medium">Account</th>
                  <th className="py-2 pr-2 font-medium">Debit</th>
                  <th className="py-2 pr-2 font-medium">Credit</th>
                  <th className="py-2 pr-2 font-medium">Memo</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {formLines.map((line, index) => (
                  <tr key={index} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 pr-2 min-w-[220px]">
                      <select
                        value={line.account_id}
                        onChange={(event) => updateLine(index, { account_id: event.target.value })}
                        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900"
                      >
                        <option value="">Select account</option>
                        {postableAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.code} · {account.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        inputMode="decimal"
                        value={line.debit}
                        onChange={(event) => onAmountChange(index, "debit", event.target.value)}
                        className="w-28 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-right dark:border-gray-600 dark:bg-gray-900"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        inputMode="decimal"
                        value={line.credit}
                        onChange={(event) => onAmountChange(index, "credit", event.target.value)}
                        className="w-28 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-right dark:border-gray-600 dark:bg-gray-900"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        value={line.memo}
                        onChange={(event) => updateLine(index, { memo: event.target.value })}
                        className="w-full min-w-[140px] rounded-md border border-gray-300 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900"
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        disabled={formLines.length <= 2}
                        onClick={() => setFormLines((current) => current.filter((_, i) => i !== index))}
                        className="text-xs text-red-600 disabled:opacity-40 dark:text-red-400"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setFormLines((current) => [...current, { ...EMPTY_LINE }])}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
            >
              Add line
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              {busy ? "Saving…" : "Save draft"}
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Debits must equal credits. Control accounts are not selectable.
            </span>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
        <section>
          <h2 className="text-lg font-semibold mb-3">Entries</h2>
          {drafts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              No manual journals yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600 dark:bg-gray-800/60 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium text-right">Debit</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((draft) => {
                    const isSelected = selectedId === draft.id
                    return (
                      <tr
                        key={draft.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        aria-label={`Select manual journal ${draft.description}`}
                        onClick={() => { setSelectedId(draft.id); setShowReversal(false) }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            setSelectedId(draft.id)
                            setShowReversal(false)
                          }
                        }}
                        className={`group cursor-pointer border-t border-gray-100 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 dark:border-gray-800 ${
                          isSelected
                            ? "bg-blue-50/70 dark:bg-blue-950/30"
                            : "bg-white hover:bg-gray-50 dark:bg-gray-900/40 dark:hover:bg-gray-800/40"
                        }`}
                      >
                        <td
                          className={`whitespace-nowrap border-l-4 px-3 py-2 ${
                            isSelected ? "border-blue-500 font-medium" : "border-transparent"
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <svg
                              className={`h-4 w-4 shrink-0 ${
                                isSelected
                                  ? "text-blue-600 dark:text-blue-300"
                                  : "text-gray-400 dark:text-gray-500"
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              aria-hidden
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                            {draft.entry_date}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{draft.description}</div>
                          {draft.reference && <div className="text-xs text-gray-500">{draft.reference}</div>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(draft.total_debit, currency)}</td>
                        <td className="px-3 py-2"><StatusBadge status={draft.status} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside>
          <h2 className="text-lg font-semibold mb-3">Details</h2>
          {!selectedDraft ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Select an entry to view its lines and audit fields.
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="font-semibold">{selectedDraft.description}</div>
                  <div className="text-xs text-gray-500">{selectedDraft.entry_date} · {selectedDraft.reference || "No reference"}</div>
                </div>
                <StatusBadge status={selectedDraft.status} />
              </div>

              <div className="space-y-1 mb-4 text-sm">
                {(selectedDraft.lines || []).map((line, index) => {
                  const account = accountsById.get(line.account_id)
                  return (
                    <div key={`${line.account_id}-${index}`} className="flex items-start justify-between gap-3 border-b border-gray-100 py-1.5 dark:border-gray-800">
                      <div>
                        <div>{account ? `${account.code} · ${account.name}` : shortId(line.account_id)}</div>
                        {line.memo && <div className="text-xs text-gray-500">{line.memo}</div>}
                      </div>
                      <div className="text-right whitespace-nowrap">
                        {Number(line.debit) > 0 && <div>Dr {formatMoney(line.debit, currency)}</div>}
                        {Number(line.credit) > 0 && <div>Cr {formatMoney(line.credit, currency)}</div>}
                      </div>
                    </div>
                  )
                })}
                <div className="flex justify-between pt-2 font-medium">
                  <span>Total</span>
                  <span>{formatMoney(selectedDraft.total_debit, currency)}</span>
                </div>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400 mb-4">
                <dt>Created by</dt><dd>{shortId(selectedDraft.created_by)} · {formatTimestamp(selectedDraft.created_at)}</dd>
                <dt>Posted by</dt><dd>{selectedDraft.posted_by ? `${shortId(selectedDraft.posted_by)} · ${formatTimestamp(selectedDraft.posted_at)}` : "Not posted"}</dd>
                <dt>Journal entry</dt>
                <dd>
                  {selectedDraft.journal_entry_id ? (
                    <Link
                      href={`${buildServiceRoute("/service/ledger", businessId)}&reference_type=manual&reference_id=${selectedDraft.id}`}
                      className="underline underline-offset-2 hover:no-underline"
                    >
                      {shortId(selectedDraft.journal_entry_id)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt>Reversal</dt>
                <dd>
                  {selectedDraft.reversal_journal_entry_id ? (
                    <Link
                      href={`${buildServiceRoute("/service/ledger", businessId)}&reference_type=reversal&reference_id=${selectedDraft.journal_entry_id}`}
                      className="underline underline-offset-2 hover:no-underline"
                    >
                      {shortId(selectedDraft.reversal_journal_entry_id)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </dl>

              <div className="flex flex-wrap gap-2">
                {selectedDraft.journal_entry_id && (
                  <Link
                    href={`${buildServiceRoute("/service/ledger", businessId)}&reference_type=manual&reference_id=${selectedDraft.id}`}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600"
                  >
                    View in ledger
                  </Link>
                )}
                {canWrite && selectedDraft.status === "draft" && (
                  <button
                    type="button"
                    onClick={() => handlePost(selectedDraft)}
                    disabled={busy}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {busy ? "Posting…" : "Post to ledger"}
                  </button>
                )}
                {canWrite && selectedDraft.status === "posted" && selectedDraft.journal_entry_id && (
                  <button
                    type="button"
                    onClick={() => { setShowReversal((value) => !value); setReversalDate(todayIso()); setReversalReason("") }}
                    className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-700 dark:text-amber-200"
                  >
                    Reverse
                  </button>
                )}
              </div>

              {showReversal && selectedDraft.status === "posted" && (
                <div className="mt-4 rounded-md border border-amber-200 p-3 dark:border-amber-800">
                  <p className="mb-2 text-xs text-amber-800 dark:text-amber-200">
                    This posts a mirrored entry in an open period. The original entry remains unchanged.
                  </p>
                  <label className="block text-xs mb-2">
                    <span className="block mb-1 text-gray-600 dark:text-gray-400">Reversal date</span>
                    <input
                      type="date"
                      value={reversalDate}
                      onChange={(event) => setReversalDate(event.target.value)}
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900"
                    />
                  </label>
                  <label className="block text-xs mb-2">
                    <span className="block mb-1 text-gray-600 dark:text-gray-400">Reason (10+ characters)</span>
                    <textarea
                      value={reversalReason}
                      onChange={(event) => setReversalReason(event.target.value)}
                      maxLength={500}
                      rows={2}
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleReverse}
                    disabled={busy || reversalReason.trim().length < 10}
                    className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {busy ? "Reversing…" : "Post reversal"}
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
