"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { buildServiceRoute } from "@/lib/service/routes"
import { isBankOrCashSubType, isLoanSubType } from "@/lib/service/accounting/intentTypes"

// ─── Types ────────────────────────────────────────────────────────────────────

type Account = {
  id: string
  code: string
  name: string
  type: string
  sub_type?: string | null
}

type LoanMode = "drawdown" | "repayment"

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Mode tab ─────────────────────────────────────────────────────────────────

function ModeTab({
  active,
  onClick,
  label,
  description,
}: {
  active: boolean
  onClick: () => void
  label: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-4 py-3 rounded-lg border text-left transition-colors ${
        active
          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-500"
          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
      }`}
    >
      <div className={`text-sm font-semibold ${active ? "text-blue-700 dark:text-blue-300" : "text-gray-900 dark:text-gray-100"}`}>
        {label}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</div>
    </button>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ServiceLoanPage() {
  const router = useRouter()

  const [loading, setLoading]       = useState(true)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [coaLoaded, setCoaLoaded]   = useState(false)

  const [mode, setMode]                     = useState<LoanMode>("drawdown")
  const [bankCashAccounts, setBankCashAccounts] = useState<Account[]>([])
  const [loanAccounts, setLoanAccounts]         = useState<Account[]>([])

  const [entryDate, setEntryDate]     = useState(todayIso())
  const [amount, setAmount]           = useState<number | "">("")
  const [bankId, setBankId]           = useState<string | null>(null)
  const [loanAccountId, setLoanAccountId] = useState<string | null>(null)
  const [description, setDescription] = useState("")

  const [error, setError]           = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirm, setShowConfirm]   = useState(false)

  // ── Load business ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setLoading(false); return }
        const b = await getCurrentBusiness(supabase, user.id)
        if (!cancelled && b) setBusinessId(b.id)
      } catch (_) {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── Load chart of accounts ─────────────────────────────────────────────────
  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    async function fetchCoa() {
      setCoaLoaded(false)
      try {
        const res = await fetch(`/api/accounting/coa?business_id=${encodeURIComponent(businessId ?? "")}`)
        if (!res.ok) return
        const data = await res.json()
        const accounts: Account[] = data.accounts ?? []
        if (cancelled) return

        const bankCash = accounts.filter((a) => a.type === "asset" && isBankOrCashSubType(a.sub_type))
        const loans    = accounts.filter((a) => a.type === "liability" && isLoanSubType(a.sub_type))

        setBankCashAccounts(bankCash)
        setLoanAccounts(loans)

        if (bankCash.length >= 1) setBankId(bankCash[0].id)
        if (loans.length >= 1)    setLoanAccountId(loans[0].id)
      } catch (_) {
        // ignore
      } finally {
        if (!cancelled) setCoaLoaded(true)
      }
    }
    fetchCoa()
    return () => { cancelled = true }
  }, [businessId])

  // ── Derived state ──────────────────────────────────────────────────────────
  const numAmount    = amount === "" ? 0 : Number(amount)
  const noBankCash   = coaLoaded && bankCashAccounts.length === 0
  const noLoanAccs   = coaLoaded && loanAccounts.length === 0
  const formDisabled = noBankCash || noLoanAccs
  const isValid      = numAmount > 0 && bankId != null && loanAccountId != null
  const canPost      = Boolean(businessId && isValid && !isSubmitting && !formDisabled)

  const selectedBank = bankCashAccounts.find((a) => a.id === bankId)
  const selectedLoan = loanAccounts.find((a) => a.id === loanAccountId)

  // DR/CR depends on mode:
  //   drawdown  → Dr Bank/Cash, Cr Loan Liability
  //   repayment → Dr Loan Liability, Cr Bank/Cash
  const drAccount = mode === "drawdown" ? selectedBank : selectedLoan
  const crAccount = mode === "drawdown" ? selectedLoan  : selectedBank

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleConfirmPost = async () => {
    if (!canPost || !businessId || !bankId || !loanAccountId || numAmount <= 0) return
    setIsSubmitting(true)
    setError("")
    try {
      const intentType = mode === "drawdown" ? "LOAN_DRAWDOWN" : "LOAN_REPAYMENT"
      const defaultDesc = mode === "drawdown" ? "Loan Drawdown" : "Loan Repayment"

      const res = await fetch("/api/service/accounting/post-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          intent: {
            intent_type:             intentType,
            entry_date:              entryDate,
            amount:                  numAmount,
            bank_or_cash_account_id: bankId,
            loan_account_id:         loanAccountId,
            description:             (description || defaultDesc).trim() || undefined,
          },
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to record loan transaction.")
        setIsSubmitting(false)
        setShowConfirm(false)
        return
      }

      const journalEntryId = data.journal_entry_id
      if (journalEntryId) {
        router.push(`${buildServiceRoute("/service/ledger", businessId)}&highlight=${journalEntryId}`)
        return
      }
      setError("Recorded but could not open ledger.")
    } catch (_) {
      setError("Something went wrong. Please try again.")
    } finally {
      setIsSubmitting(false)
      setShowConfirm(false)
    }
  }

  // ── Loading / no business guards ───────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading…</p>
      </div>
    )
  }

  if (!businessId) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-gray-600 dark:text-gray-400">
          No business found. You need an active business to record loan transactions.
        </p>
        <button
          type="button"
          onClick={() => router.push("/service/accounting")}
          className="mt-4 text-blue-600 dark:text-blue-400 hover:underline text-sm"
        >
          ← Back to Accounting
        </button>
      </div>
    )
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button
        type="button"
        onClick={() => router.push("/service/accounting")}
        className="text-blue-600 dark:text-blue-400 hover:underline mb-4 text-sm"
      >
        ← Back to Accounting
      </button>

      <h1 className="text-2xl font-bold mb-1 text-gray-900 dark:text-white">Loans</h1>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
        Record money borrowed from a lender or a principal repayment. Interest expense is recorded separately as a bill.
      </p>

      {/* Mode selector */}
      <div className="flex gap-3 mb-6">
        <ModeTab
          active={mode === "drawdown"}
          onClick={() => { setMode("drawdown"); setError("") }}
          label="Loan Drawdown"
          description="Money received from lender — Dr Bank, Cr Loan"
        />
        <ModeTab
          active={mode === "repayment"}
          onClick={() => { setMode("repayment"); setError("") }}
          label="Loan Repayment"
          description="Principal repaid to lender — Dr Loan, Cr Bank"
        />
      </div>

      {/* Warning banners */}
      {noBankCash && (
        <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-amber-800 dark:text-amber-200 text-sm">
          No bank or cash account found. Please create one in Chart of Accounts.
        </div>
      )}
      {noLoanAccs && (
        <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-amber-800 dark:text-amber-200 text-sm">
          No loan accounts found. Accounts 2300 (Short-term Loan) and 2310 (Long-term Bank Loan) should have been created automatically — if missing, add them in Chart of Accounts with type <strong>Liability</strong>.
        </div>
      )}

      {/* Form fields */}
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            disabled={isSubmitting || formDisabled}
            className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount === "" ? "" : amount}
            onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="0.00"
            disabled={isSubmitting || formDisabled}
            className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Bank / Cash Account
          </label>
          <select
            value={bankId ?? ""}
            onChange={(e) => setBankId(e.target.value || null)}
            disabled={isSubmitting || formDisabled}
            className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60"
          >
            <option value="">Select account…</option>
            {bankCashAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} – {a.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Loan Account
          </label>
          <select
            value={loanAccountId ?? ""}
            onChange={(e) => setLoanAccountId(e.target.value || null)}
            disabled={isSubmitting || formDisabled}
            className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60"
          >
            <option value="">Select loan account…</option>
            {loanAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} – {a.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            2300 = Short-term Loan · 2310 = Long-term Bank Loan
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Description <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={mode === "drawdown" ? "e.g. GCB Bank term loan" : "e.g. Monthly principal repayment"}
            disabled={isSubmitting || formDisabled}
            className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60"
          />
        </div>
      </div>

      {/* DR / CR preview */}
      {isValid && drAccount && crAccount && (
        <div className="mb-6 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-800/50 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">This will post:</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                  <th className="text-left py-2 px-4 font-medium">Account</th>
                  <th className="text-right py-2 px-4 font-medium">Debit</th>
                  <th className="text-right py-2 px-4 font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 px-4 text-gray-900 dark:text-gray-100">
                    {drAccount.code} – {drAccount.name}
                  </td>
                  <td className="py-2 px-4 text-right text-gray-700 dark:text-gray-300">
                    {numAmount.toFixed(2)}
                  </td>
                  <td className="py-2 px-4 text-right" />
                </tr>
                <tr className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 px-4 text-gray-900 dark:text-gray-100">
                    {crAccount.code} – {crAccount.name}
                  </td>
                  <td className="py-2 px-4 text-right" />
                  <td className="py-2 px-4 text-right text-gray-700 dark:text-gray-300">
                    {numAmount.toFixed(2)}
                  </td>
                </tr>
                <tr className="bg-gray-50 dark:bg-gray-800/50 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  <td className="py-2 px-4">Total</td>
                  <td className="py-2 px-4 text-right text-gray-900 dark:text-gray-100">{numAmount.toFixed(2)}</td>
                  <td className="py-2 px-4 text-right text-gray-900 dark:text-gray-100">{numAmount.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <p className="mb-4 text-red-600 dark:text-red-400 text-sm">{error}</p>
      )}

      <button
        type="button"
        disabled={!canPost}
        onClick={() => setShowConfirm(true)}
        className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none font-medium text-sm"
      >
        {isSubmitting ? "Posting…" : "Confirm & Post"}
      </button>

      {/* Confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <p className="text-gray-900 dark:text-gray-100 font-semibold mb-2">
              Confirm {mode === "drawdown" ? "Loan Drawdown" : "Loan Repayment"}
            </p>
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-1">
              Amount: <strong>{numAmount.toFixed(2)}</strong>
            </p>
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-6">
              This will be posted to the ledger and cannot be edited. Continue?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={isSubmitting}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPost}
                disabled={isSubmitting}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isSubmitting ? "Posting…" : "Post to Ledger"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
