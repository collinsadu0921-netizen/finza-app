"use client"

import { useEffect, useState } from "react"
import EmptyState from "@/components/ui/EmptyState"
import { useRouter, useSearchParams } from "next/navigation"
import {
  useAccountingReadiness,
  ACCOUNTING_NOT_INITIALIZED_TITLE,
  ACCOUNTING_NOT_INITIALIZED_DESCRIPTION,
  ACCOUNTING_NOT_INITIALIZED_ACCOUNTANT_SECONDARY,
} from "@/lib/accounting/useAccountingReadiness"
import { useAccountingAuthority } from "@/lib/accounting/useAccountingAuthority"
import { canApproveEngagement } from "@/lib/accounting/uiAuthority"
import ReversalModal from "@/components/accounting/ReversalModal"
import ReadinessBanner from "@/components/accounting/ReadinessBanner"
import BlockedActionModal from "@/components/accounting/BlockedActionModal"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { buildServiceRoute } from "@/lib/service/routes"
import { Money } from "@/components/ui/Money"
import { NativeSelect } from "@/components/ui/NativeSelect"
import { formatMoney } from "@/lib/money"
import type { ScreenProps } from "./types"

type JournalEntry = {
  id: string
  date: string
  description: string | null
  reference_type: string | null
  reference_id: string | null
  journal_entry_lines: Array<{
    id: string
    account_id: string
    debit: number
    credit: number
    description: string | null
    accounts: {
      id: string
      name: string
      code: string
      type: string
    }
  }>
}

type Pagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatDate = (dateString: string) =>
  new Date(dateString).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })

