"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { buildServiceRoute } from "@/lib/service/routes"

type Account = {
  id: string
  code: string
  name: string
  type: string
  sub_type?: string | null
}

function todayIso(): string {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

function isBankOrCash(acc: Account) {
  if (acc.type !== "asset") return false
  if (!acc.sub_type) return false

  const sub = acc.sub_type.toLowerCase()
  return sub === "bank" || sub === "cash"
}

export default function ServiceContributionPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [coaLoaded, setCoaLoaded] = useState(false)
  const [bankCashAccounts, setBankCashAccounts] = useState<Account[]>([])
  const [equityAccounts, setEquityAccounts] = useState<Account[]>([])
  const [entryDate, setEntryDate] = useState(todayIso())
  const [amount, setAmount] = useState<number | "">("")
  const [depositToId, setDepositToId] = useState<string | null>(null)
  const [equityId, setEquityId] = useState<string | null>(null)
  const [description, setDescription] = useState("")
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setLoading(false)
          return
        }
        const b = await getCurrentBusiness(supabase, user.id)
        if (cancelled || !b) {
          setLoading(false)
          return
        }
        setBusinessId(b.id)
      } catch (_) {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    async function fetchCoa() {
      setCoaLoaded(false)
      try {
        const res = await fetch(`/api/accounting/coa?business_id=${encodeURIComponent(businessId ?? "")}`)
        if (!res.ok) return
        const data = await res.json()
        const accounts: Account[] = data.accounts || []
        if (cancelled) return
        const bankCash = accounts.filter(isBankOrCash)
        const equity = accounts.filter((a) => a.type === "equity")
        setBankCashAccounts(bankCash)
        setEquityAccounts(equity)
        if (equity.length === 1) {
          setEquityId(equity[0].id)
        } else if (equity.length > 1) {
          setEquityId(equity[0].id)
        }
        if (bankCash.length === 1) setDepositToId(bankCash[0].id)
      } catch (_) {
        // ignore
      } finally {
        if (!cancelled) setCoaLoaded(true)
      }
    }
    fetchCoa()
    return () => { cancelled = true }
  }, [businessId])

  const hasSingleEquity = equityAccounts.length === 1
  const selectedBank = bankCashAccounts.find((a) => a.id === depositToId)
  const selectedEquity = equityAccounts.find((a) => a.id === equityId)
  const numAmount = amount === "" ? 0 : Number(amount)
  const noBankCash = coaLoaded && bankCashAccounts.length === 0
  const noEquity = coaLoaded && equityAccounts.length === 0
  const formDisabled = noBankCash || noEquity
  const isValid =
    numAmount > 0 &&
    depositToId != null &&
    (hasSingleEquity ? equityId != null : equityId != null)
  const canPost = Boolean(businessId && isValid && !isSubmitting && !formDisabled)

  const handleConfirmPost = async () => {
    if (!canPost || !businessId || !depositToId || !equityId || numAmount <= 0) return
    setIsSubmitting(true)
    setError("")
    try {
      const res = await fetch("/api/service/accounting/post-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          intent: {
            intent_type: "OWNER_CONTRIBUTION",
            entry_date: entryDate,
            amount: numAmount,
            bank_or_cash_account_id: depositToId,
            equity_account_id: equityId,
            description: (description || "Owner Contribution").trim() || undefined,
          },
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to record contribution.")
        setIsSubmitting(false)
        setShowConfirm(false)
        return
      }

      const journalEntryId = data.journal_entry_id
      if (journalEntryId) {
        const url = `${buildServiceRoute("/service/ledger", businessId)}&highlight=${journalEntryId}`
        router.push(url)
        return
      }
      setError("Recorded but could not open ledger.")
    } catch (_) {
      setError("Something went wrong.")
    } finally {
      setIsSubmitting(false)
      setShowConfirm(false)
    }
  }

  if (loading) {
    return (
      
        <div className="p-6">
          <p>Loading...</p>
        </div>
      
    )
  }

  if (!businessId) {
    return (
      
        <div className="p-6 max-w-2xl mx-auto">
          <p className="text-gray-600 dark:text-gray-400">No business found. You need an active business to record a contribution.</p>
          <button
            type="button"
            onClick={() => router.push("/service/accounting")}
            className="mt-4 text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Back to Accounting
          </button>
        </div>
      
    )
  }

  return (
    
      <div className="p-6 max-w-2xl mx-auto">
        <button
          type="button"
          onClick={() => router.push("/service/accounting")}
          className="text-blue-600 dark:text-blue-400 hover:underline mb-4 text-sm"
        >
          ← Back to Accounting
        </button>

        <h1 className="text-2xl font-bold mb-2">Record Owner Contribution</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Record money you invest into the business. This increases your bank or cash balance and your equity.
        </p>

        {noBankCash && (
          <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-amber-800 dark:text-amber-200 text-sm">
            No bank or cash account found. Please create one in Chart of Accounts.
          </div>
        )}
        {noEquity && (
          <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-amber-800 dark:text-amber-200 text-sm">
            No equity account found. Please configure your Chart of Accounts.
          </div>
        )}

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              disabled={isSubmitting || formDisabled}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60 disabled:pointer-events-none"
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
              disabled={isSubmitting || formDisabled}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60 disabled:pointer-events-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Deposit to</label>
            <select
              value={depositToId ?? ""}
              onChange={(e) => setDepositToId(e.target.value || null)}
              disabled={isSubmitting || formDisabled}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60 disabled:pointer-events-none"
            >
              <option value="">Select account...</option>
              {bankCashAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} – {a.name}
                </option>
              ))}
            </select>
          </div>
          {!hasSingleEquity && equityAccounts.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Equity account</label>
              <select
                value={equityId ?? ""}
                onChange={(e) => setEquityId(e.target.value || null)}
                disabled={isSubmitting || formDisabled}
                className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60 disabled:pointer-events-none"
              >
                {equityAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} – {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Owner contribution"
              disabled={isSubmitting || formDisabled}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60 disabled:pointer-events-none"
            />
          </div>
        </div>

        {isValid && selectedBank && selectedEquity && (
          <div className="mb-6 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="bg-gray-50 dark:bg-gray-800/50 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">This will post:</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-4 font-medium text-gray-700 dark:text-gray-300">Account</th>
                    <th className="text-right py-2 px-4 font-medium text-gray-700 dark:text-gray-300">Debit</th>
                    <th className="text-right py-2 px-4 font-medium text-gray-700 dark:text-gray-300">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-100 dark:border-gray-700/50">
                    <td className="py-2 px-4 text-gray-900 dark:text-gray-100">{selectedBank.code} – {selectedBank.name}</td>
                    <td className="py-2 px-4 text-right text-gray-700 dark:text-gray-300">{numAmount.toFixed(2)}</td>
                    <td className="py-2 px-4 text-right text-gray-700 dark:text-gray-300"></td>
                  </tr>
                  <tr className="border-b border-gray-100 dark:border-gray-700/50">
                    <td className="py-2 px-4 text-gray-900 dark:text-gray-100">{selectedEquity.code} – {selectedEquity.name}</td>
                    <td className="py-2 px-4 text-right text-gray-700 dark:text-gray-300"></td>
                    <td className="py-2 px-4 text-right text-gray-700 dark:text-gray-300">{numAmount.toFixed(2)}</td>
                  </tr>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 font-medium">
                    <td className="py-2 px-4 text-gray-900 dark:text-gray-100">Total</td>
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
          disabled={!canPost || formDisabled}
          onClick={() => setShowConfirm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none font-medium"
        >
          {isSubmitting ? "Posting…" : "Confirm & Post"}
        </button>

        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
              <p className="text-gray-900 dark:text-gray-100 font-medium mb-2">Confirm</p>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-6">
                This will record your contribution and post it to the ledger. This action cannot be edited. Continue?
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60 disabled:pointer-events-none"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPost}
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? "Posting…" : "Continue"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    
  )
}
