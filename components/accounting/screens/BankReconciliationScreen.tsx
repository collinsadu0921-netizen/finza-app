"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { formatMoney } from "@/lib/money"
import {
  allPreviewRowsValid,
  applyColumnMapping,
  buildPreviewRows,
  guessColumnMapping,
  isCompleteMapping,
  parseBankDelimitedText,
  rowsToImportPayload,
  sanitizeImportFilename,
  type ColumnMapping,
  type ParsedBankGrid,
  type PreviewBankRow,
} from "@/lib/reconciliation/bankStatementCsv"

// ─── Types ──────────────────────────────────────────────────────────────────

type Account = {
  id: string
  name: string
  code: string
  type: string
}

type BankTransaction = {
  id: string
  date: string
  description: string
  amount: number
  type: "debit" | "credit"
  status: "unreconciled" | "matched" | "ignored"
  matches: string[] | null
  external_ref: string | null
}

type SystemTransaction = {
  id: string
  date: string
  description: string
  amount: number
  type: "debit" | "credit"
  reference: string | null
  entry_id?: string
}

type Balances = {
  opening: number
  bankEnding: number
  systemEnding: number
  difference: number
}

type FilterMode = "all" | "unreconciled" | "matched" | "ignored"

type ImportPhase = "source" | "mapping" | "review"

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return Number(n).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" })
}

