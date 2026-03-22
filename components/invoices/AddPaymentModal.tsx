"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { FinancialPositionBar } from "@/components/ui/FinancialPositionBar"
import { formatMoney, formatMoneyWithSymbol } from "@/lib/money"
import { getCurrentBusiness } from "@/lib/business"
import { isDateInOpenPeriod, validatePaymentPostingAllowed } from "@/lib/accountingPeriods/lifecycle"
import { normalizeCountry, getAllowedMethods, getMobileMoneyLabel } from "@/lib/payments/eligibility"

type AddPaymentModalProps = {
    invoiceId: string
    invoiceNumber: string
    customerName: string
    invoiceTotal: number
    totalPaid: number
    creditsApplied: number
    currencySymbol: string
    businessCountry: string | null
    // FX invoice fields — present only when the invoice is in a foreign currency
    invoiceFxRate?: number | null       // original rate when invoice was issued
    invoiceCurrencyCode?: string | null // e.g. "USD"
    homeCurrencyCode?: string | null    // e.g. "GHS"
    // WHT suffered — pre-filled when invoice has wht_receivable_applicable = true
    invoiceWhtApplicable?: boolean
    invoiceWhtAmount?: number
    /** Hide "View Receipt" in success state (e.g. when in service portal) */
    hideViewReceipt?: boolean
    onClose: () => void
    onSuccess: () => void
}

type Payment = {
    id: string
    amount: number
    date: string
    method: string
    reference: string | null
    public_token: string | null
}