const TYPE_META: Record<string, { label: string; color: string }> = {
  invoice:            { label: "Invoice",        color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  payment:            { label: "Payment",         color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  credit_note:        { label: "Credit Note",     color: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300" },
  bill:               { label: "Bill",            color: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  bill_payment:       { label: "Bill Payment",    color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  expense:            { label: "Expense",         color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  adjustment_journal: { label: "Adjustment",      color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
  opening_balance:    { label: "Opening Balance", color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  settlement:         { label: "Settlement",      color: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  manual:             { label: "Manual Entry",    color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  reversal:           { label: "Reversal",        color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function LedgerSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden animate-pulse"
        >
          <div className="h-11 bg-gray-100 dark:bg-gray-700/60" />
          <div className="px-4 py-3 space-y-2.5">
            {Array.from({ length: i + 1 }).map((_, j) => (
              <div key={j} className="flex justify-between items-center">
                <div className="h-3.5 bg-gray-100 dark:bg-gray-700 rounded w-1/3" />
                <div className="flex gap-8">
                  <div className="h-3.5 bg-blue-50 dark:bg-blue-900/20 rounded w-20" />
                  <div className="h-3.5 bg-green-50 dark:bg-green-900/20 rounded w-20" />
                </div>
              </div>
            ))}
            <div className="flex justify-between items-center border-t border-dashed border-gray-200 dark:border-gray-700 pt-2 mt-1">
              <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-12" />
              <div className="flex gap-8">
                <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-20" />
                <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-20" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Entry Card ──────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  reversalStatus,
  canReverseByEngagement,
  onReverse,
  currencyCode,
}: {
  entry: JournalEntry
  reversalStatus: { can_reverse: boolean; reason?: string; reversal_je_id?: string } | undefined
  canReverseByEngagement: boolean
  onReverse: (entry: JournalEntry) => void
  currencyCode: string | null
}) {
  const canReverse = reversalStatus?.can_reverse ?? false
  const blockReason = reversalStatus?.reason ?? "Cannot reverse"

  const totalDebits  = entry.journal_entry_lines.reduce((s, l) => s + Number(l.debit  || 0), 0)
  const totalCredits = entry.journal_entry_lines.reduce((s, l) => s + Number(l.credit || 0), 0)
  const isBalanced   = Math.abs(totalDebits - totalCredits) < 0.005

  // Exclude rounding-adjustment lines (account 7990) from displayed totals.
  // 7990 is an intentional sub-cent balancing entry produced by the Ghana tax
  // engine when individually-rounded tax components don't sum to the rounded
  // invoice total. It is still visible as its own line item; excluding it from
  // the footer keeps the displayed figure aligned with the actual invoice amount.
  const roundingDebitTotal  = entry.journal_entry_lines
    .filter((l) => l.accounts?.code === "7990")
    .reduce((s, l) => s + Number(l.debit  || 0), 0)
  const roundingCreditTotal = entry.journal_entry_lines
    .filter((l) => l.accounts?.code === "7990")
    .reduce((s, l) => s + Number(l.credit || 0), 0)
  const displayDebits  = totalDebits  - roundingDebitTotal
  const displayCredits = totalCredits - roundingCreditTotal

  const meta = entry.reference_type ? (TYPE_META[entry.reference_type] ?? {
    label: entry.reference_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  }) : { label: "Manual Entry", color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* ── Entry header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {/* Date */}
          <span className="text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
            {formatDate(entry.date)}
          </span>
          {/* Type badge */}
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${meta.color}`}>
            {meta.label}
          </span>
          {/* Description */}
          {entry.description && (
            <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {entry.description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Balanced indicator */}
          {isBalanced ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Balanced
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              Unbalanced
            </span>
          )}
          {/* Reverse button */}
          <button
            type="button"
            disabled={!canReverseByEngagement || !canReverse}
            title={
              !canReverseByEngagement
                ? "Requires approve engagement access"
                : !canReverse
                  ? blockReason
                  : "Reverse this journal entry"
            }
            onClick={canReverseByEngagement && canReverse ? () => onReverse(entry) : undefined}
            className="inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium transition-colors
              enabled:border-red-200 enabled:text-red-600 enabled:hover:bg-red-50
              dark:enabled:border-red-800 dark:enabled:text-red-400 dark:enabled:hover:bg-red-900/20
              disabled:border-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed
              dark:disabled:border-gray-700 dark:disabled:text-gray-600"
          >
            Reverse
          </button>
        </div>
      </div>

      {/* ── Lines ── */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
        {entry.journal_entry_lines.map((line) => {
          const hasDebit  = Number(line.debit  || 0) > 0
          const hasCredit = Number(line.credit || 0) > 0
          return (
            <div
              key={line.id}
              className="flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-50/60 dark:hover:bg-gray-700/20 transition-colors"
            >
              {/* Account */}
              <div className="flex items-center gap-2 min-w-0">
                {hasCredit && !hasDebit && (
                  <span className="w-4 shrink-0" /> // indent credits
                )}
                <span className="font-mono text-xs text-gray-400 dark:text-gray-500 shrink-0">
                  {line.accounts.code}
                </span>
                <span className="text-gray-700 dark:text-gray-300 truncate">
                  {line.accounts.name}
                </span>
                {line.description && line.description !== entry.description && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                    · {line.description}
                  </span>
                )}
              </div>

              {/* Debit / Credit amounts */}
              <div className="flex gap-8 shrink-0 ml-4">
                <span className="w-28 text-right text-sm text-slate-900 dark:text-white">
                  {hasDebit ? (
                    <Money
                      amount={Number(line.debit)}
                      currencyCode={currencyCode}
                      className="text-sm font-medium tabular-nums text-slate-900 dark:text-gray-100"
                    />
                  ) : (
                    <span className="text-gray-300 dark:text-gray-600">—</span>
                  )}
                </span>
                <span className="w-28 text-right text-sm text-slate-900 dark:text-white">
                  {hasCredit ? (
                    <Money
                      amount={Number(line.credit)}
                      currencyCode={currencyCode}
                      className="text-sm font-medium tabular-nums text-slate-900 dark:text-gray-100"
                    />
                  ) : (
                    <span className="text-gray-300 dark:text-gray-600">—</span>
                  )}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Totals row ── */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40 text-xs">
        <span className="text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide">Total</span>
        <div className="flex gap-8">
          <span className="w-28 text-right text-sm text-slate-900 dark:text-white">
            <Money
              amount={displayDebits}
              currencyCode={currencyCode}
              className="text-sm font-semibold tabular-nums text-slate-900 dark:text-gray-100"
            />
          </span>
          <span className="w-28 text-right text-sm text-slate-900 dark:text-white">
            <Money
              amount={displayCredits}
              currencyCode={currencyCode}
              className="text-sm font-semibold tabular-nums text-slate-900 dark:text-gray-100"
            />
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function LedgerScreen({ mode, businessId }: ScreenProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { ready, authority_source, loading: readinessLoading, refetch: refetchReadiness } = useAccountingReadiness(businessId)
  const { authority_source: authSource, access_level } = useAccountingAuthority(businessId)
  const authoritySource = authority_source ?? authSource
  const engagementAccessLevel = access_level ?? null
  const canReverseByEngagement =
    authSource !== "accountant" || canApproveEngagement(engagementAccessLevel)
  const noContext = !businessId
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [error, setError] = useState("")
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
  })
  const [filters, setFilters] = useState(() => ({
    start_date: "",
    end_date: "",
    account_code: "",
    reference_type: searchParams.get("reference_type") ?? "",
    reference_id: searchParams.get("reference_id") ?? "",
  }))
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; code: string }>>([])
  const [reversalModalOpen, setReversalModalOpen] = useState(false)
  const [reversalEntry, setReversalEntry] = useState<JournalEntry | null>(null)
  const [reversalStatuses, setReversalStatuses] = useState<Record<string, { can_reverse: boolean; reason?: string; reversal_je_id?: string }>>({})
  const [successBanner, setSuccessBanner] = useState<{ message: string; reversalJeId: string } | null>(null)
  const [blockedActionMessage, setBlockedActionMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportDates, setExportDates] = useState({ start: "", end: "" })
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)

  useEffect(() => {
    if (!businessId) {
      setCurrencyCode(null)
      return
    }
    let cancelled = false
    fetch(`/api/business/profile?business_id=${encodeURIComponent(businessId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setCurrencyCode(d.business?.default_currency ?? null)
      })
      .catch(() => {
        if (!cancelled) setCurrencyCode(null)
      })
    return () => {
      cancelled = true
    }
  }, [businessId])

  useEffect(() => {
    if (businessId) loadAccounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  useEffect(() => {
    const refType = searchParams.get("reference_type")
    const refId = searchParams.get("reference_id")
    if (refType !== null || refId !== null) {
      setFilters((f) => ({
        ...f,
        reference_type: refType ?? f.reference_type,
        reference_id: refId ?? f.reference_id,
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("reference_type"), searchParams.get("reference_id")])

  useEffect(() => {
    if (businessId) loadLedger(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, businessId])

  useEffect(() => {
    setLoading(false)
  }, [])

  const loadAccounts = async () => {
    if (!businessId) return
    try {
      const response = await fetch(`/api/accounting/coa?business_id=${encodeURIComponent(businessId)}`)
      if (response.ok) {
        const { accounts: data } = await response.json()
        setAccounts(data || [])
      }
    } catch (err) {
      console.error("Error loading accounts:", err)
    }
  }

  const loadLedger = async (page: number = pagination.page) => {
    if (!businessId) return
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.append("business_id", businessId)
      if (filters.start_date)    params.append("start_date",     filters.start_date)
      if (filters.end_date)      params.append("end_date",       filters.end_date)
      if (filters.account_code)  params.append("account_code",   filters.account_code)
      if (filters.reference_type) params.append("reference_type", filters.reference_type)
      if (filters.reference_id)  params.append("reference_id",   filters.reference_id)
      params.append("page",      page.toString())
      params.append("page_size", pagination.pageSize.toString())

      const response = await fetch(`/api/ledger/list?${params.toString()}`)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const msg    = (body.error as string) || "Unable to load ledger. Please try again."
        const detail = body.supabase_error?.message
        throw new Error(detail ? `${msg} (${detail})` : msg)
      }

      const { entries: data, pagination: paginationData } = body
      setEntries(data || [])
      if (paginationData) setPagination(paginationData)

      const entryIds = (data || []).map((e: JournalEntry) => e.id).filter(Boolean)
      if (businessId && entryIds.length > 0) {
        try {
          const statusRes = await fetch(
            `/api/accounting/reversal/status?business_id=${encodeURIComponent(businessId)}&je_ids=${entryIds.map((id: string) => encodeURIComponent(id)).join(",")}`
          )
          if (statusRes.ok) {
            const { statuses } = await statusRes.json()
            setReversalStatuses(statuses || {})
          }
        } catch {
          setReversalStatuses({})
        }
      } else {
        setReversalStatuses({})
      }
      setLoading(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load ledger")
      setLoading(false)
    }
  }

  const openReversalModal = (entry: JournalEntry) => {
    if (authSource === "accountant" && !canApproveEngagement(engagementAccessLevel)) {
      setBlockedActionMessage("Reverse journal requires approve engagement access")
      return
    }
    if (!canReverseByEngagement) {
      setBlockedActionMessage("Reverse journal requires approve engagement access")
      return
    }
    setReversalEntry(entry)
    setReversalModalOpen(true)
  }

  const handleReversalConfirm = async (payload: { reason: string; reversal_date: string }) => {
    if (!reversalEntry || !businessId) return { error: "Missing context" }
    const res = await fetch("/api/accounting/reversal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        original_je_id: reversalEntry.id,
        reason: payload.reason,
        reversal_date: payload.reversal_date || undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { error: data.error || "Reversal failed" }
    return { reversal_journal_entry_id: data.reversal_journal_entry_id }
  }

  const handleReversalSuccess = (reversalJeId: string) => {
    setSuccessBanner({ message: "Reversal created successfully.", reversalJeId })
    loadLedger(pagination.page)
    router.refresh()
  }

  const handlePageChange = (newPage: number) => {
    loadLedger(newPage)
  }

  const openExportModal = () => {
    setExportDates({
      start: filters.start_date || "",
      end:   filters.end_date   || "",
    })
    setExportModalOpen(true)
  }

  const exportCsv = async () => {
    if (!businessId || exporting) return
    setExporting(true)
    try {
      const params = new URLSearchParams()
      params.append("business_id", businessId)
      const from = exportDates.start || filters.start_date || ""
      const to   = exportDates.end   || filters.end_date   || ""
      if (from)                       params.append("start_date",     from)
      if (to)                         params.append("end_date",       to)
      if (filters.account_code)       params.append("account_code",   filters.account_code)
      if (filters.reference_type)     params.append("reference_type", filters.reference_type)
      if (filters.reference_id)       params.append("reference_id",   filters.reference_id)
      params.append("page",      "1")
      params.append("page_size", "10000")

      const response = await fetch(`/api/ledger/list?${params.toString()}`)
      if (!response.ok) throw new Error("Export fetch failed")
      const { entries: allEntries } = await response.json()

      const rows: string[][] = [
        ["Date", "Period", "Type", "Journal Description", "Account Code", "Account Name", "Line Description", "Debit", "Credit"],
      ]

      for (const entry of (allEntries as JournalEntry[])) {
        const period = entry.date.substring(0, 7)
        const meta = entry.reference_type
          ? (TYPE_META[entry.reference_type]?.label ?? entry.reference_type)
          : "Manual Entry"
        for (const line of entry.journal_entry_lines) {
          rows.push([
            formatDate(entry.date),
            period,
            meta,
            entry.description ?? "",
            line.accounts.code,
            line.accounts.name,
            line.description ?? "",
            Number(line.debit  || 0) > 0 ? formatMoney(Number(line.debit), currencyCode)  : "",
            Number(line.credit || 0) > 0 ? formatMoney(Number(line.credit), currencyCode) : "",
          ])
        }
      }

      const csv = rows
        .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n")

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href     = url
      a.download = `general-ledger-${from || "all"}-to-${to || "time"}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setExportModalOpen(false)
    } catch (err) {
      console.error("Export error:", err)
    } finally {
      setExporting(false)
    }
  }

  const backUrl =
    mode === "service"
      ? buildServiceRoute("/service/accounting", businessId)
      : businessId
        ? `/accounting?business_id=${businessId}`
        : "/accounting"

  const reversalHighlightUrl = (reversalJeId: string) =>
    mode === "service"
      ? `${buildServiceRoute("/service/ledger", businessId)}&highlight=${reversalJeId}`
      : businessId
        ? `${buildAccountingRoute("/accounting/ledger", businessId)}&highlight=${reversalJeId}`
        : "/accounting"

  if (readinessLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <LedgerSkeleton />
      </div>
    )
  }

  if (noContext) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <EmptyState
          title="Client not selected"
          description="Select a client from the Accounting workspace or open a business in the Service workspace to view the ledger."
        />
      </div>
    )
  }

  if (authority_source === "accountant" && ready === false) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <EmptyState
          title={ACCOUNTING_NOT_INITIALIZED_TITLE}
          description={ACCOUNTING_NOT_INITIALIZED_DESCRIPTION}
        />
        <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
          {ACCOUNTING_NOT_INITIALIZED_ACCOUNTANT_SECONDARY}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ReadinessBanner
          ready={ready}
          authoritySource={authority_source}
          businessId={businessId}
          onInitSuccess={refetchReadiness}
        />

        {/* ── Header ── */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <button
              onClick={() => router.push(backUrl)}
              className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
            >
              ← Back to Accounting
            </button>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                General Ledger
              </h1>
              {authoritySource === "accountant" && engagementAccessLevel && (
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  title="Your engagement access for this client"
                >
                  {engagementAccessLevel === "approve"
                    ? "Approve Access"
                    : engagementAccessLevel === "write"
                      ? "Write Access"
                      : "Read Access"}
                </span>
              )}
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Append-only · every entry is permanent and traceable
            </p>
          </div>
          <div className="flex items-center gap-3 mt-1 shrink-0">
            {pagination.total > 0 && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-gray-900 dark:text-white">{pagination.total}</span> journal lines
              </span>
            )}
            <button
              onClick={openExportModal}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
          </div>
        </div>

        {/* ── Alerts ── */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}
        {successBanner && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200 px-4 py-3 rounded-lg mb-6 flex items-center justify-between gap-4">
            <span>{successBanner.message}</span>
            <div className="flex items-center gap-3">
              <a
                href={reversalHighlightUrl(successBanner.reversalJeId)}
                className="text-green-700 dark:text-green-300 font-medium underline"
              >
                View reversal entry
              </a>
              <button
                type="button"
                onClick={() => setSuccessBanner(null)}
                className="text-green-600 dark:text-green-400 hover:underline text-sm"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* ── Filters ── */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 px-5 py-4 mb-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                From
              </label>
              <input
                type="date"
                value={filters.start_date}
                onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                To
              </label>
              <input
                type="date"
                value={filters.end_date}
                onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                Account Code
              </label>
              <input
                type="text"
                value={filters.account_code}
                onChange={(e) => setFilters({ ...filters, account_code: e.target.value })}
                placeholder="e.g. 1100, 2100"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                Type
              </label>
              <NativeSelect
                value={filters.reference_type}
                onChange={(e) => setFilters({ ...filters, reference_type: e.target.value })}
              >
                <option value="">All Types</option>
                <option value="invoice">Invoice</option>
                <option value="payment">Payment</option>
                <option value="expense">Expense</option>
                <option value="bill">Bill</option>
                <option value="bill_payment">Bill Payment</option>
                <option value="credit_note">Credit Note</option>
                <option value="adjustment_journal">Adjustment</option>
                <option value="reversal">Reversal</option>
                <option value="opening_balance">Opening Balance</option>
                <option value="settlement">Settlement</option>
              </NativeSelect>
            </div>
          </div>
        </div>

        {/* ── Column labels ── */}
        {!loading && entries.length > 0 && (
          <div className="flex items-center justify-between px-4 pb-1.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            <span>Account</span>
            <div className="flex gap-8">
              <span className="w-28 text-right text-slate-500 dark:text-slate-400">Debit</span>
              <span className="w-28 text-right text-slate-500 dark:text-slate-400">Credit</span>
            </div>
          </div>
        )}

        {/* ── Entries ── */}
        {loading ? (
          <LedgerSkeleton />
        ) : entries.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 px-6 py-12 text-center">
            <p className="text-gray-500 dark:text-gray-400">
              Accounting hasn&apos;t started yet. It will begin automatically when you post your first transaction.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                reversalStatus={reversalStatuses[entry.id]}
                canReverseByEngagement={canReverseByEngagement}
                onReverse={openReversalModal}
                currencyCode={currencyCode}
              />
            ))}
          </div>
        )}

        {/* ── Pagination ── */}
        {pagination.totalPages > 1 && (
          <div className="mt-5 flex items-center justify-between bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 px-5 py-3">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {((pagination.page - 1) * pagination.pageSize) + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of{" "}
              <span className="font-semibold text-gray-900 dark:text-white">{pagination.total}</span>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page === 1}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                let pageNum: number
                if (pagination.totalPages <= 5)             pageNum = i + 1
                else if (pagination.page <= 3)              pageNum = i + 1
                else if (pagination.page >= pagination.totalPages - 2) pageNum = pagination.totalPages - 4 + i
                else                                         pageNum = pagination.page - 2 + i
                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                      pagination.page === pageNum
                        ? "bg-blue-600 text-white"
                        : "text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600"
                    }`}
                  >
                    {pageNum}
                  </button>
                )
              })}
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        <ReversalModal
          isOpen={reversalModalOpen}
          onClose={() => { setReversalModalOpen(false); setReversalEntry(null) }}
          entry={reversalEntry}
          onConfirm={handleReversalConfirm}
          onSuccess={handleReversalSuccess}
        />
        <BlockedActionModal
          message={blockedActionMessage ?? ""}
          open={!!blockedActionMessage}
          onClose={() => setBlockedActionMessage(null)}
        />

        {/* Export modal */}
        {exportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Export General Ledger</h2>
                <button
                  onClick={() => setExportModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Choose a date range to export. Leave blank to export all entries.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From</label>
                    <input
                      type="date"
                      value={exportDates.start}
                      onChange={(e) => setExportDates((d) => ({ ...d, start: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To</label>
                    <input
                      type="date"
                      value={exportDates.end}
                      onChange={(e) => setExportDates((d) => ({ ...d, end: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                {exportDates.start && exportDates.end && exportDates.end < exportDates.start && (
                  <p className="text-xs text-red-500">End date must be after start date.</p>
                )}
              </div>
              <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={exportCsv}
                  disabled={exporting || !!(exportDates.start && exportDates.end && exportDates.end < exportDates.start)}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {exporting ? "Exporting…" : "Download CSV"}
                </button>
                <button
                  onClick={() => setExportModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
