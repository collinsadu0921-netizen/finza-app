"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { buildServiceRoute } from "@/lib/service/routes"
import {
  isBankOrCashSubType,
  isLoanSubType,
} from "@/lib/service/accounting/intentTypes"
import { formatMoney } from "@/lib/money"
import { NativeSelect } from "@/components/ui/NativeSelect"
import TierGate from "@/components/service/TierGate"

// ─── Types ────────────────────────────────────────────────────────────────────

type Account = {
  id: string
  code: string
  name: string
  type: string
  sub_type?: string | null
}

type LoanRecord = {
  id: string
  lender_name: string | null
  principal_amount: number
  interest_rate_pct: number | null
  start_date: string
  outstanding: number
  loan_account: { code: string; name: string } | null
}

type LoanMode   = "drawdown" | "repayment" | "interest"
type EquityMode = "contribution" | "withdrawal"

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Mode tab ─────────────────────────────────────────────────────────────────

function ModeTab({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean
  onClick: () => void
  label: string
  sub: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2.5 rounded-lg border text-left transition-colors ${
        active
          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-500"
          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
      }`}
    >
      <div className={`text-sm font-semibold ${active ? "text-blue-700 dark:text-blue-300" : "text-gray-900 dark:text-gray-100"}`}>
        {label}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</div>
    </button>
  )
}

// ─── DR/CR preview ────────────────────────────────────────────────────────────

function JournalPreview({
  drAccount,
  crAccount,
  amount,
  currencyCode,
}: {
  drAccount: Account | undefined
  crAccount: Account | undefined
  amount: number
  currencyCode: string | null
}) {
  if (!drAccount || !crAccount || amount <= 0) return null
  const fmt = (n: number) => formatMoney(n, currencyCode)
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden mb-5">
      <div className="bg-gray-50 dark:bg-gray-800/50 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">This will post:</span>
      </div>
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
            <td className="py-2 px-4 text-gray-900 dark:text-gray-100">{drAccount.code} – {drAccount.name}</td>
            <td className="py-2 px-4 text-right text-gray-700 dark:text-gray-300">{fmt(amount)}</td>
            <td className="py-2 px-4 text-right" />
          </tr>
          <tr className="border-b border-gray-100 dark:border-gray-700/50">
            <td className="py-2 px-4 text-gray-900 dark:text-gray-100">{crAccount.code} – {crAccount.name}</td>
            <td className="py-2 px-4 text-right" />
            <td className="py-2 px-4 text-right text-gray-700 dark:text-gray-300">{fmt(amount)}</td>
          </tr>
          <tr className="bg-gray-50 dark:bg-gray-800/50 text-xs font-semibold text-gray-500 dark:text-gray-400">
            <td className="py-2 px-4">Total</td>
            <td className="py-2 px-4 text-right text-gray-900 dark:text-gray-100">{fmt(amount)}</td>
            <td className="py-2 px-4 text-right text-gray-900 dark:text-gray-100">{fmt(amount)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

function FinancingPageInner() {
  const router = useRouter()

  // ── Business / loading ──────────────────────────────────────────────────────
  const [loading, setLoading]       = useState(true)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)
  const [coaLoaded, setCoaLoaded]   = useState(false)

  // ── Active section ──────────────────────────────────────────────────────────
  const [section, setSection] = useState<"loans" | "equity">("loans")

  // ── COA ──────────────────────────────────────────────────────────────────────
  const [bankCashAccounts, setBankCashAccounts] = useState<Account[]>([])
  const [loanAccounts, setLoanAccounts]         = useState<Account[]>([])
  const [equityAccounts, setEquityAccounts]     = useState<Account[]>([])
  const [expenseAccounts, setExpenseAccounts]   = useState<Account[]>([])

  // ── Loans register ──────────────────────────────────────────────────────────
  const [loans, setLoans]           = useState<LoanRecord[]>([])
  const [loansLoading, setLoansLoading] = useState(false)

  // ── Loan form ───────────────────────────────────────────────────────────────
  const [loanMode, setLoanMode]           = useState<LoanMode>("drawdown")
  const [loanDate, setLoanDate]           = useState(todayIso())
  const [loanAmount, setLoanAmount]       = useState<number | "">("")
  const [bankId, setBankId]               = useState<string | null>(null)
  const [loanAccountId, setLoanAccountId] = useState<string | null>(null)
  const [expenseAccountId, setExpenseAccountId] = useState<string | null>(null)
  const [lenderName, setLenderName]       = useState("")
  const [interestRatePct, setInterestRatePct] = useState<number | "">("")
  const [loanDesc, setLoanDesc]           = useState("")

  // ── Equity form ─────────────────────────────────────────────────────────────
  const [equityMode, setEquityMode]         = useState<EquityMode>("contribution")
  const [equityDate, setEquityDate]         = useState(todayIso())
  const [equityAmount, setEquityAmount]     = useState<number | "">("")
  const [equityBankId, setEquityBankId]     = useState<string | null>(null)
  const [equityAccountId, setEquityAccountId] = useState<string | null>(null)
  const [equityDesc, setEquityDesc]         = useState("")

  // ── Submission ──────────────────────────────────────────────────────────────
  const [error, setError]           = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirm, setShowConfirm]   = useState(false)

  // ── Load business ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setLoading(false); return }
        const b = await getCurrentBusiness(supabase, user.id)
        if (!cancelled && b) {
          setBusinessId(b.id)
          setCurrencyCode(b.default_currency ?? null)
        }
      } catch (_) {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── Load COA ────────────────────────────────────────────────────────────────
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

        const bankCash  = accounts.filter((a) => a.type === "asset"     && isBankOrCashSubType(a.sub_type))
        const loans     = accounts.filter((a) => a.type === "liability" && isLoanSubType(a.sub_type))
        const equity    = accounts.filter((a) => a.type === "equity")
        const expenses  = accounts.filter((a) => a.type === "expense")

        setBankCashAccounts(bankCash)
        setLoanAccounts(loans)
        setEquityAccounts(equity)
        setExpenseAccounts(expenses)

        if (bankCash.length >= 1) { setBankId(bankCash[0].id); setEquityBankId(bankCash[0].id) }
        if (loans.length >= 1)    setLoanAccountId(loans[0].id)
        if (equity.length >= 1)   setEquityAccountId(equity[0].id)
        // Default expense to 6300 Interest Expense if present
        const interestExp = expenses.find((a) => a.code === "6300") ?? expenses[0]
        if (interestExp)          setExpenseAccountId(interestExp.id)
      } catch (_) {
        // ignore
      } finally {
        if (!cancelled) setCoaLoaded(true)
      }
    }
    fetchCoa()
    return () => { cancelled = true }
  }, [businessId])

  // ── Load loans ──────────────────────────────────────────────────────────────
  const loadLoans = async () => {
    if (!businessId) return
    setLoansLoading(true)
    try {
      const res = await fetch(`/api/service/accounting/loans?business_id=${encodeURIComponent(businessId)}`)
      if (res.ok) {
        const data = await res.json()
        setLoans(data.loans ?? [])
      }
    } catch (_) {
      // ignore
    } finally {
      setLoansLoading(false)
    }
  }

  useEffect(() => { if (businessId) loadLoans() }, [businessId])

  // ── Derived state ───────────────────────────────────────────────────────────
  const numLoanAmount   = loanAmount   === "" ? 0 : Number(loanAmount)
  const numEquityAmount = equityAmount === "" ? 0 : Number(equityAmount)

  const selectedBank      = bankCashAccounts.find((a) => a.id === bankId)
  const selectedLoan      = loanAccounts.find((a)     => a.id === loanAccountId)
  const selectedExpense   = expenseAccounts.find((a)  => a.id === expenseAccountId)
  const selectedEquityBank = bankCashAccounts.find((a) => a.id === equityBankId)
  const selectedEquityAcc  = equityAccounts.find((a)  => a.id === equityAccountId)

  // Loan preview accounts
  const loanDR =
    loanMode === "drawdown"  ? selectedBank    :
    loanMode === "repayment" ? selectedLoan    :
    selectedExpense
  const loanCR =
    loanMode === "drawdown"  ? selectedLoan   :
    loanMode === "repayment" ? selectedBank   :
    selectedBank

  // Equity preview accounts
  const equityDR = equityMode === "contribution" ? selectedEquityBank : selectedEquityAcc
  const equityCR = equityMode === "contribution" ? selectedEquityAcc  : selectedEquityBank

  const noBankCash = coaLoaded && bankCashAccounts.length === 0
  const noLoanAccs = coaLoaded && loanAccounts.length === 0
  const noEquity   = coaLoaded && equityAccounts.length === 0

  const loanFormDisabled  = noBankCash || (loanMode !== "interest" && noLoanAccs)
  const equityFormDisabled = noBankCash || noEquity

  const loanValid =
    numLoanAmount > 0 && bankId != null &&
    (loanMode === "interest" ? expenseAccountId != null : loanAccountId != null)

  const equityValid = numEquityAmount > 0 && equityBankId != null && equityAccountId != null

  const canPost = section === "loans"
    ? Boolean(businessId && loanValid && !isSubmitting && !loanFormDisabled)
    : Boolean(businessId && equityValid && !isSubmitting && !equityFormDisabled)

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleConfirmPost = async () => {
    if (!canPost || !businessId) return
    setIsSubmitting(true)
    setError("")
    try {
      if (section === "loans") {
        if (loanMode === "drawdown") {
          // POST to loans API (saves loan record + JE)
          const res = await fetch("/api/service/accounting/loans", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              business_id:       businessId,
              lender_name:       lenderName || undefined,
              interest_rate_pct: interestRatePct !== "" ? interestRatePct : undefined,
              intent: {
                intent_type:             "LOAN_DRAWDOWN",
                entry_date:              loanDate,
                amount:                  numLoanAmount,
                bank_or_cash_account_id: bankId,
                loan_account_id:         loanAccountId,
                description:             loanDesc || undefined,
              },
            }),
          })
          const data = await res.json()
          if (!res.ok) { setError(data.error ?? "Failed to record drawdown."); return }
          await loadLoans()
          // Reset drawdown-specific fields
          setLoanAmount("")
          setLenderName("")
          setInterestRatePct("")
          setLoanDesc("")
          setShowConfirm(false)
          return
        } else {
          // Repayment or interest payment: just post the intent
          const intentType = loanMode === "repayment" ? "LOAN_REPAYMENT" : "LOAN_INTEREST_PAYMENT"
          const defaultDesc =
            loanMode === "repayment" ? "Loan Repayment" : "Loan Interest Payment"
          const intent: any = {
            intent_type:             intentType,
            entry_date:              loanDate,
            amount:                  numLoanAmount,
            bank_or_cash_account_id: bankId,
            description:             loanDesc || defaultDesc,
          }
          if (loanMode === "repayment") intent.loan_account_id = loanAccountId
          else intent.expense_account_id = expenseAccountId

          const res = await fetch("/api/service/accounting/post-intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ business_id: businessId, intent }),
          })
          const data = await res.json()
          if (!res.ok) { setError(data.error ?? "Failed to record transaction."); return }

          if (loanMode === "repayment") await loadLoans()
          const journalEntryId = data.journal_entry_id
          if (journalEntryId) {
            router.push(`${buildServiceRoute("/service/ledger", businessId)}&highlight=${journalEntryId}`)
            return
          }
          setError("Recorded but could not open ledger.")
          return
        }
      } else {
        // Equity
        const intent = {
          intent_type:             equityMode === "contribution" ? "OWNER_CONTRIBUTION" : "OWNER_WITHDRAWAL",
          entry_date:              equityDate,
          amount:                  numEquityAmount,
          bank_or_cash_account_id: equityBankId,
          equity_account_id:       equityAccountId,
          description:             equityDesc || undefined,
        }
        const res = await fetch("/api/service/accounting/post-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ business_id: businessId, intent }),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error ?? "Failed to record equity transaction."); return }

        const journalEntryId = data.journal_entry_id
        if (journalEntryId) {
          router.push(`${buildServiceRoute("/service/ledger", businessId)}&highlight=${journalEntryId}`)
          return
        }
        setError("Recorded but could not open ledger.")
        return
      }
    } catch (_) {
      setError("Something went wrong. Please try again.")
    } finally {
      setIsSubmitting(false)
      setShowConfirm(false)
    }
  }

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (loading) return <div className="p-6"><p className="text-gray-500">Loading…</p></div>

  if (!businessId) return (
    <div className="p-6 max-w-2xl mx-auto">
      <p className="text-gray-600 dark:text-gray-400">No business found.</p>
      <button type="button" onClick={() => router.push("/service/accounting")}
        className="mt-4 text-blue-600 dark:text-blue-400 hover:underline text-sm">
        ← Back to Accounting
      </button>
    </div>
  )

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Back */}
      <button type="button" onClick={() => router.push("/service/accounting")}
        className="text-blue-600 dark:text-blue-400 hover:underline mb-4 text-sm flex items-center gap-1">
        ← Back to Accounting
      </button>

      <h1 className="text-2xl font-bold mb-1 text-gray-900 dark:text-white">Financing</h1>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
        Record loans, repayments, interest payments, and owner equity transactions.
      </p>

      {/* Section tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
        {(["loans", "equity"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setSection(s); setError("") }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              section === s
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {s === "loans" ? "Loans" : "Equity"}
          </button>
        ))}
      </div>

      {/* ── LOANS section ─────────────────────────────────────────────────── */}
      {section === "loans" && (
        <>
          {/* Loan Register */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
              Loan Register
            </h2>
            {loansLoading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : loans.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-3">
                No loans recorded yet. Use the form below to record your first drawdown.
              </p>
            ) : (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden mb-2">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium">Lender</th>
                      <th className="text-right py-2 px-3 font-medium">Principal</th>
                      <th className="text-right py-2 px-3 font-medium">Rate % p.a.</th>
                      <th className="text-right py-2 px-3 font-medium">Outstanding</th>
                      <th className="text-left py-2 px-3 font-medium">Account</th>
                      <th className="text-left py-2 px-3 font-medium">From</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                    {loans.map((loan) => (
                      <tr key={loan.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="py-2 px-3 text-gray-900 dark:text-gray-100">
                          {loan.lender_name ?? <span className="text-gray-400">—</span>}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">
                          {formatMoney(loan.principal_amount, currencyCode)}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">
                          {loan.interest_rate_pct != null
                            ? `${Number(loan.interest_rate_pct).toFixed(2)}%`
                            : <span className="text-gray-400">—</span>}
                        </td>
                        <td className={`py-2 px-3 text-right font-semibold ${
                          loan.outstanding > 0 ? "text-orange-600 dark:text-orange-400" : "text-green-600 dark:text-green-400"
                        }`}>
                          {formatMoney(loan.outstanding, currencyCode)}
                        </td>
                        <td className="py-2 px-3 text-gray-500 dark:text-gray-400 text-xs">
                          {loan.loan_account
                            ? `${loan.loan_account.code} – ${loan.loan_account.name}`
                            : "—"}
                        </td>
                        <td className="py-2 px-3 text-gray-500 dark:text-gray-400 text-xs">
                          {new Date(loan.start_date).toLocaleDateString("en-GB")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Loan mode tabs */}
          <div className="flex gap-2 mb-5">
            <ModeTab active={loanMode === "drawdown"}  onClick={() => { setLoanMode("drawdown");  setError("") }} label="Loan Drawdown"    sub="Dr Bank, Cr Loan" />
            <ModeTab active={loanMode === "repayment"} onClick={() => { setLoanMode("repayment"); setError("") }} label="Loan Repayment"   sub="Dr Loan, Cr Bank" />
            <ModeTab active={loanMode === "interest"}  onClick={() => { setLoanMode("interest");  setError("") }} label="Interest Payment" sub="Dr Interest Exp, Cr Bank" />
          </div>

          {/* Warnings */}
          {noBankCash && <Warn>No bank or cash account found. Please create one in Chart of Accounts.</Warn>}
          {noLoanAccs && loanMode !== "interest" && (
            <Warn>No loan accounts found. Accounts 2300 (Short-term) and 2310 (Long-term) should be created automatically — if missing, add them in Chart of Accounts with type <strong>Liability</strong>.</Warn>
          )}

          {/* Loan form */}
          <div className="space-y-4 mb-5">
            <Field label="Date">
              <input type="date" value={loanDate} onChange={(e) => setLoanDate(e.target.value)}
                disabled={isSubmitting || loanFormDisabled}
                className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60" />
            </Field>

            <Field label="Amount">
              <input type="number" min={0} step="0.01" value={loanAmount === "" ? "" : loanAmount}
                onChange={(e) => setLoanAmount(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="0.00" disabled={isSubmitting || loanFormDisabled}
                className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60" />
            </Field>

            <Field label="Bank / Cash Account">
              <NativeSelect value={bankId ?? ""} onChange={(e) => setBankId(e.target.value || null)}
                disabled={isSubmitting || loanFormDisabled}>
                <option value="">Select account…</option>
                {bankCashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
              </NativeSelect>
            </Field>

            {loanMode !== "interest" && (
              <Field label="Loan Account" hint="2300 = Short-term · 2310 = Long-term">
                <NativeSelect value={loanAccountId ?? ""} onChange={(e) => setLoanAccountId(e.target.value || null)}
                  disabled={isSubmitting || loanFormDisabled}>
                  <option value="">Select loan account…</option>
                  {loanAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
                </NativeSelect>
              </Field>
            )}

            {loanMode === "interest" && (
              <Field label="Interest Expense Account">
                <NativeSelect value={expenseAccountId ?? ""} onChange={(e) => setExpenseAccountId(e.target.value || null)}
                  disabled={isSubmitting}>
                  <option value="">Select expense account…</option>
                  {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
                </NativeSelect>
              </Field>
            )}

            {loanMode === "drawdown" && (
              <>
                <Field label={<>Lender Name <Optional /></>}>
                  <input type="text" value={lenderName} onChange={(e) => setLenderName(e.target.value)}
                    placeholder="e.g. GCB Bank" disabled={isSubmitting}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60" />
                </Field>
                <Field label={<>Interest Rate <Optional /></>} hint="Annual percentage rate">
                  <div className="flex gap-2 items-center">
                    <input type="number" min={0} step="0.01" value={interestRatePct === "" ? "" : interestRatePct}
                      onChange={(e) => setInterestRatePct(e.target.value === "" ? "" : Number(e.target.value))}
                      placeholder="e.g. 18.5" disabled={isSubmitting}
                      className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60" />
                    <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">% p.a.</span>
                  </div>
                </Field>
              </>
            )}

            <Field label={<>Description <Optional /></>}>
              <input type="text" value={loanDesc} onChange={(e) => setLoanDesc(e.target.value)}
                placeholder={
                  loanMode === "drawdown"  ? "e.g. GCB Bank term loan" :
                  loanMode === "repayment" ? "e.g. Monthly principal repayment" :
                  "e.g. Monthly interest charge"
                }
                disabled={isSubmitting || loanFormDisabled}
                className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60" />
            </Field>
          </div>

          <JournalPreview drAccount={loanDR} crAccount={loanCR} amount={numLoanAmount} currencyCode={currencyCode} />
        </>
      )}

      {/* ── EQUITY section ────────────────────────────────────────────────── */}
      {section === "equity" && (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-4 py-3">
            Equity balances are visible in your Balance Sheet and Changes in Equity reports.
            Interest on loans is recorded separately via the Loans tab.
          </p>

          {/* Equity mode tabs */}
          <div className="flex gap-2 mb-5">
            <ModeTab active={equityMode === "contribution"} onClick={() => { setEquityMode("contribution"); setError("") }}
              label="Owner Contribution" sub="Money put into the business — Dr Bank, Cr Equity" />
            <ModeTab active={equityMode === "withdrawal"}   onClick={() => { setEquityMode("withdrawal");  setError("") }}
              label="Owner Withdrawal"   sub="Money taken out by the owner — Dr Equity, Cr Bank" />
          </div>

          {noBankCash && <Warn>No bank or cash account found. Please create one in Chart of Accounts.</Warn>}
          {noEquity   && <Warn>No equity accounts found. Accounts 3000 (Owner's Equity) and 3100 (Retained Earnings) should be created automatically.</Warn>}

          <div className="space-y-4 mb-5">
            <Field label="Date">
              <input type="date" value={equityDate} onChange={(e) => setEquityDate(e.target.value)}
                disabled={isSubmitting || equityFormDisabled}
                className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60" />
            </Field>

            <Field label="Amount">
              <input type="number" min={0} step="0.01" value={equityAmount === "" ? "" : equityAmount}
                onChange={(e) => setEquityAmount(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="0.00" disabled={isSubmitting || equityFormDisabled}
                className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60" />
            </Field>

            <Field label="Bank / Cash Account">
              <NativeSelect value={equityBankId ?? ""} onChange={(e) => setEquityBankId(e.target.value || null)}
                disabled={isSubmitting || equityFormDisabled}>
                <option value="">Select account…</option>
                {bankCashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
              </NativeSelect>
            </Field>

            <Field label="Equity Account">
              <NativeSelect value={equityAccountId ?? ""} onChange={(e) => setEquityAccountId(e.target.value || null)}
                disabled={isSubmitting || equityFormDisabled}>
                <option value="">Select equity account…</option>
                {equityAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
              </NativeSelect>
            </Field>

            <Field label={<>Description <Optional /></>}>
              <input type="text" value={equityDesc} onChange={(e) => setEquityDesc(e.target.value)}
                placeholder={equityMode === "contribution" ? "e.g. Additional capital injection" : "e.g. Owner drawings — March 2026"}
                disabled={isSubmitting || equityFormDisabled}
                className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 disabled:opacity-60" />
            </Field>
          </div>

          <JournalPreview drAccount={equityDR} crAccount={equityCR} amount={numEquityAmount} currencyCode={currencyCode} />
        </>
      )}

      {/* Error */}
      {error && <p className="mb-4 text-red-600 dark:text-red-400 text-sm">{error}</p>}

      {/* Submit */}
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
              {section === "loans"
                ? loanMode === "drawdown"  ? "Confirm Loan Drawdown"
                : loanMode === "repayment" ? "Confirm Loan Repayment"
                : "Confirm Interest Payment"
                : equityMode === "contribution" ? "Confirm Owner Contribution"
                : "Confirm Owner Withdrawal"}
            </p>
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-1">
              Amount: <strong>{formatMoney(section === "loans" ? numLoanAmount : numEquityAmount, currencyCode)}</strong>
            </p>
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-6">
              This will be posted to the ledger and cannot be edited. Continue?
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowConfirm(false)} disabled={isSubmitting}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60">
                Cancel
              </button>
              <button type="button" onClick={handleConfirmPost} disabled={isSubmitting}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {isSubmitting ? "Posting…" : "Post to Ledger"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FinancingPage() {
  return (
    <TierGate minTier="business">
      <FinancingPageInner />
    </TierGate>
  )
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{hint}</p>}
    </div>
  )
}

function Optional() {
  return <span className="text-gray-400 font-normal">(optional)</span>
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-amber-800 dark:text-amber-200 text-sm">
      {children}
    </div>
  )
}