function defaultMappingFromFields(fields: string[]): ColumnMapping {
  const g = guessColumnMapping(fields)
  if (g) return g
  return {
    date: fields[0] ?? "",
    description: fields[1] ?? fields[0] ?? "",
    amount: fields[2] ?? fields[1] ?? fields[0] ?? "",
    reference: fields[3],
  }
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4500)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${type === "success" ? "bg-green-600" : "bg-red-600"}`}>
      {type === "success"
        ? <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        : <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      }
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100 text-base leading-none">×</button>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

type Props = {
  mode?: "accounting" | "service"
  businessId?: string | null
}

export default function BankReconciliationScreen({ mode, businessId }: Props) {
  const { currencyCode } = useBusinessCurrency()
  const homeCode = currencyCode ?? "GHS"

  // Account selection
  const [bankAccounts, setBankAccounts] = useState<Account[]>([])
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>("")

  // Date range
  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = today.slice(0, 8) + "01"
  const [startDate, setStartDate] = useState(firstOfMonth)
  const [endDate, setEndDate] = useState(today)

  // Transaction data
  const [bankTxns, setBankTxns] = useState<BankTransaction[]>([])
  const [sysTxns, setSysTxns] = useState<SystemTransaction[]>([])
  const [balances, setBalances] = useState<Balances | null>(null)
  const [loading, setLoading] = useState(false)

  // Manual match state
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null)
  const [pendingMatchSysId, setPendingMatchSysId] = useState<string | null>(null)
  const [feeAccountId, setFeeAccountId] = useState<string>("")
  const [matchLoading, setMatchLoading] = useState(false)

  // Filter
  const [bankFilter, setBankFilter] = useState<FilterMode>("all")

  // Auto-match
  const [autoMatching, setAutoMatching] = useState(false)
  const [tolerancePct, setTolerancePct] = useState<number>(0)

  // Import panel
  const [showImport, setShowImport] = useState(false)
  const [importPhase, setImportPhase] = useState<ImportPhase>("source")
  const [importInputMode, setImportInputMode] = useState<"upload" | "paste">("upload")
  const [csvRaw, setCsvRaw] = useState("")
  const [hasHeaderRow, setHasHeaderRow] = useState(true)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [parsedGrid, setParsedGrid] = useState<ParsedBankGrid | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [columnMapping, setColumnMapping] = useState<ColumnMapping | null>(null)
  const [previewRows, setPreviewRows] = useState<PreviewBankRow[]>([])
  const [importing, setImporting] = useState(false)
  const [importReviewBackPhase, setImportReviewBackPhase] = useState<"source" | "mapping">("source")
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null)
  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ message, type })
  }

  // ── Load accounts ──────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch("/api/reconciliation/accounts?types=asset").then(r => r.json()),
      fetch("/api/reconciliation/accounts?types=expense").then(r => r.json()),
    ]).then(([assetData, expenseData]) => {
      const assets: Account[] = assetData.accounts || []
      setBankAccounts(assets)
      setExpenseAccounts(expenseData.accounts || [])
      if (assets.length > 0) setSelectedAccountId(assets[0].id)
    }).catch(() => {})
  }, [])

  // ── Load transactions ──────────────────────────────────────────────────────
  const loadTransactions = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate })
      const res = await fetch(`/api/reconciliation/${selectedAccountId}/transactions?${params}`)
      const data = await res.json()
      if (data.bankTransactions) setBankTxns(data.bankTransactions)
      if (data.systemTransactions) setSysTxns(data.systemTransactions)
      if (data.balances) setBalances(data.balances)
    } catch {
      showToast("Failed to load transactions", "error")
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, startDate, endDate])

  useEffect(() => {
    if (selectedAccountId) loadTransactions()
  }, [selectedAccountId, loadTransactions])

  // ── Import ─────────────────────────────────────────────────────────────────
  function resetImportFlow() {
    setImportPhase("source")
    setImportInputMode("upload")
    setCsvRaw("")
    setHasHeaderRow(true)
    setUploadedFileName(null)
    setParsedGrid(null)
    setParseError(null)
    setParseWarnings([])
    setColumnMapping(null)
    setPreviewRows([])
    setImportReviewBackPhase("source")
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function openImportModal() {
    setShowImport(true)
    resetImportFlow()
  }

  function closeImportModal() {
    setShowImport(false)
    resetImportFlow()
  }

  function advanceParsedGrid(grid: ParsedBankGrid) {
    setParsedGrid(grid)
    setParseWarnings(grid.parseWarnings)
    const guess = guessColumnMapping(grid.fields)
    if (guess && isCompleteMapping(guess)) {
      setColumnMapping(guess)
      const mapped = applyColumnMapping(grid.rows, guess)
      setPreviewRows(buildPreviewRows(mapped))
      setImportReviewBackPhase("source")
      setImportPhase("review")
    } else {
      setColumnMapping(defaultMappingFromFields(grid.fields))
      setImportPhase("mapping")
    }
  }

  function processDelimitedText(text: string, filename: string | null) {
    setParseError(null)
    const result = parseBankDelimitedText(text, { hasHeaderRow })
    if ("error" in result) {
      setParseError(result.error)
      setParsedGrid(null)
      setPreviewRows([])
      showToast(result.error, "error")
      return
    }
    if (filename) {
      setUploadedFileName(sanitizeImportFilename(filename))
    } else {
      setUploadedFileName(null)
    }
    advanceParsedGrid(result)
  }

  function handleBankFileSelected(file: File | null) {
    if (!file) return
    const lower = file.name.toLowerCase()
    if (!lower.endsWith(".csv")) {
      showToast("Please choose a .csv file.", "error")
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : ""
      processDelimitedText(text, file.name)
    }
    reader.onerror = () => {
      showToast("Could not read the file.", "error")
    }
    reader.readAsText(file, "UTF-8")
  }

  function handlePasteContinue() {
    processDelimitedText(csvRaw, null)
  }

  function handleApplyMapping() {
    if (!parsedGrid || !columnMapping || !isCompleteMapping(columnMapping)) {
      showToast("Select date, description, and amount columns.", "error")
      return
    }
    const { date, description, amount } = columnMapping
    if (!parsedGrid.fields.includes(date) || !parsedGrid.fields.includes(description) || !parsedGrid.fields.includes(amount)) {
      showToast("Each mapped column must exist in the file.", "error")
      return
    }
    const mapped = applyColumnMapping(parsedGrid.rows, columnMapping)
    setPreviewRows(buildPreviewRows(mapped))
    setImportReviewBackPhase("mapping")
    setImportPhase("review")
  }

  async function handleConfirmImport() {
    if (!selectedAccountId || !allPreviewRowsValid(previewRows)) return
    setImporting(true)
    try {
      const rows = rowsToImportPayload(previewRows)
      const res = await fetch(`/api/reconciliation/${selectedAccountId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows,
          meta: {
            source: uploadedFileName ? "file" : "paste",
            filename: uploadedFileName,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        const extra =
          Array.isArray(data.rowErrors) && data.rowErrors.length > 0
            ? ` Row ${data.rowErrors[0].rowIndex}: ${data.rowErrors[0].errors?.join("; ")}`
            : ""
        throw new Error((data.error || "Import failed") + extra)
      }
      showToast(`Imported ${data.count} transactions`)
      closeImportModal()
      loadTransactions()
    } catch (e: any) {
      showToast(e.message || "Import failed", "error")
    } finally {
      setImporting(false)
    }
  }

  // ── Auto-match ──────────────────────────────────────────────────────────────
  async function handleAutoMatch() {
    if (!selectedAccountId) return
    setAutoMatching(true)
    try {
      const res = await fetch(`/api/reconciliation/${selectedAccountId}/auto-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: startDate, end_date: endDate, date_tolerance_days: 3, amount_tolerance_pct: tolerancePct }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Auto-match failed")
      const count = data.matches?.length ?? 0
      showToast(count > 0 ? `Auto-matched ${count} transaction${count === 1 ? "" : "s"}` : "No new matches found")
      loadTransactions()
    } catch (e: any) {
      showToast(e.message || "Auto-match failed", "error")
    } finally {
      setAutoMatching(false)
    }
  }

  // ── Manual match ─────────────────────────────────────────────────────────────
  function handleBankClick(id: string) {
    const txn = bankTxns.find(t => t.id === id)
    if (!txn || txn.status === "matched" || txn.status === "ignored") return
    if (selectedBankId === id) { setSelectedBankId(null); setPendingMatchSysId(null); return }
    setSelectedBankId(id)
    setPendingMatchSysId(null)
    setFeeAccountId("")
  }

  function handleSysClick(id: string) {
    if (!selectedBankId) return
    setPendingMatchSysId(prev => prev === id ? null : id)
  }

  // Compute fee difference for selected pair
  const selectedBankTxn = selectedBankId ? bankTxns.find(t => t.id === selectedBankId) : null
  const pendingSysTxn = pendingMatchSysId ? sysTxns.find(t => t.id === pendingMatchSysId) : null
  const feeDifference = selectedBankTxn && pendingSysTxn
    ? Math.abs(Math.abs(pendingSysTxn.amount) - Math.abs(selectedBankTxn.amount))
    : 0
  const hasDifference = feeDifference > 0.005

  async function confirmMatch() {
    if (!selectedBankId || !pendingMatchSysId || !selectedAccountId) return
    if (hasDifference && !feeAccountId) {
      showToast("Select a fee account to book the difference, or ignore if not needed.", "error")
      return
    }
    setMatchLoading(true)
    try {
      const body: Record<string, any> = {
        bank_transaction_id: selectedBankId,
        system_transaction_ids: [pendingMatchSysId],
      }
      if (hasDifference && feeAccountId) {
        body.fee_amount = feeDifference
        body.fee_account_id = feeAccountId
        body.transaction_date = selectedBankTxn?.date
      }
      const res = await fetch(`/api/reconciliation/${selectedAccountId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Match failed")
      showToast(
        hasDifference
          ? `Matched — ${formatMoney(feeDifference, homeCode)} fee posted to expense account`
          : "Transactions matched"
      )
      setSelectedBankId(null); setPendingMatchSysId(null); setFeeAccountId("")
      loadTransactions()
    } catch (e: any) {
      showToast(e.message || "Match failed", "error")
    } finally {
      setMatchLoading(false)
    }
  }

  // ── Ignore / Unmatch ─────────────────────────────────────────────────────────
  async function handleIgnore(bankId: string, ignore: boolean) {
    if (!selectedAccountId) return
    try {
      const res = await fetch(`/api/reconciliation/${selectedAccountId}/ignore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank_transaction_id: bankId, ignore }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      showToast(ignore ? "Transaction ignored" : "Transaction restored")
      loadTransactions()
    } catch (e: any) {
      showToast(e.message || "Failed", "error")
    }
  }

  async function handleUnmatch(bankId: string) {
    if (!selectedAccountId) return
    try {
      const res = await fetch(`/api/reconciliation/${selectedAccountId}/unmatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank_transaction_id: bankId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      showToast("Transaction unmatched")
      loadTransactions()
    } catch (e: any) {
      showToast(e.message || "Failed", "error")
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const filteredBankTxns = bankFilter === "all" ? bankTxns : bankTxns.filter(t => t.status === bankFilter)
  const matchedSysIds = new Set(bankTxns.filter(t => t.status === "matched").flatMap(t => t.matches ?? []))
  const unreconciledCount = bankTxns.filter(t => t.status === "unreconciled").length
  const matchedCount = bankTxns.filter(t => t.status === "matched").length
  const ignoredCount = bankTxns.filter(t => t.status === "ignored").length
  const isDiff0 = balances && Math.abs(balances.difference) < 0.005

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Bank Reconciliation</h1>
          <p className="text-sm text-slate-500 mt-0.5">Match bank statement transactions to your system journal entries</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={openImportModal}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            Import
          </button>
          {/* Tolerance field */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-xs text-slate-500 whitespace-nowrap">Fee tolerance</span>
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={tolerancePct}
              onChange={e => setTolerancePct(Number(e.target.value))}
              className="w-14 text-sm border-0 focus:outline-none focus:ring-0 text-center"
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
          <button
            onClick={handleAutoMatch}
            disabled={autoMatching || !selectedAccountId}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {autoMatching
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            }
            Auto-Match
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Account</label>
          <select
            value={selectedAccountId}
            onChange={e => { setSelectedAccountId(e.target.value); setSelectedBankId(null); setPendingMatchSysId(null) }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {bankAccounts.length === 0 && <option value="">No accounts</option>}
            {bankAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button
          onClick={loadTransactions}
          disabled={loading || !selectedAccountId}
          className="px-4 py-2 text-sm font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load"}
        </button>
      </div>

      {/* Matching hint + fee panel */}
      {selectedBankId && (
        <div className={`border rounded-lg px-4 py-3 text-sm ${hasDifference && pendingMatchSysId ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className={hasDifference && pendingMatchSysId ? "text-amber-800" : "text-blue-800"}>
              {!pendingMatchSysId && (
                <span><strong>Matching mode:</strong> Click a system transaction on the right to select it for matching.</span>
              )}
              {pendingMatchSysId && !hasDifference && (
                <span><strong>Exact match found.</strong> Click Confirm Match to proceed.</span>
              )}
              {pendingMatchSysId && hasDifference && (
                <div className="space-y-2">
                  <p>
                    <strong>Amount difference: {formatMoney(feeDifference, homeCode)}</strong> — this is likely a payment processor fee (Paystack, MoMo, etc.).
                    Select an expense account to book it.
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs font-medium text-amber-700 whitespace-nowrap">Book fee to:</label>
                    <select
                      value={feeAccountId}
                      onChange={e => setFeeAccountId(e.target.value)}
                      className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 min-w-[200px]"
                    >
                      <option value="">— select expense account —</option>
                      {expenseAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                      ))}
                    </select>
                    <span className="text-xs text-amber-600">(creates JE: Dr this account / Cr bank for {formatMoney(feeDifference, homeCode)})</span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              {pendingMatchSysId && (
                <button
                  onClick={confirmMatch}
                  disabled={matchLoading || (hasDifference && !feeAccountId)}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {matchLoading ? "Matching…" : "Confirm Match"}
                </button>
              )}
              <button
                onClick={() => { setSelectedBankId(null); setPendingMatchSysId(null); setFeeAccountId("") }}
                className="text-xs text-blue-600 underline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Two-column workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Bank Statement */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Bank Statement</h2>
              <p className="text-xs text-slate-400 mt-0.5">{bankTxns.length} imported · {unreconciledCount} unmatched</p>
            </div>
            <div className="flex gap-1 flex-wrap">
              {(["all", "unreconciled", "matched", "ignored"] as FilterMode[]).map(f => (
                <button
                  key={f}
                  onClick={() => setBankFilter(f)}
                  className={`px-2 py-1 text-xs rounded-md font-medium ${bankFilter === f ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {f === "all" ? `All (${bankTxns.length})` : f === "unreconciled" ? `Open (${unreconciledCount})` : f === "matched" ? `Matched (${matchedCount})` : `Ignored (${ignoredCount})`}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-50 max-h-[480px] overflow-y-auto">
            {loading && <div className="py-12 text-center text-slate-400 text-sm">Loading…</div>}
            {!loading && filteredBankTxns.length === 0 && (
              <div className="py-12 text-center text-slate-400 text-sm">
                {bankTxns.length === 0 ? "No bank transactions imported yet. Click Import to add." : "No transactions match this filter."}
              </div>
            )}
            {!loading && filteredBankTxns.map(txn => {
              const isSelected = selectedBankId === txn.id
              const isMatched = txn.status === "matched"
              const isIgnored = txn.status === "ignored"
              return (
                <div
                  key={txn.id}
                  onClick={() => handleBankClick(txn.id)}
                  className={`px-4 py-3 transition-colors ${
                    isSelected ? "bg-blue-50 border-l-2 border-blue-500" :
                    isMatched ? "bg-green-50" :
                    isIgnored ? "opacity-40" :
                    "hover:bg-slate-50 cursor-pointer"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {isMatched && (
                        <span className="shrink-0 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        </span>
                      )}
                      {isIgnored && (
                        <span className="shrink-0 w-4 h-4 rounded-full bg-slate-300 flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                        </span>
                      )}
                      {!isMatched && !isIgnored && (
                        <span className={`shrink-0 w-4 h-4 rounded-full border-2 ${isSelected ? "border-blue-500 bg-blue-100" : "border-slate-300"}`} />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{txn.description || "—"}</p>
                        <p className="text-xs text-slate-400">{fmtDate(txn.date)}{txn.external_ref ? ` · ${txn.external_ref}` : ""}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold ${txn.type === "credit" ? "text-green-700" : "text-slate-800"}`}>
                        {txn.type === "debit" ? "−" : "+"}
                        {formatMoney(txn.amount, homeCode)}
                      </p>
                      <p className="text-xs text-slate-400 capitalize">{txn.type}</p>
                    </div>
                  </div>
                  <div className="mt-1.5 flex gap-2" onClick={e => e.stopPropagation()}>
                    {isMatched && (
                      <button onClick={() => handleUnmatch(txn.id)} className="text-xs text-orange-600 hover:underline">Unmatch</button>
                    )}
                    {!isIgnored && !isMatched && (
                      <button onClick={() => handleIgnore(txn.id, true)} className="text-xs text-slate-400 hover:text-slate-600 hover:underline">Ignore</button>
                    )}
                    {isIgnored && (
                      <button onClick={() => handleIgnore(txn.id, false)} className="text-xs text-blue-600 hover:underline">Restore</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* System Transactions */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">System Transactions</h2>
            <p className="text-xs text-slate-400 mt-0.5">From journal entries · {sysTxns.length} total{selectedBankId ? " · click to match" : ""}</p>
          </div>
          <div className="divide-y divide-slate-50 max-h-[480px] overflow-y-auto">
            {loading && <div className="py-12 text-center text-slate-400 text-sm">Loading…</div>}
            {!loading && sysTxns.length === 0 && (
              <div className="py-12 text-center text-slate-400 text-sm">No journal entry lines for this period.</div>
            )}
            {!loading && sysTxns.map(txn => {
              const isMatchedSys = matchedSysIds.has(txn.id)
              const isPending = pendingMatchSysId === txn.id
              const isClickable = !!selectedBankId && !isMatchedSys
              const selectedBankAmt = selectedBankTxn ? Number(selectedBankTxn.amount) : 0
              const diff = isClickable ? Math.abs(Math.abs(Number(txn.amount)) - selectedBankAmt) : 0
              const hasDiff = diff > 0.005

              return (
                <div
                  key={txn.id}
                  onClick={() => handleSysClick(txn.id)}
                  className={`px-4 py-3 transition-colors ${
                    isPending ? "bg-blue-50 border-l-2 border-blue-500" :
                    isMatchedSys ? "bg-green-50" :
                    isClickable ? "hover:bg-slate-50 cursor-pointer" :
                    ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {isMatchedSys
                        ? <span className="shrink-0 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center"><svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg></span>
                        : <span className={`shrink-0 w-4 h-4 rounded-full border-2 ${isPending ? "border-blue-500 bg-blue-100" : "border-slate-300"}`} />
                      }
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{txn.description || "—"}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-slate-400">{fmtDate(txn.date)}{txn.reference ? ` · ${txn.reference}` : ""}</p>
                          {isClickable && hasDiff && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                              Δ {formatMoney(diff, homeCode)} fee
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold ${txn.type === "credit" ? "text-green-700" : "text-slate-800"}`}>
                        {txn.type === "debit" ? "−" : "+"}
                        {formatMoney(txn.amount, homeCode)}
                      </p>
                      <p className="text-xs text-slate-400 capitalize">{txn.type}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Period Summary */}
      {balances && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Period Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-slate-500">Opening Balance</p>
              <p className="text-lg font-bold text-slate-800 mt-1">{formatMoney(balances.opening, homeCode)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Bank Ending</p>
              <p className="text-lg font-bold text-slate-800 mt-1">{formatMoney(balances.bankEnding, homeCode)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">System Balance</p>
              <p className="text-lg font-bold text-slate-800 mt-1">{formatMoney(balances.systemEnding, homeCode)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Difference</p>
              <p className={`text-lg font-bold mt-1 ${isDiff0 ? "text-green-600" : "text-red-600"}`}>
                {formatMoney(Math.abs(balances.difference), homeCode)}
                {isDiff0 && <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Reconciled</span>}
              </p>
            </div>
          </div>
          {!isDiff0 && balances.difference !== 0 && (
            <p className="text-xs text-red-500 mt-3">
              Unreconciled difference of {formatMoney(Math.abs(balances.difference), homeCode)}. Match or ignore remaining bank transactions to reconcile.
            </p>
          )}
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-base font-semibold text-slate-800">Import bank transactions</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  One signed amount per row: positive = credit (money in), negative = debit (money out).
                </p>
              </div>
              <button type="button" onClick={closeImportModal} className="text-slate-400 hover:text-slate-600" aria-label="Close">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
              {importPhase === "source" && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setImportInputMode("upload")}
                      className={`text-left rounded-xl border-2 p-4 transition-colors ${
                        importInputMode === "upload"
                          ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-200"
                          : "border-slate-200 hover:border-slate-300 bg-white"
                      }`}
                    >
                      <div className="text-sm font-semibold text-slate-800">Upload statement file</div>
                      <p className="text-xs text-slate-500 mt-1">Recommended — CSV export from your bank or wallet.</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportInputMode("paste")}
                      className={`text-left rounded-xl border-2 p-4 transition-colors ${
                        importInputMode === "paste"
                          ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-200"
                          : "border-slate-200 hover:border-slate-300 bg-white"
                      }`}
                    >
                      <div className="text-sm font-semibold text-slate-800">Paste CSV manually</div>
                      <p className="text-xs text-slate-500 mt-1">Fallback when you cannot save a file.</p>
                    </button>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasHeaderRow}
                      onChange={e => setHasHeaderRow(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    First row contains column headers
                  </label>

                  {importInputMode === "upload" && (
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        onChange={e => {
                          handleBankFileSelected(e.target.files?.[0] ?? null)
                          e.target.value = ""
                        }}
                      />
                      <div
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            fileInputRef.current?.click()
                          }
                        }}
                        onDragOver={e => {
                          e.preventDefault()
                          e.stopPropagation()
                        }}
                        onDrop={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          const f = e.dataTransfer.files?.[0]
                          if (f) handleBankFileSelected(f)
                        }}
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-slate-50/80 transition-colors"
                      >
                        <p className="text-sm font-medium text-slate-700">Drop or click to select a CSV file</p>
                        <p className="text-xs text-slate-500 mt-1">Only .csv is supported in this release.</p>
                      </div>
                    </div>
                  )}

                  {importInputMode === "paste" && (
                    <div className="space-y-2">
                      <p className="text-sm text-slate-600">
                        Paste exported data (comma or tab separated). If headers are not recognized, you will map columns on the next step.
                      </p>
                      <textarea
                        value={csvRaw}
                        onChange={e => setCsvRaw(e.target.value)}
                        placeholder={"date,description,amount,reference\n2024-03-01,Paystack settlement,985.00,PAY-001"}
                        rows={10}
                        className="w-full rounded-lg border border-slate-200 p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={handlePasteContinue} disabled={!csvRaw.trim()} className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                          Parse & continue
                        </button>
                      </div>
                    </div>
                  )}

                  {parseError && (
                    <div className="rounded-lg bg-red-50 border border-red-100 text-red-800 text-sm px-3 py-2">
                      {parseError}
                    </div>
                  )}
                  {parseWarnings.length > 0 && (
                    <div className="rounded-lg bg-amber-50 border border-amber-100 text-amber-900 text-sm px-3 py-2 space-y-1">
                      <p className="font-medium text-xs uppercase tracking-wide text-amber-800">Parse notices</p>
                      <ul className="list-disc list-inside text-xs">
                        {parseWarnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {importPhase === "mapping" && parsedGrid && columnMapping && (
                <>
                  <p className="text-sm text-slate-600">
                    We could not confidently detect all columns. Map each field to a column from your file ({parsedGrid.rows.length} data rows).
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {(["date", "description", "amount", "reference"] as const).map(key => (
                      <div key={key}>
                        <label className="block text-xs font-medium text-slate-500 mb-1 capitalize">
                          {key === "reference" ? "Reference (optional)" : key}
                        </label>
                        <select
                          value={key === "reference" ? (columnMapping.reference ?? "") : columnMapping[key]}
                          onChange={e => {
                            const v = e.target.value
                            setColumnMapping(prev => {
                              if (!prev) return prev
                              if (key === "reference") {
                                return { ...prev, reference: v || undefined }
                              }
                              return { ...prev, [key]: v }
                            })
                          }}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">{key === "reference" ? "— None —" : "— Select column —"}</option>
                          {parsedGrid.fields.map(f => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setImportPhase("source")
                        setParsedGrid(null)
                        setColumnMapping(null)
                        setParseError(null)
                      }}
                      className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                    >
                      Back
                    </button>
                    <button type="button" onClick={handleApplyMapping} className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      Preview import
                    </button>
                  </div>
                </>
              )}

              {importPhase === "review" && (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm text-slate-700">
                      <span className="font-semibold">{previewRows.length}</span> rows — review before confirming.
                    </p>
                    {!allPreviewRowsValid(previewRows) && (
                      <span className="text-xs font-medium text-red-600">Fix invalid rows or adjust mapping — import is blocked until all rows pass.</span>
                    )}
                  </div>
                  <div className="max-h-[min(360px,45vh)] overflow-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-500 w-10">#</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-500">Date</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-500">Description</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-500">Amount</th>
                          <th className="px-3 py-2 text-center font-medium text-slate-500 w-20">Type</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-500">Reference</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-500">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {previewRows.map(r => (
                          <tr key={r.rowIndex} className={r.errors.length ? "bg-red-50/50" : "hover:bg-slate-50"}>
                            <td className="px-3 py-2 text-slate-400">{r.rowIndex}</td>
                            <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.dateDisplay}</td>
                            <td className="px-3 py-2 text-slate-800 max-w-[200px] truncate" title={r.description}>{r.description}</td>
                            <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${r.signedAmount != null && r.signedAmount < 0 ? "text-slate-800" : "text-green-700"}`}>
                              {r.signedAmount == null ? "—" : (
                                <>{r.signedAmount < 0 ? "−" : "+"}{formatMoney(Math.abs(r.signedAmount), homeCode)}</>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center capitalize text-slate-600">{r.type ?? "—"}</td>
                            <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">{r.reference || "—"}</td>
                            <td className="px-3 py-2">
                              {r.errors.length === 0
                                ? <span className="text-green-700 font-medium">OK</span>
                                : <span className="text-red-700">{r.errors.join("; ")}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (importReviewBackPhase === "mapping") {
                            setImportPhase("mapping")
                          } else {
                            setImportPhase("source")
                            setParsedGrid(null)
                            setPreviewRows([])
                            setParseError(null)
                          }
                        }}
                        className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                      >
                        Back
                      </button>
                      {parsedGrid && (
                        <button
                          type="button"
                          onClick={() => setImportPhase("mapping")}
                          className="px-4 py-2 text-sm text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50"
                        >
                          Adjust columns
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleConfirmImport}
                      disabled={importing || !allPreviewRowsValid(previewRows)}
                      className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {importing ? "Importing…" : `Import ${previewRows.length} transactions`}
                    </button>
                  </div>
                </>
              )}
            </div>

            {importPhase === "source" && (
              <div className="px-6 py-3 border-t border-slate-100 flex justify-end shrink-0">
                <button type="button" onClick={closeImportModal} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