export default function AddPaymentModal({
    invoiceId,
    invoiceNumber,
    customerName,
    invoiceTotal,
    totalPaid,
    creditsApplied,
    currencySymbol,
    businessCountry,
    invoiceFxRate,
    invoiceCurrencyCode,
    homeCurrencyCode,
    invoiceWhtApplicable = false,
    invoiceWhtAmount = 0,
    hideViewReceipt = false,
    onClose,
    onSuccess,
}: AddPaymentModalProps) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [periodLocked, setPeriodLocked] = useState(false)
    const [checkingPeriod, setCheckingPeriod] = useState(false)
    const [successData, setSuccessData] = useState<Payment | null>(null)

    // Form State
    const [date, setDate] = useState(new Date().toISOString().split("T")[0])
    const [amount, setAmount] = useState("")
    const [method, setMethod] = useState<"cash" | "bank" | "momo" | "card" | "cheque" | "paystack" | "other">("cash")
    const [reference, setReference] = useState("")
    const [notes, setNotes] = useState("")
    const [settlementFxRate, setSettlementFxRate] = useState("")

    // WHT suffered state
    const [whtEnabled, setWhtEnabled] = useState(invoiceWhtApplicable)
    const [whtAmountStr, setWhtAmountStr] = useState(invoiceWhtAmount > 0 ? invoiceWhtAmount.toFixed(2) : "")

    // FX helpers
    const isFxInvoice = !!(invoiceFxRate && invoiceCurrencyCode && homeCurrencyCode)
    const parsedSettlementRate = parseFloat(settlementFxRate) || 0
    const amountInHomeCurrency = isFxInvoice && parsedSettlementRate > 0
        ? (parseFloat(amount) || 0) * parsedSettlementRate
        : null
    const originalRate = invoiceFxRate ?? 0
    const arClearAmount = isFxInvoice && parsedSettlementRate > 0
        ? (parseFloat(amount) || 0) * originalRate
        : null
    const fxDiff = amountInHomeCurrency !== null && arClearAmount !== null
        ? amountInHomeCurrency - arClearAmount
        : null

    // Derived Values
    const remainingBalance = Math.max(0, invoiceTotal - totalPaid - creditsApplied)
    const amountNum = Number(amount) || 0
    const isOverpayment = amountNum > remainingBalance + 0.01 // 0.01 tolerance

    // WHT derived
    const whtNum = whtEnabled ? (Number(whtAmountStr) || 0) : 0
    const netCashReceived = amountNum - whtNum

    const formatInvoiceAmount = (n: number) =>
        invoiceCurrencyCode
            ? formatMoney(n, invoiceCurrencyCode)
            : formatMoneyWithSymbol(n, currencySymbol)

    // Eligibility
    const countryCode = normalizeCountry(businessCountry)
    const allowedMethods = getAllowedMethods(countryCode)
    const mobileMoneyLabel = getMobileMoneyLabel(countryCode)
    const canUseCash = allowedMethods.includes("cash")
    const canUseBank = allowedMethods.includes("bank_transfer")
    const canUseMobileMoney = allowedMethods.includes("mobile_money")
    const canUseCard = allowedMethods.includes("card")
    const canUsePaystack = allowedMethods.includes("paystack")

    // Auto-fill amount on mount
    useEffect(() => {
        if (!amount) {
            setAmount(remainingBalance.toFixed(2))
        }
    }, [remainingBalance, amount])

    // Check Period Lock
    useEffect(() => {
        async function checkPeriod() {
            if (!date) return
            setCheckingPeriod(true)
            setPeriodLocked(false)
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) return

                const business = await getCurrentBusiness(supabase, user.id)
                if (!business) return

                // We use isDateInOpenPeriod to check if posting is allowed (open or soft_closed)
                const isOpen = await isDateInOpenPeriod(supabase, business.id, date)
                setPeriodLocked(!isOpen)
            } catch (err) {
                console.error("Failed to check period status", err)
                // Fail safe: don't lock if check fails, but validation on submit will catch it
            } finally {
                setCheckingPeriod(false)
            }
        }
        checkPeriod()
    }, [date])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")

        if (amountNum <= 0) {
            setError("Amount must be greater than 0")
            return
        }

        if (isFxInvoice && parsedSettlementRate <= 0) {
            setError(`Settlement rate is required for ${invoiceCurrencyCode} invoices. Enter today's exchange rate.`)
            return
        }

        if (isOverpayment) {
            setError(`Amount cannot exceed remaining balance of ${formatInvoiceAmount(remainingBalance)}`)
            return
        }

        if (periodLocked) {
            setError("Cannot record payment in a locked accounting period.")
            return
        }

        try {
            setLoading(true)
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Not authenticated")

            const business = await getCurrentBusiness(supabase, user.id)
            if (!business) throw new Error("Business not found")

            // Double check period lock before submitting (server-side check simulation)
            /* 
               Note: The API endpoint /api/payments/create should ideally strictly enforce this.
               We do a client-side check via lib for immediate feedback.
            */
            try {
                await validatePaymentPostingAllowed(supabase, business.id, date)
            } catch (periodErr: any) {
                throw new Error(periodErr.message)
            }

            const response = await fetch("/api/payments/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    business_id: business.id,
                    invoice_id: invoiceId,
                    amount: amountNum,
                    date: date,
                    method: method,
                    reference: reference || null,
                    notes: notes || null,
                    settlement_fx_rate: isFxInvoice ? parsedSettlementRate : null,
                    wht_amount: whtNum > 0 ? whtNum : 0,
                }),
            })

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.error || "Failed to create payment")
            }

            const data = await response.json()
            setSuccessData(data.payment)
        } catch (err: any) {
            setError(err.message || "Failed to create payment")
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full flex min-h-0 flex-col max-h-[90vh] overflow-hidden border border-slate-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-slate-50">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                            <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-slate-900">
                                {successData ? "Payment Recorded" : "Record Payment"}
                            </h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                                {successData
                                    ? `Invoice #${invoiceNumber} · ${customerName}`
                                    : `Invoice #${invoiceNumber} · ${customerName} · Balance: ${formatInvoiceAmount(remainingBalance)}`
                                }
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1.5 rounded-lg hover:bg-slate-100">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                {successData ? (
                    <div className="p-8 flex flex-col items-center justify-center space-y-5 text-center">
                        <div className="w-16 h-16 bg-emerald-50 border-2 border-emerald-200 rounded-2xl flex items-center justify-center">
                            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900">Payment Recorded!</h3>
                            <p className="text-slate-500 text-sm mt-1">The payment has been added to invoice #{invoiceNumber}.</p>
                        </div>

                        <div className="bg-slate-50 rounded-xl p-5 w-full max-w-sm border border-slate-200 text-left space-y-3">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-slate-500">Amount Paid</span>
                                <span className="text-sm font-bold text-slate-900 tabular-nums">{formatInvoiceAmount(successData.amount)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-slate-500">Remaining Due</span>
                                <span className="text-sm font-semibold text-slate-700 tabular-nums">
                                    {formatInvoiceAmount(Math.max(0, invoiceTotal - totalPaid - creditsApplied - successData.amount))}
                                </span>
                            </div>
                            <div className="flex justify-between items-center pt-3 border-t border-slate-200">
                                <span className="text-sm text-slate-500">Reference</span>
                                <span className="text-sm font-mono text-slate-600">{successData.reference || "—"}</span>
                            </div>
                        </div>

                        <div className="flex gap-3 w-full max-w-sm pt-2">
                            {!hideViewReceipt && (
                                <button
                                    onClick={() => {
                                        if (successData.public_token) {
                                            window.open(`${window.location.origin}/receipt-public/${successData.public_token}`, '_blank')
                                        }
                                    }}
                                    className="flex-1 px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 flex items-center justify-center gap-2 transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                    View Receipt
                                </button>
                            )}
                            <button
                                onClick={onSuccess}
                                className={`px-4 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 flex items-center justify-center gap-2 transition-colors ${hideViewReceipt ? 'w-full' : 'flex-1'}`}
                            >
                                Done
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* flex-1 min-h-0: required so overflow-y-auto can scroll inside max-h-[90vh]; without it the WHT block and footer are clipped off-screen */}
                        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-5">
                            {/* Payment Context Panel - FinancialPositionBar */}
                            <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                                <FinancialPositionBar
                                    currencyCode={invoiceCurrencyCode ?? null}
                                    total={invoiceTotal}
                                    paid={totalPaid}
                                    credits={creditsApplied}
                                    balance={remainingBalance}
                                    className="border-0 shadow-none bg-slate-50/50"
                                />
                            </div>

                            <form id="payment-form" onSubmit={handleSubmit} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                                    {/* Amount Field */}
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment Amount</label>
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                                <span className="text-slate-400 font-semibold text-sm">{currencySymbol}</span>
                                            </div>
                                            <input
                                                type="number"
                                                step="0.01"
                                                required
                                                value={amount}
                                                onChange={(e) => setAmount(e.target.value)}
                                                className={`block w-full pl-9 pr-4 py-2.5 text-base tabular-nums rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0 ${isOverpayment
                                                    ? "border-red-300 focus:border-red-400 focus:ring-red-100 bg-red-50 text-red-900"
                                                    : "border-slate-200 focus:border-slate-400 focus:ring-slate-100 hover:border-slate-300 bg-white"
                                                    }`}
                                                placeholder="0.00"
                                            />
                                        </div>
                                        {isOverpayment && (
                                            <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                                Exceeds remaining balance of {formatInvoiceAmount(remainingBalance)}
                                            </p>
                                        )}
                                    </div>

                                    {/* Date Field */}
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment Date</label>
                                        <input
                                            type="date"
                                            required
                                            value={date}
                                            onChange={(e) => setDate(e.target.value)}
                                            className={`block w-full px-3.5 py-2.5 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0 ${periodLocked
                                                ? "border-amber-300 bg-amber-50 focus:border-amber-400 focus:ring-amber-100"
                                                : "border-slate-200 focus:border-slate-400 focus:ring-slate-100 hover:border-slate-300 bg-white"
                                                }`}
                                        />
                                        {periodLocked && (
                                            <p className="text-xs text-amber-700 font-medium flex items-center gap-1">
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                                Accounting period is closed / locked
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Method */}
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment Method</label>
                                        <div className="relative">
                                            <select
                                                value={method}
                                                onChange={(e) => setMethod(e.target.value as any)}
                                                className="block w-full px-3.5 py-2.5 rounded-lg border border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 focus:outline-none hover:border-slate-300 appearance-none bg-white text-slate-800"
                                            >
                                                {canUseCash && <option value="cash">Cash</option>}
                                                {canUseBank && <option value="bank">Bank Transfer</option>}
                                                {canUseMobileMoney && <option value="momo">{mobileMoneyLabel}</option>}
                                                {canUseCard && <option value="card">Card</option>}
                                                {canUsePaystack && <option value="paystack">Paystack</option>}
                                                <option value="cheque">Cheque</option>
                                                <option value="other">Other</option>
                                            </select>
                                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Reference */}
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Reference <span className="font-normal normal-case">(optional)</span></label>
                                        <input
                                            type="text"
                                            value={reference}
                                            onChange={(e) => setReference(e.target.value)}
                                            placeholder="e.g. Transaction ID, Cheque #"
                                            className="block w-full px-3.5 py-2.5 rounded-lg border border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 focus:outline-none hover:border-slate-300 bg-white"
                                        />
                                    </div>
                                </div>

                                {/* Notes */}
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes <span className="font-normal normal-case">(internal)</span></label>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        rows={2}
                                        className="block w-full px-3.5 py-2.5 rounded-lg border border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 focus:outline-none hover:border-slate-300 resize-none bg-white text-sm"
                                        placeholder="Add any internal notes..."
                                    />
                                </div>

                                {/* WHT — withholding tax toggle */}
                                <div className={`rounded-xl border p-4 transition-colors ${whtEnabled ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <span className="text-sm font-semibold text-slate-800">
                                                Customer deducted WHT
                                            </span>
                                            <p className="text-xs text-slate-500 mt-0.5">
                                                Enable if payer withheld tax — records WHT receivable (a/c 2155)
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={whtEnabled}
                                            aria-label="Customer deducted withholding tax"
                                            onClick={() => setWhtEnabled(!whtEnabled)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${whtEnabled ? "bg-amber-500" : "bg-slate-200"}`}
                                        >
                                            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${whtEnabled ? "translate-x-5" : "translate-x-0"}`} />
                                        </button>
                                    </div>
                                    {whtEnabled && (
                                        <div className="mt-3 space-y-1.5">
                                            <label className="block text-xs font-semibold text-amber-700 uppercase tracking-wider">
                                                WHT amount withheld
                                            </label>
                                            <div className="relative">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                    <span className="text-slate-400 font-semibold text-sm">{currencySymbol}</span>
                                                </div>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={whtAmountStr}
                                                    onChange={(e) => setWhtAmountStr(e.target.value)}
                                                    className="block w-full pl-9 pr-4 py-2.5 rounded-lg border-2 border-amber-300 focus:border-amber-400 focus:outline-none bg-white tabular-nums"
                                                    placeholder="0.00"
                                                />
                                            </div>
                                            {whtNum > 0 && (
                                                <p className="text-xs text-amber-700 font-medium">
                                                    Cash received: {formatInvoiceAmount(netCashReceived)} · WHT credit: {formatInvoiceAmount(whtNum)}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* FX Settlement Rate — only shown for foreign-currency invoices */}
                                {isFxInvoice && (
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            Settlement Rate <span className="text-red-500">*</span>
                                        </label>
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
                                                1 {invoiceCurrencyCode} =
                                            </div>
                                            <input
                                                type="number"
                                                step="0.0001"
                                                min="0.0001"
                                                required
                                                value={settlementFxRate}
                                                onChange={(e) => setSettlementFxRate(e.target.value)}
                                                className="block w-full pl-20 pr-16 py-2.5 rounded-lg border border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 focus:outline-none bg-white tabular-nums"
                                                placeholder="e.g. 15.20"
                                            />
                                            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400 text-sm">
                                                {homeCurrencyCode}
                                            </div>
                                        </div>
                                        <p className="text-xs text-slate-500">
                                            Invoice issued at 1 {invoiceCurrencyCode} = {originalRate.toFixed(4)} {homeCurrencyCode}
                                        </p>
                                        {parsedSettlementRate > 0 && fxDiff !== null && (
                                            <div className={`text-xs font-semibold px-3 py-2 rounded-lg ${fxDiff > 0 ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : fxDiff < 0 ? "bg-red-50 text-red-700 border border-red-200" : "bg-slate-100 text-slate-600"}`}>
                                                {fxDiff > 0
                                                    ? `FX Gain: +${formatMoney(fxDiff, homeCurrencyCode)}`
                                                    : fxDiff < 0
                                                    ? `FX Loss: ${formatMoney(fxDiff, homeCurrencyCode)}`
                                                    : `No FX difference`}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Ledger Preview Panel */}
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-start gap-3">
                                    <div className="bg-slate-200 text-slate-600 rounded-lg p-1.5 flex-shrink-0 mt-0.5">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Ledger Impact</h4>
                                        <ul className="text-xs text-slate-600 mt-1.5 space-y-1 font-medium">
                                            <li>↑ Dr. Cash/Bank {whtNum > 0 ? `(${formatInvoiceAmount(netCashReceived)} net of WHT)` : isFxInvoice && amountInHomeCurrency ? `(${formatMoney(amountInHomeCurrency, homeCurrencyCode)})` : ""}</li>
                                            {whtNum > 0 && <li>↑ Dr. WHT Receivable ({formatInvoiceAmount(whtNum)})</li>}
                                            <li>↓ Cr. Accounts Receivable {isFxInvoice && arClearAmount ? `(${formatMoney(arClearAmount, homeCurrencyCode)})` : ""}</li>
                                            {isFxInvoice && fxDiff !== null && fxDiff > 0 && <li>↓ Cr. FX Gain ({formatMoney(fxDiff, homeCurrencyCode)})</li>}
                                            {isFxInvoice && fxDiff !== null && fxDiff < 0 && <li>↑ Dr. FX Loss ({formatMoney(Math.abs(fxDiff), homeCurrencyCode)})</li>}
                                        </ul>
                                    </div>
                                </div>

                                {error && (
                                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm flex items-start gap-2">
                                        <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        {error}
                                    </div>
                                )}

                            </form>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-slate-100 flex gap-3 bg-slate-50">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="payment-form"
                                disabled={loading || isOverpayment || periodLocked || checkingPeriod}
                                className="flex-1 px-4 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                            >
                                {loading ? (
                                    <>
                                        <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                        Processing...
                                    </>
                                ) : periodLocked ? (
                                    <>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                        Period Locked
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                        Confirm Payment
                                    </>
                                )}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
