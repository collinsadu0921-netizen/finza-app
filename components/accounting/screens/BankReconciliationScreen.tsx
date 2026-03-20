"use client"

import { useEffect, useState, useCallback } from "react"

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

type ParsedRow = {
  date: string
  description: string
  amount: number
  reference: string
}

type FilterMode = "all" | "unreconciled" | "matched" | "ignored"

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return Number(n).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" })
}

function parseCSV(raw: string): ParsedRow[] {
  const lines = raw.trim().split("\n").filter(l => l.trim())
  if (lines.length === 0) return []
  const firstLine = lines[0].toLowerCase()
  const hasHeader = firstLine.includes("date") || firstLine.includes("description") || firstLine.includes("amount")
  const dataLines = hasHeader ? lines.slice(1) : lines
  const rows: ParsedRow[] = []
  for (const line of dataLines) {
    const cols = line.includes("\t") ? line.split("\t") : line.split(",")
    const [rawDate, rawDesc, rawAmount, rawRef] = cols.map(c => c.trim().replace(/^"|"$/g, ""))
    const amount = parseFloat(rawAmount?.replace(/[^0-9.\-]/g, "") || "0")
    if (!rawDate || isNaN(amount) || amount === 0) continue
    rows.push({ date: rawDate, description: rawDesc || "", amount, reference: rawRef || "" })
  }
  return rows
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
  const [csvRaw, setCsvRaw] = useState("")
  const [parsedRows, setParsedRows] = useState<ParsedRow[] | null>(null)
  const [importing, setImporting] = useState(false)

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
  function handlePreviewCSV() {
    const rows = parseCSV(csvRaw)
    if (rows.length === 0) { showToast("No valid rows found. Check your CSV format.", "error"); return }
    setParsedRows(rows)
  }

  async function handleConfirmImport() {
    if (!parsedRows || parsedRows.length === 0 || !selectedAccountId) return
    setImporting(true)
    try {
      const res = await fetch(`/api/reconciliation/${selectedAccountId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Import failed")
      showToast(`Imported ${data.count} transactions`)
      setShowImport(false); setCsvRaw(""); setParsedRows(null)
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
      showToast(hasDifference ? `Matched — GHS ${fmt(feeDifference)} fee posted to expense account` : "Transactions matched")
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
            onClick={() => { setShowImport(true); setParsedRows(null); setCsvRaw("") }}
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
                    <strong>Amount difference: GHS {fmt(feeDifference)}</strong> — this is likely a payment processor fee (Paystack, MoMo, etc.).
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
                    <span className="text-xs text-amber-600">(creates JE: Dr this account / Cr bank for GHS {fmt(feeDifference)})</span>
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
                        {txn.type === "debit" ? "−" : "+"}GHS {fmt(txn.amount)}
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
                              Δ {fmt(diff)} fee
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold ${txn.type === "credit" ? "text-green-700" : "text-slate-800"}`}>
                        {txn.type === "debit" ? "−" : "+"}GHS {fmt(txn.amount)}
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
              <p className="text-lg font-bold text-slate-800 mt-1">GHS {fmt(balances.opening)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Bank Ending</p>
              <p className="text-lg font-bold text-slate-800 mt-1">GHS {fmt(balances.bankEnding)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">System Balance</p>
              <p className="text-lg font-bold text-slate-800 mt-1">GHS {fmt(balances.systemEnding)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Difference</p>
              <p className={`text-lg font-bold mt-1 ${isDiff0 ? "text-green-600" : "text-red-600"}`}>
                GHS {fmt(Math.abs(balances.difference))}
                {isDiff0 && <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Reconciled</span>}
              </p>
            </div>
          </div>
          {!isDiff0 && balances.difference !== 0 && (
            <p className="text-xs text-red-500 mt-3">
              Unreconciled difference of GHS {fmt(Math.abs(balances.difference))}. Match or ignore remaining bank transactions to reconcile.
            </p>
          )}
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">Import Bank Transactions</h2>
              <button onClick={() => setShowImport(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {!parsedRows ? (
                <>
                  <p className="text-sm text-slate-600">
                    Paste CSV data below. Columns: <code className="bg-slate-100 px-1 rounded text-xs">date, description, amount, reference</code><br />
                    Positive amounts = credit (money in), negative = debit (money out). First row may be a header.
                  </p>
                  <textarea
                    value={csvRaw}
                    onChange={e => setCsvRaw(e.target.value)}
                    placeholder={"date,description,amount,reference\n2024-03-01,Paystack settlement,985.00,PAY-001\n2024-03-05,Customer MoMo receipt,4900,MM-042"}
                    rows={10}
                    className="w-full rounded-lg border border-slate-200 p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowImport(false)} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
                    <button onClick={handlePreviewCSV} disabled={!csvRaw.trim()} className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">Preview</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-600">{parsedRows.length} transactions parsed. Review before importing:</p>
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-500">Date</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-500">Description</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-500">Amount</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-500">Ref</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsedRows.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-600">{r.date}</td>
                            <td className="px-3 py-2 text-slate-700">{r.description}</td>
                            <td className={`px-3 py-2 text-right font-medium ${r.amount < 0 ? "text-slate-800" : "text-green-700"}`}>
                              {r.amount < 0 ? "−" : "+"}GHS {fmt(Math.abs(r.amount))}
                            </td>
                            <td className="px-3 py-2 text-slate-400">{r.reference || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setParsedRows(null)} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Back</button>
                    <button onClick={handleConfirmImport} disabled={importing} className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                      {importing ? "Importing…" : `Import ${parsedRows.length} Transactions`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
