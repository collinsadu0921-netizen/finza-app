"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { formatMoney } from "@/lib/money"
import { normalizeCountry, getAllowedMethods, getMobileMoneyLabel } from "@/lib/payments/eligibility"
import type { RetailMomoCartSnapshot } from "@/lib/retail/pos/retailMomoCartFingerprint"
import { isRetailMtnSandboxMomoPublicEnvEnabled } from "@/lib/retail/pos/isRetailMtnSandboxMomoPublicEnvEnabled"

/** Matches Retail POS register/search fields (`border-2 border-slate-300`, `shadow-inner`, blue focus). */
const retailTextInputClass =
  "min-h-[48px] w-full rounded-lg border-2 border-slate-300 bg-slate-50/50 px-3 py-2 text-base font-semibold text-slate-900 shadow-inner placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"

const retailSelectClass =
  "min-h-[48px] w-full rounded-lg border-2 border-slate-300 bg-slate-50/50 px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"

/** Compact amount field for split rows — same border/focus tokens as POS inputs. */
const retailAmountCellClass =
  "h-11 w-full min-w-[6.5rem] max-w-[8.5rem] rounded-lg border-2 border-slate-300 bg-slate-50/50 px-2 py-2 text-right text-sm font-extrabold tabular-nums text-slate-900 shadow-inner focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:max-w-[9rem]"

/** Retail POS payment tiles: 1px idle, 2px + ring selected; MoMo uses neutral slate (not a separate “brand lane”). */
function methodTileClass(
  selected: boolean,
  method: "cash" | "momo" | "card",
  disabled: boolean,
): string {
  const base =
    "min-h-[52px] touch-manipulation rounded-xl px-2 py-3 text-center text-sm font-extrabold leading-tight tracking-tight transition focus:outline-none focus:ring-2 focus:ring-offset-1 active:scale-[0.99] disabled:cursor-not-allowed sm:min-h-[56px] sm:px-2.5"
  if (disabled) return `${base} border border-slate-100 bg-slate-50 text-slate-400`
  if (!selected) {
    return `${base} border border-slate-200 bg-white text-slate-800 shadow-sm hover:border-slate-300 hover:bg-slate-50 focus:ring-slate-400/25`
  }
  if (method === "cash") {
    return `${base} border-2 border-emerald-500 bg-emerald-50 text-emerald-950 shadow-sm ring-1 ring-emerald-500/15 focus:ring-emerald-500/30`
  }
  if (method === "momo") {
    return `${base} border-2 border-slate-700 bg-slate-100 text-slate-900 shadow-sm ring-1 ring-slate-900/10 focus:ring-slate-500/25`
  }
  return `${base} border-2 border-slate-600 bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/10 focus:ring-slate-500/25`
}

/** Status wells: same radius as cards (`rounded-xl`), slate-first except success / warning / error. */
function momoStatusWellClass(phase: "idle" | "sending" | "pending" | "finalizing" | "failed"): string {
  switch (phase) {
    case "failed":
      return "rounded-xl border border-red-200/80 bg-red-50/90 px-3 py-2.5 text-sm font-medium text-red-950"
    case "finalizing":
      return "rounded-xl border border-emerald-200/80 bg-emerald-50/90 px-3 py-2.5 text-sm font-medium text-emerald-950"
    case "pending":
      return "rounded-xl border border-slate-200/90 bg-slate-100 px-3 py-2.5 text-sm font-medium text-slate-800"
    case "sending":
      return "rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-sm font-medium text-amber-950"
    default:
      return "rounded-xl border border-slate-200/90 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800"
  }
}

export type PaymentLine = {
  method: "cash" | "momo" | "card"
  amount: number
}

export type PaymentResult = {
  payments: PaymentLine[]
  cash_received?: number
  change_given?: number
  foreign_currency?: string
  foreign_amount?: number
  exchange_rate?: number
  converted_ghs_amount?: number
  // Layaway fields (Phase 2 - Layaway/Installments)
  is_layaway?: boolean
  deposit_amount?: number
  /** Set when MTN sandbox push payment succeeded — sale finalize must send this to `/api/sales/create`. */
  retail_mtn_sandbox_payment_reference?: string
}

export interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  totalPayable: number
  onComplete: (result: PaymentResult) => void
  currencyCode?: string | null
  businessCountry?: string | null
  // Layaway support (Phase 2)
  selectedCustomer?: { id: string; name: string; status?: string } | null
  // Phase 4: Offline mode support
  isOffline?: boolean
  /** Larger cash / change controls for retail cashier screens */
  emphasizeCashFlow?: boolean
  /** When true, single-tender Mobile Money uses MTN sandbox RTP + polling before `onComplete`. */
  retailMtnSandboxMomo?: boolean
  /** Cart snapshot for server-side pricing commit at initiate (discount-aware). */
  retailMomoCartSnapshot?: RetailMomoCartSnapshot | null
  retailMomoRegisterContext?: {
    register_id: string
    cashier_session_id: string
    store_id: string
  } | null
  /** When true (e.g. parent is posting `/api/sales/create`), block closing / duplicate actions. */
  saleProcessing?: boolean
}

export default function PaymentModal({
  isOpen,
  onClose,
  totalPayable,
  onComplete,
  currencyCode = null,
  businessCountry = null,
  selectedCustomer = null,
  isOffline = false,
  emphasizeCashFlow = false,
  retailMtnSandboxMomo = false,
  retailMomoCartSnapshot = null,
  retailMomoRegisterContext = null,
  saleProcessing = false,
}: PaymentModalProps) {
  const splitModePrevRef = useRef<"single" | "split" | "layaway">("single")
  const [paymentMode, setPaymentMode] = useState<"single" | "split" | "layaway">("single")
  const [singleMethod, setSingleMethod] = useState<"cash" | "momo" | "card">("cash")
  const [splitPayments, setSplitPayments] = useState<PaymentLine[]>([
    { method: "cash", amount: 0 },
  ])
  const [cashGiven, setCashGiven] = useState("")
  /** Split + cash: when true, `cash_received` defaults to the sum of cash line amounts (no duplicate entry). */
  const [splitCashLineAmountOnly, setSplitCashLineAmountOnly] = useState(true)
  const [error, setError] = useState("")
  const [currency, setCurrency] = useState<string>(currencyCode || "")
  const [foreignAmount, setForeignAmount] = useState("")
  const [exchangeRate, setExchangeRate] = useState("")
  // Layaway fields (Phase 2)
  const [layawayDeposit, setLayawayDeposit] = useState("")
  const [layawayPaymentMethod, setLayawayPaymentMethod] = useState<"cash" | "momo" | "card">("cash")

  const [momoPhone, setMomoPhone] = useState("")
  const [momoPhase, setMomoPhase] = useState<"idle" | "sending" | "pending" | "finalizing" | "failed">("idle")
  const [momoReference, setMomoReference] = useState<string | null>(null)
  const [momoMessage, setMomoMessage] = useState<string | null>(null)
  const momoPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const momoStartedAtRef = useRef<number>(0)
  const momoAttemptIdRef = useRef<string | null>(null)
  /** Prevents overlapping `setInterval` ticks from running two MTN status checks at once. */
  const momoPollTickInFlightRef = useRef(false)
  /** Ensures `onComplete` runs at most once per MoMo `reference`. */
  const momoCompleteFiredForRef = useRef<string | null>(null)
  /** True after we've seen `saleProcessing` while in `finalizing` (avoids false "sale failed" before parent sets processing). */
  const momoSaleBackendObservedRef = useRef(false)
  const momoPhoneInputRef = useRef<HTMLInputElement>(null)

  // Get allowed payment methods based on country
  const countryCode = normalizeCountry(businessCountry)
  const allowedMethods = getAllowedMethods(countryCode)
  const mobileMoneyLabel = getMobileMoneyLabel(countryCode)
  
  // Map eligibility methods to UI methods
  const canUseCash = allowedMethods.includes("cash")
  const canUseMobileMoney = allowedMethods.includes("mobile_money")
  const canUseCard = allowedMethods.includes("card")
  
  // Phase 4: Filter available methods for UI - restrict when offline
  // Offline mode only allows: Cash, limited card (if terminal supports offline auth)
  // Not allowed offline: MoMo, Bank transfer, Gift cards, Layaway payments
  const availableMethods = useMemo<Array<{ value: "cash" | "momo" | "card"; label: string }>>(() => {
    const methods: Array<{ value: "cash" | "momo" | "card"; label: string }> = []
    if (isOffline) {
      // Offline mode: Only cash and limited card support
      if (canUseCash) methods.push({ value: "cash", label: "Cash" })
      // Card is allowed offline only if terminal supports offline auth (not implemented yet)
      // For now, we'll allow it but show a warning
      if (canUseCard) methods.push({ value: "card", label: "Card (Offline Auth Required)" })
      // MoMo, Bank transfer, Gift cards, Layaway are NOT allowed offline
    } else {
      // Online mode: All allowed methods
      if (canUseCash) methods.push({ value: "cash", label: "Cash" })
      if (canUseMobileMoney) methods.push({ value: "momo", label: mobileMoneyLabel })
      if (canUseCard) methods.push({ value: "card", label: "Card" })
    }
    return methods
  }, [canUseCash, canUseMobileMoney, canUseCard, mobileMoneyLabel, isOffline])
  
  const hasNoAllowedMethods = availableMethods.length === 0

  /** Prop OR public env — avoids silent fallback to "Complete sale" when callers omit the prop or use `true` in `.env`. */
  const retailMtnSandboxMomoActive =
    retailMtnSandboxMomo || isRetailMtnSandboxMomoPublicEnvEnabled()

  const showMomoSandboxFlow =
    retailMtnSandboxMomoActive && !isOffline && paymentMode === "single" && singleMethod === "momo"

  const splitCashPortion = useMemo(() => {
    if (paymentMode !== "split") return 0
    return splitPayments
      .filter((p) => p.method === "cash")
      .reduce((s, p) => s + Number(p.amount || 0), 0)
  }, [paymentMode, splitPayments])

  /** Blocks method/mode switches and non-MoMo Complete Sale while a sandbox MoMo attempt is in flight. */
  const momoBusy = useMemo(
    () =>
      retailMtnSandboxMomoActive &&
      !isOffline &&
      (momoPhase === "sending" || momoPhase === "pending" || momoPhase === "finalizing"),
    [retailMtnSandboxMomoActive, isOffline, momoPhase],
  )

  const stopMomoPoll = useCallback(() => {
    if (momoPollRef.current) {
      clearInterval(momoPollRef.current)
      momoPollRef.current = null
    }
  }, [])

  // Reset when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      splitModePrevRef.current = "single"
      setPaymentMode("single")
      // Set default method to first available, or cash if available
      const defaultMethod = canUseCash ? "cash" : (availableMethods[0]?.value || "cash")
      setSingleMethod(defaultMethod as "cash" | "momo" | "card")
      setSplitPayments([{ method: defaultMethod as "cash" | "momo" | "card", amount: 0 }])
      setCashGiven("")
      setError("")
      // Always use base currency - foreign currency not supported
      setCurrency(currencyCode || "")
      setForeignAmount("")
      setExchangeRate("")
      // Reset layaway fields
      setLayawayDeposit("")
      setLayawayPaymentMethod(defaultMethod as "cash" | "momo" | "card")
      setMomoPhone("")
      setMomoPhase("idle")
      setMomoReference(null)
      setMomoMessage(null)
      momoAttemptIdRef.current = null
      momoPollTickInFlightRef.current = false
      momoCompleteFiredForRef.current = null
      momoSaleBackendObservedRef.current = false
      setSplitCashLineAmountOnly(true)
      stopMomoPoll()
    }
  }, [isOpen, currencyCode, canUseCash, availableMethods, stopMomoPoll])

  useEffect(() => {
    if (paymentMode !== "split") return
    if (!splitPayments.some((p) => p.method === "cash")) return
    if (!splitCashLineAmountOnly) return
    const n = splitCashPortion
    setCashGiven(n <= 0 ? "" : Number.isInteger(n) ? String(n) : n.toFixed(2))
  }, [paymentMode, splitPayments, splitCashPortion, splitCashLineAmountOnly])

  useEffect(() => {
    if (!isOpen || !showMomoSandboxFlow || momoBusy) return
    if (momoPhase !== "idle" || momoReference) return
    const t = window.setTimeout(() => momoPhoneInputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [isOpen, showMomoSandboxFlow, momoBusy, momoPhase, momoReference])

  useEffect(() => {
    if (momoPhase === "finalizing" && saleProcessing) {
      momoSaleBackendObservedRef.current = true
    }
  }, [momoPhase, saleProcessing])

  useEffect(() => {
    if (!isOpen || momoPhase !== "finalizing") return
    if (!momoSaleBackendObservedRef.current) return
    if (saleProcessing) return
    momoSaleBackendObservedRef.current = false
    setMomoPhase("failed")
    setMomoMessage("Sale could not be completed. Try Mobile Money again or choose another payment method.")
  }, [saleProcessing, momoPhase, isOpen])

  /** Parent must set `saleProcessing` right after MoMo success; if it never does, avoid a locked finalizing state. */
  useEffect(() => {
    if (momoPhase !== "finalizing" || saleProcessing) return
    const id = window.setTimeout(() => {
      setMomoPhase((p) => (p === "finalizing" ? "failed" : p))
      setMomoMessage(
        "Could not finish the sale. Try Mobile Money again or choose another payment method.",
      )
    }, 2500)
    return () => window.clearTimeout(id)
  }, [momoPhase, saleProcessing])

  useEffect(() => {
    if (!isOpen || momoPhase !== "pending" || !momoReference) return

    const tick = async () => {
      if (momoPollTickInFlightRef.current) return
      momoPollTickInFlightRef.current = true
      const refSnapshot = momoReference
      try {
        const elapsed = Date.now() - momoStartedAtRef.current
        const timeoutQs = elapsed > 4.5 * 60 * 1000 ? "&client_timeout=1" : ""
        const res = await fetch(
          `/api/retail/pos/payments/mtn-sandbox/status?reference=${encodeURIComponent(refSnapshot)}${timeoutQs}`,
        )
        const data = (await res.json().catch(() => ({}))) as {
          app_status?: string
          error?: string
          message?: string | null
          provider_status?: string | null
        }
        if (!res.ok) {
          setMomoMessage(data.error || "Status check failed")
          return
        }
        const app = data.app_status || "pending"
        if (app === "successful") {
          if (momoCompleteFiredForRef.current === refSnapshot) return
          momoCompleteFiredForRef.current = refSnapshot
          stopMomoPoll()
          setMomoPhase("finalizing")
          setMomoMessage("Payment approved. Completing sale…")
          onComplete({
            payments: [{ method: "momo", amount: totalPayable }],
            retail_mtn_sandbox_payment_reference: refSnapshot,
          })
          return
        }
        if (app === "provider_ambiguous") {
          stopMomoPoll()
          setMomoPhase("failed")
          setMomoMessage(
            data.message?.trim() ||
              `Unrecognized MTN status (${data.provider_status ?? "unknown"}). Check MTN or try again.`,
          )
          return
        }
        if (app === "failed" || app === "cancelled" || app === "expired" || app === "provider_error") {
          stopMomoPoll()
          setMomoPhase("failed")
          setMomoMessage(
            app === "expired"
              ? "Payment timed out."
              : app === "cancelled"
                ? "Payment cancelled."
                : app === "provider_error"
                  ? "Could not confirm payment with MTN."
                  : "Payment failed or was rejected.",
          )
        }
      } catch {
        setMomoMessage("Network error while checking payment.")
      } finally {
        momoPollTickInFlightRef.current = false
      }
    }

    void tick()
    momoPollRef.current = setInterval(() => void tick(), 2800)
    return () => stopMomoPoll()
  }, [isOpen, momoPhase, momoReference, totalPayable, onComplete, stopMomoPoll])

  const sendMomoPrompt = async () => {
    const phone = momoPhone.trim()
    if (!phone) {
      setError("Enter the customer MTN number")
      return
    }
    if (!retailMomoCartSnapshot?.items?.length) {
      setError("Cart is empty — add items before Mobile Money payment.")
      return
    }
    if (!retailMomoRegisterContext) {
      setError("Register session or store is not ready for Mobile Money.")
      return
    }
    setError("")
    setMomoMessage(null)
    momoCompleteFiredForRef.current = null
    momoSaleBackendObservedRef.current = false
    setMomoPhase("sending")
    momoAttemptIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`
    try {
      const res = await fetch("/api/retail/pos/payments/mtn-sandbox/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          amount_total_ghs: totalPayable,
          cart_snapshot: retailMomoCartSnapshot,
          register_id: retailMomoRegisterContext.register_id,
          cashier_session_id: retailMomoRegisterContext.cashier_session_id,
          store_id: retailMomoRegisterContext.store_id,
          client_attempt_id: momoAttemptIdRef.current,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { reference?: string; error?: string }
      if (!res.ok) {
        setMomoPhase("failed")
        setMomoMessage(data.error || "Could not start MoMo payment")
        return
      }
      const ref = data.reference
      if (!ref) {
        setMomoPhase("failed")
        setMomoMessage("Invalid response from server")
        return
      }
      setMomoReference(ref)
      momoStartedAtRef.current = Date.now()
      setMomoPhase("pending")
      setMomoMessage("Waiting for customer to approve on their phone…")
    } catch (e) {
      setMomoPhase("failed")
      setMomoMessage(e instanceof Error ? e.message : "Request failed")
    }
  }

  const handleCancelClick = async () => {
    if (momoPhase === "finalizing" || saleProcessing) return
    if (showMomoSandboxFlow && momoPhase === "pending" && momoReference) {
      stopMomoPoll()
      try {
        await fetch("/api/retail/pos/payments/mtn-sandbox/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference: momoReference }),
        })
      } catch {
        /* best-effort */
      }
      setMomoPhase("idle")
      setMomoReference(null)
      setMomoMessage(null)
    }
    stopMomoPoll()
    onClose()
  }

  /** When switching to Split, pre-fill two rows 50/50 so cashiers start balanced (still editable). */
  useEffect(() => {
    if (!isOpen || totalPayable <= 0) return
    const was = splitModePrevRef.current
    splitModePrevRef.current = paymentMode
    if (paymentMode !== "split" || was === "split") return
    setSplitCashLineAmountOnly(true)
    const defaultMethod = canUseCash ? "cash" : (availableMethods[0]?.value || "cash")
    const first = defaultMethod as "cash" | "momo" | "card"
    const second =
      (availableMethods.find((m) => m.value !== first)?.value ||
        (first === "cash" ? "card" : "cash")) as "cash" | "momo" | "card"
    const half = Math.round((totalPayable / 2) * 100) / 100
    const rest = Math.round((totalPayable - half) * 100) / 100
    setSplitPayments([
      { method: first, amount: half },
      { method: second, amount: rest },
    ])
    setError("")
  }, [isOpen, paymentMode, totalPayable, canUseCash, availableMethods])

  // Auto-fill single payment with total
  useEffect(() => {
    if (paymentMode === "single" && totalPayable > 0) {
      // Single payment is always the full amount
    }
  }, [paymentMode, totalPayable])

  // Check if cash is involved
  const hasCash = () => {
    if (paymentMode === "single") {
      return singleMethod === "cash"
    } else {
      return splitPayments.some((p) => p.method === "cash")
    }
  }

  // Calculate payment totals
  const calculateTotals = () => {
    if (paymentMode === "single") {
      if (singleMethod === "cash") {
        const cashGivenNum = Number(cashGiven) || 0
        const totalPaid = totalPayable // For single cash, amount is always totalPayable
        const change = cashGivenNum - totalPayable
        return {
          totalPaid,
          cashPaid: totalPayable,
          cashGiven: cashGivenNum,
          change: change >= 0 ? change : 0,
        }
      } else {
        return {
          totalPaid: totalPayable,
          cashPaid: 0,
          cashGiven: 0,
          change: 0,
        }
      }
    } else {
      // Split payment
      const totalPaid = splitPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
      const cashPaid = splitPayments
        .filter((p) => p.method === "cash")
        .reduce((sum, p) => sum + Number(p.amount || 0), 0)
      
      if (hasCash()) {
        const cashGivenNum = splitCashLineAmountOnly ? cashPaid : Number(cashGiven) || 0
        const cashChangeDue = Math.max(0, cashGivenNum - cashPaid)
        return {
          totalPaid,
          cashPaid,
          cashGiven: cashGivenNum,
          change: cashChangeDue,
        }
      } else {
        return {
          totalPaid,
          cashPaid: 0,
          cashGiven: 0,
          change: 0,
        }
      }
    }
  }

  const totals = calculateTotals()
  const splitTotal = paymentMode === "split" 
    ? splitPayments.reduce((sum, p) => sum + (p.amount || 0), 0)
    : totalPayable
  const splitRemaining = totalPayable - splitTotal

  const isValid = () => {
    // Check for NaN or invalid numbers
    if (isNaN(totalPayable) || totalPayable < 0) return false

    // Foreign currency not supported - must use base currency
    if (currency !== currencyCode) {
      return false
    }

    if (paymentMode === "layaway") {
      if (!selectedCustomer || selectedCustomer.status === "blocked") return false
      const depositNum = Number(layawayDeposit)
      if (isNaN(depositNum) || depositNum <= 0) return false
      if (depositNum >= totalPayable) return false
      // Minimum 10% deposit
      if (depositNum < totalPayable * 0.1) return false
      if (layawayPaymentMethod === "cash") {
        const cashGivenNum = Number(cashGiven)
        if (isNaN(cashGivenNum) || cashGivenNum < depositNum) return false
      }
      return true
    } else if (paymentMode === "single") {
      if (singleMethod === "cash") {
        const cashGivenNum = Number(cashGiven)
        if (isNaN(cashGivenNum) || cashGivenNum < 0) return false
        if (cashGivenNum < totalPayable) return false // Cash given must be >= total
        return true
      } else {
        if (showMomoSandboxFlow && !momoPhone.trim()) return false
        return true
      }
    } else {
      // Split payment validation
      if (splitPayments.length === 0) return false
      
      // Each payment line must have amount > 0
      for (const payment of splitPayments) {
        if (!payment.amount || payment.amount <= 0 || isNaN(payment.amount)) return false
      }

      // Total must equal sale total (with tolerance for floating point)
      const total = splitPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
      if (isNaN(total) || total < 0) return false
      
      const difference = Math.abs(total - totalPayable)
      if (difference > 0.01) return false // Must be within 1 cent

      if (hasCash()) {
        const cashPaid = splitPayments
          .filter((p) => p.method === "cash")
          .reduce((sum, p) => sum + Number(p.amount || 0), 0)
        const cashGivenNum = splitCashLineAmountOnly ? cashPaid : Number(cashGiven) || 0
        if (!splitCashLineAmountOnly) {
          if (isNaN(cashGivenNum) || cashGivenNum < 0) return false
          if (cashGivenNum < cashPaid) return false
        }
      }

      return true
    }
  }

  const handleAddSplitLine = () => {
    // Add a new payment line with the first available method not already used
    const usedMethods = splitPayments.map((p) => p.method)
    let newMethod: "cash" | "momo" | "card" = availableMethods[0]?.value || "cash"
    
    // Find first available method not already used
    for (const method of availableMethods) {
      if (!usedMethods.includes(method.value)) {
        newMethod = method.value
        break
      }
    }

    setSplitPayments([...splitPayments, { method: newMethod, amount: 0 }])
  }

  const handleRemoveSplitLine = (index: number) => {
    if (splitPayments.length <= 1) return // Keep at least one line
    setSplitPayments(splitPayments.filter((_, i) => i !== index))
  }

  const handleUpdateSplitPayment = (index: number, field: "method" | "amount", value: string | number) => {
    const updated = [...splitPayments]
    if (field === "method") {
      updated[index].method = value as "cash" | "momo" | "card"
    } else {
      const numValue = Number(value)
      updated[index].amount = (isNaN(numValue) || numValue < 0) ? 0 : numValue
    }
    setSplitPayments(updated)
    setError("") // Clear error on change
  }

  /** Set this row's amount so all rows sum to the sale total (fills remaining balance on this line). */
  const fillSplitRowWithRemainder = (index: number) => {
    setSplitPayments((rows) => {
      const restOthers = rows.reduce(
        (s, p, i) => (i === index ? s : s + Number(p.amount || 0)),
        0
      )
      const fill = Math.max(0, Math.round((totalPayable - restOthers) * 100) / 100)
      return rows.map((p, i) => (i === index ? { ...p, amount: fill } : p))
    })
    setError("")
  }

  const handleComplete = () => {
    if (momoBusy) return
    if (!isValid()) {
      if (paymentMode === "layaway") {
        if (!selectedCustomer) {
          setError("Please select a customer first")
          return
        }
        if (selectedCustomer.status === "blocked") {
          setError("Cannot create layaway for blocked customer")
          return
        }
        const depositNum = Number(layawayDeposit)
        if (isNaN(depositNum) || depositNum <= 0) {
          setError("Deposit amount must be greater than 0")
          return
        }
        if (depositNum >= totalPayable) {
          setError("Deposit amount must be less than total amount")
          return
        }
        if (depositNum < totalPayable * 0.1) {
          setError(`Minimum deposit is ${formatMoney(totalPayable * 0.1, currencyCode)} (10%)`)
          return
        }
        if (layawayPaymentMethod === "cash") {
          const cashGivenNum = Number(cashGiven)
          if (isNaN(cashGivenNum) || cashGivenNum < depositNum) {
            setError(`Cash given (${formatMoney(cashGivenNum, currencyCode)}) must be at least the deposit (${formatMoney(depositNum, currencyCode)})`)
            return
          }
        }
      } else if (paymentMode === "single" && singleMethod === "cash") {
        const cashGivenNum = Number(cashGiven)
        if (isNaN(cashGivenNum) || cashGivenNum < totalPayable) {
          setError(`Cash given (${formatMoney(cashGivenNum, currencyCode)}) must be at least the total payable (${formatMoney(totalPayable, currencyCode)})`)
          return
        }
      } else if (paymentMode === "split") {
        const total = splitPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
        const difference = Math.abs(total - totalPayable)
        if (difference > 0.01) {
          setError(`Payment total (${formatMoney(total, currencyCode)}) must equal sale total (${formatMoney(totalPayable, currencyCode)})`)
          return
        }
        if (hasCash()) {
          const cashPaid = splitPayments
            .filter((p) => p.method === "cash")
            .reduce((sum, p) => sum + Number(p.amount || 0), 0)
          const cashGivenNum = splitCashLineAmountOnly ? cashPaid : Number(cashGiven) || 0
          if (!splitCashLineAmountOnly && cashGivenNum < cashPaid) {
            setError(`Cash tendered (${formatMoney(cashGivenNum, currencyCode)}) must be at least the cash lines (${formatMoney(cashPaid, currencyCode)})`)
            return
          }
        }
      }
      setError("Please check payment amounts")
      return
    }

    // Foreign currency not supported - must use base currency
    if (currency !== currencyCode) {
      setError("Foreign currency payments are not currently supported. Please use the base business currency only.")
      return
    }

    if (retailMtnSandboxMomoActive && !isOffline) {
      if (paymentMode === "single" && singleMethod === "momo") {
        setError("Use Send to phone for Mobile Money in this checkout.")
        return
      }
      if (paymentMode === "split" && splitPayments.some((p) => p.method === "momo")) {
        setError("Mobile Money works only as a full payment in this build.")
        return
      }
      if (paymentMode === "layaway" && layawayPaymentMethod === "momo") {
        setError("Layaway with Mobile Money sandbox is not supported in this build.")
        return
      }
    }

    const result: PaymentResult = {
      payments: [],
      cash_received: undefined,
      change_given: undefined,
      // Foreign currency fields not set - FX not supported
      foreign_currency: undefined,
      foreign_amount: undefined,
      exchange_rate: undefined,
      converted_ghs_amount: undefined,
      // Layaway fields
      is_layaway: paymentMode === "layaway",
      deposit_amount: paymentMode === "layaway" ? Number(layawayDeposit) : undefined,
    }

    if (paymentMode === "layaway") {
      // Layaway payment: only deposit amount
      const depositNum = Number(layawayDeposit)
      result.payments = [{ method: layawayPaymentMethod, amount: depositNum }]
      if (layawayPaymentMethod === "cash") {
        const cashGivenNum = Number(cashGiven)
        result.cash_received = cashGivenNum
        result.change_given = Math.max(0, cashGivenNum - depositNum)
      }
    } else if (paymentMode === "single") {
      result.payments = [{ method: singleMethod, amount: totalPayable }]
      if (singleMethod === "cash") {
        const cashGivenNum = Number(cashGiven)
        result.cash_received = cashGivenNum
        result.change_given = Math.max(0, cashGivenNum - totalPayable)
      }
    } else {
      // Validate and normalize split payments
      const normalizedPayments = splitPayments
        .filter((p) => p.amount > 0)
        .map((p) => ({
          method: p.method,
          amount: Number(p.amount.toFixed(2)),
        }))

      // Adjust last payment to account for rounding
      const total = normalizedPayments.reduce((sum, p) => sum + p.amount, 0)
      const difference = totalPayable - total
      
      if (normalizedPayments.length > 0 && Math.abs(difference) > 0.001) {
        // Adjust the last payment to make total exact
        normalizedPayments[normalizedPayments.length - 1].amount = Number(
          (normalizedPayments[normalizedPayments.length - 1].amount + difference).toFixed(2)
        )
      }

      result.payments = normalizedPayments

      if (hasCash()) {
        const cashPaid = normalizedPayments
          .filter((p) => p.method === "cash")
          .reduce((sum, p) => sum + p.amount, 0)
        const cashGivenNum = splitCashLineAmountOnly ? cashPaid : Number(cashGiven) || 0
        result.cash_received = cashGivenNum
        result.change_given = Math.max(0, cashGivenNum - cashPaid)
      }
    }

    onComplete(result)
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
    >
      <div className="flex max-h-[min(92dvh,880px)] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-200/90 bg-white shadow-2xl shadow-slate-900/10 sm:mx-4 sm:max-h-[90vh] sm:rounded-2xl">
        <header className="shrink-0 border-b border-slate-200/90 bg-white px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="payment-modal-title"
                className="text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl"
              >
                Checkout
              </h2>
              <p className="mt-0.5 text-xs font-medium text-slate-500">Take payment for this sale</p>
            </div>
            {currencyCode ? (
              <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                {currencyCode}
              </span>
            ) : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5 sm:py-4">
          {isOffline && (
            <div className="mb-3 rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-amber-950">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-900">Offline</p>
              <p className="mt-1 text-sm font-medium leading-snug text-amber-950/95">
                Cash and card only here. Sale syncs when you are online again.
              </p>
            </div>
          )}

          {hasNoAllowedMethods && (
            <div className="mb-3 rounded-xl border border-red-200/80 bg-red-50/90 px-3 py-2.5 text-red-900">
              <p className="text-sm font-bold text-red-950">No payment methods</p>
              <p className="mt-1 text-sm font-medium leading-snug text-red-900/95">
                Set your business country in{" "}
                <a href="/settings/business-profile" className="font-bold underline underline-offset-2">
                  Business Profile
                </a>{" "}
                to enable cards and mobile money.
              </p>
            </div>
          )}

          <div className="mb-3 rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-sm ring-1 ring-slate-900/5 sm:mb-4 sm:py-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Amount due</div>
            <div className="mt-1 tabular-nums text-2xl font-extrabold leading-none tracking-tight text-slate-900 sm:text-3xl">
              {formatMoney(totalPayable, currencyCode)}
            </div>
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Currency
            </label>
            <select
              value={currency}
              onChange={(e) => {
                const newCurrency = e.target.value
                if (newCurrency !== currencyCode) {
                  setError("Use your store currency only.")
                  return
                }
                setCurrency(newCurrency)
                setForeignAmount("")
                setExchangeRate("")
                setError("")
              }}
              className={retailSelectClass}
              disabled={!currencyCode}
            >
              {currencyCode && <option value={currencyCode}>{currencyCode}</option>}
            </select>
            {currency !== currencyCode && (
              <div className="mt-2 rounded-xl border border-red-200/80 bg-red-50/90 px-3 py-2 text-sm font-medium text-red-900">
                Checkout stays in your store currency.
              </div>
            )}
          </div>

          <div className="mb-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Payment type</p>
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200/90 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setPaymentMode("single")}
                disabled={momoBusy || saleProcessing}
                className={`min-h-[44px] touch-manipulation rounded-lg px-1.5 py-2 text-center text-[11px] font-extrabold leading-tight transition sm:px-2 sm:text-xs ${
                  paymentMode === "single"
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5"
                    : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                Single
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode("split")}
                disabled={momoBusy || saleProcessing}
                className={`min-h-[44px] touch-manipulation rounded-lg px-1.5 py-2 text-center text-[11px] font-extrabold leading-tight transition sm:px-2 sm:text-xs ${
                  paymentMode === "split"
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5"
                    : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                Split
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode("layaway")}
                disabled={
                  !selectedCustomer || selectedCustomer.status === "blocked" || isOffline || momoBusy || saleProcessing
                }
                title={
                  isOffline
                    ? "Layaway not available offline"
                    : !selectedCustomer
                      ? "Select a customer first"
                      : selectedCustomer.status === "blocked"
                        ? "Customer is blocked"
                        : ""
                }
                className={`min-h-[44px] touch-manipulation rounded-lg px-1.5 py-2 text-center text-[11px] font-extrabold leading-tight transition sm:px-2 sm:text-xs ${
                  paymentMode === "layaway"
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5"
                    : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                Layaway
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-3 rounded-xl border border-red-200/80 bg-red-50/90 px-3 py-2.5 text-sm font-medium text-red-900">
              {error}
            </div>
          )}

        {/* Single Payment Mode */}
        {paymentMode === "single" && (
          <div className="space-y-3 sm:space-y-4">
            <div>
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Tender
              </label>
              <div
                className={`grid gap-2 ${availableMethods.length === 1 ? "grid-cols-1" : availableMethods.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
              >
                {availableMethods.map((method) => (
                  <button
                    key={method.value}
                    type="button"
                    onClick={() => setSingleMethod(method.value)}
                    className={methodTileClass(
                      singleMethod === method.value,
                      method.value,
                      hasNoAllowedMethods || momoBusy || saleProcessing,
                    )}
                    disabled={hasNoAllowedMethods || momoBusy || saleProcessing}
                  >
                    {method.label}
                  </button>
                ))}
              </div>
            </div>
            {showMomoSandboxFlow && (
              <div className="space-y-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Mobile money</p>
                  <span className="inline-flex shrink-0 items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">
                    Training
                  </span>
                </div>
                <p className="text-sm font-medium leading-snug text-slate-600">
                  <span className="font-extrabold text-slate-800">
                    Enter customer MTN number to send payment prompt.
                  </span>{" "}
                  Then use <span className="font-extrabold text-slate-800">Send to phone</span> below. Customer taps
                  approve on their handset. No real charges in training.
                </p>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Customer MTN number
                  </label>
                  <input
                    ref={momoPhoneInputRef}
                    type="tel"
                    value={momoPhone}
                    onChange={(e) => {
                      setMomoPhone(e.target.value)
                      setError("")
                    }}
                    placeholder="024…"
                    disabled={momoBusy || saleProcessing}
                    className={retailTextInputClass}
                    autoComplete="tel"
                  />
                </div>
                {momoMessage ? (
                  <div className="space-y-2">
                    {momoPhase !== "idle" ? (
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        {momoPhase === "sending"
                          ? "Sending"
                          : momoPhase === "pending"
                            ? "Waiting on customer"
                            : momoPhase === "finalizing"
                              ? "Finishing sale"
                              : momoPhase === "failed"
                                ? "Needs attention"
                                : "Update"}
                      </p>
                    ) : null}
                    <div className={momoStatusWellClass(momoPhase)}>{momoMessage}</div>
                  </div>
                ) : null}
                {momoPhase === "failed" ? (
                  <button
                    type="button"
                    className="min-h-[48px] w-full touch-manipulation rounded-xl border-2 border-slate-300 bg-white py-2.5 text-sm font-extrabold text-slate-800 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
                    onClick={() => {
                      momoCompleteFiredForRef.current = null
                      momoSaleBackendObservedRef.current = false
                      setMomoPhase("idle")
                      setMomoMessage(null)
                      setMomoReference(null)
                    }}
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            )}
            {singleMethod === "cash" && (
              emphasizeCashFlow ? (
                <div className="space-y-3 rounded-xl border border-emerald-300/90 bg-emerald-50/80 p-4 shadow-sm ring-1 ring-emerald-900/5">
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-emerald-900">
                    Cash tendered <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cashGiven}
                    onChange={(e) => {
                      setCashGiven(e.target.value)
                      setError("")
                    }}
                    placeholder="0.00"
                    className="min-h-[56px] w-full rounded-lg border-2 border-emerald-400/90 bg-white px-4 text-2xl font-semibold text-slate-900 shadow-inner focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
                    autoFocus
                  />
                  {Number(cashGiven) > 0 && (
                    <div className="rounded-xl border border-emerald-500/80 bg-white p-4 text-center shadow-sm">
                      <div className="text-sm font-medium text-slate-600">
                        {Number(cashGiven) >= totalPayable && totals.change === 0
                          ? "Change"
                          : "Change due"}
                      </div>
                      <div className="text-3xl font-bold tracking-tight text-emerald-800">
                        {Number(cashGiven) >= totalPayable && totals.change === 0
                          ? "None (exact)"
                          : formatMoney(totals.change, currencyCode)}
                      </div>
                      {totals.change <= 0 && Number(cashGiven) < totalPayable && (
                        <div className="mt-1 text-sm text-red-600">Enter at least the total due</div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2 rounded-xl border border-slate-200/90 bg-slate-50/90 p-3 sm:p-4">
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Cash tendered <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cashGiven}
                    onChange={(e) => {
                      setCashGiven(e.target.value)
                      setError("")
                    }}
                    placeholder="0.00"
                    className={retailTextInputClass}
                    autoFocus
                  />
                  {totals.change > 0 && (
                    <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/90 p-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-emerald-800">Change due</div>
                      <div className="text-xl font-extrabold tabular-nums text-emerald-900">
                        {formatMoney(totals.change, currencyCode)}
                      </div>
                    </div>
                  )}
                  {Number(cashGiven) > 0 && Number(cashGiven) < totalPayable && (
                    <div className="text-sm font-medium text-red-700">Enter at least the amount due.</div>
                  )}
                </div>
              )
            )}
          </div>
        )}

        {/* Layaway Payment Mode */}
        {paymentMode === "layaway" && (
          <div className="space-y-3 sm:space-y-4">
            {!selectedCustomer ? (
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-sm font-medium text-amber-950">
                Pick a customer on the register before layaway.
              </div>
            ) : selectedCustomer.status === "blocked" ? (
              <div className="rounded-xl border border-red-200/80 bg-red-50/90 px-3 py-2.5 text-sm font-medium text-red-900">
                Layaway isn&apos;t available for {selectedCustomer.name}.
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200/90 bg-slate-50 px-3 py-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Customer</div>
                  <div className="mt-0.5 text-sm font-extrabold text-slate-900">{selectedCustomer.name}</div>
                </div>
                <div className="rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-900/5">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-slate-600">Sale total</span>
                    <span className="font-extrabold tabular-nums text-slate-900">
                      {formatMoney(totalPayable, currencyCode)}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Deposit amount <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={totalPayable}
                    value={layawayDeposit}
                    onChange={(e) => {
                      setLayawayDeposit(e.target.value)
                      setError("")
                    }}
                    placeholder="0.00"
                    className={retailTextInputClass}
                    autoFocus
                  />
                  <div className="mt-1 text-xs font-medium text-slate-500">
                    At least {formatMoney(totalPayable * 0.1, currencyCode)} (10%)
                  </div>
                </div>
                {Number(layawayDeposit) > 0 && (
                  <div className="space-y-2 rounded-xl border border-slate-200/90 bg-slate-50 px-3 py-2.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Deposit</span>
                      <span className="font-extrabold tabular-nums text-slate-900">
                        {formatMoney(Number(layawayDeposit), currencyCode)}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-2 text-sm">
                      <span className="text-slate-600">Balance after</span>
                      <span className="font-extrabold tabular-nums text-amber-800">
                        {formatMoney(totalPayable - Number(layawayDeposit), currencyCode)}
                      </span>
                    </div>
                  </div>
                )}
                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Deposit tender
                  </label>
                  <div
                    className={`grid gap-2 ${availableMethods.length === 1 ? "grid-cols-1" : availableMethods.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
                  >
                    {availableMethods.map((method) => (
                      <button
                        key={method.value}
                        type="button"
                        onClick={() => setLayawayPaymentMethod(method.value)}
                        className={methodTileClass(
                          layawayPaymentMethod === method.value,
                          method.value,
                          hasNoAllowedMethods,
                        )}
                        disabled={hasNoAllowedMethods}
                      >
                        {method.label}
                      </button>
                    ))}
                  </div>
                </div>
                {layawayPaymentMethod === "cash" && Number(layawayDeposit) > 0 && (
                  <div className="space-y-2 rounded-xl border border-slate-200/90 bg-slate-50/90 p-3">
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Cash tendered <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={cashGiven}
                      onChange={(e) => {
                        setCashGiven(e.target.value)
                        setError("")
                      }}
                      placeholder="0.00"
                      className={retailTextInputClass}
                    />
                    {Number(cashGiven) >= Number(layawayDeposit) && (
                      <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/90 p-3">
                        <div className="text-xs font-bold uppercase tracking-wide text-emerald-800">Change due</div>
                        <div className="text-xl font-extrabold tabular-nums text-emerald-900">
                          {formatMoney(Number(cashGiven) - Number(layawayDeposit), currencyCode)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Split Payment Mode */}
        {paymentMode === "split" && (
          <div className="space-y-3 sm:space-y-4">
            <p className="rounded-xl border border-slate-200/90 bg-slate-50/90 px-3 py-2.5 text-sm font-medium leading-snug text-slate-700">
              Add lines that sum to the <span className="font-extrabold text-slate-900">amount due</span>.{" "}
              <span className="font-extrabold text-slate-900">Fill balance</span> drops what&apos;s left on a line.
            </p>
            {retailMtnSandboxMomoActive && !isOffline ? (
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-sm font-medium text-amber-950">
                Mobile Money works only as a full payment in this build.
              </div>
            ) : null}
            <div className="space-y-2">
              {splitPayments.map((payment, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={payment.method}
                      onChange={(e) =>
                        handleUpdateSplitPayment(
                          index,
                          "method",
                          e.target.value
                        )
                      }
                      className={`${retailSelectClass} min-h-[44px] min-w-[8rem] flex-1`}
                      disabled={hasNoAllowedMethods}
                    >
                      {availableMethods.map((method) => (
                        <option key={method.value} value={method.value}>
                          {method.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={payment.amount === 0 ? "" : payment.amount}
                      onChange={(e) =>
                        handleUpdateSplitPayment(
                          index,
                          "amount",
                          e.target.value
                        )
                      }
                      placeholder="0.00"
                      className={retailAmountCellClass}
                    />
                    <button
                      type="button"
                      onClick={() => fillSplitRowWithRemainder(index)}
                      className="min-h-[44px] whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] font-extrabold text-blue-900 shadow-sm transition hover:bg-blue-100"
                    >
                      Fill balance
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveSplitLine(index)}
                      disabled={splitPayments.length <= 1}
                      className="min-h-[44px] rounded-lg px-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddSplitLine}
              className="text-sm font-extrabold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
            >
              + Add line
            </button>

            {hasCash() ? (
              Math.abs(splitRemaining) < 0.01 ? (
                splitCashLineAmountOnly ? (
                  <div className="space-y-2 rounded-xl border border-slate-200/90 bg-slate-50/90 p-3">
                    <p className="text-sm font-medium leading-snug text-slate-700">
                      Cash tender matches your <span className="font-extrabold text-slate-900">cash lines</span> (
                      {formatMoney(splitCashPortion, currencyCode)}). You do not need to re-enter that amount.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSplitCashLineAmountOnly(false)
                        const n = splitCashPortion
                        setCashGiven(
                          n <= 0 ? "" : Number.isInteger(n) ? String(n) : n.toFixed(2),
                        )
                      }}
                      className="text-left text-sm font-extrabold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
                    >
                      Customer paid extra cash? Enter tender for change
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-xl border border-slate-200/90 bg-slate-50/90 p-3">
                    <button
                      type="button"
                      onClick={() => setSplitCashLineAmountOnly(true)}
                      className="text-left text-sm font-extrabold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
                    >
                      Use only the cash amount on the lines above
                    </button>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Cash tendered (for change) <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={cashGiven}
                      onChange={(e) => {
                        setCashGiven(e.target.value)
                        setError("")
                      }}
                      placeholder="0.00"
                      className={retailTextInputClass}
                    />
                    {totals.change > 0 && (
                      <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/90 p-3">
                        <div className="text-xs font-bold uppercase tracking-wide text-emerald-800">Change due</div>
                        <div className="text-xl font-extrabold tabular-nums text-emerald-900">
                          {formatMoney(totals.change, currencyCode)}
                        </div>
                      </div>
                    )}
                    {Number(cashGiven) > 0 && Number(cashGiven) < totals.cashPaid && (
                      <div className="text-sm font-medium text-red-700">
                        Cash tender must be at least the cash lines ({formatMoney(totals.cashPaid, currencyCode)}).
                      </div>
                    )}
                  </div>
                )
              ) : splitCashLineAmountOnly ? (
                <p className="rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-900/5">
                  When entered lines match the total, cash lines set cash tender automatically—no second cash entry unless you choose extra tender above.
                </p>
              ) : (
                <div className="space-y-2 rounded-xl border border-slate-200/90 bg-slate-50/90 p-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Cash tendered (for change) <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cashGiven}
                    onChange={(e) => {
                      setCashGiven(e.target.value)
                      setError("")
                    }}
                    placeholder="0.00"
                    className={retailTextInputClass}
                  />
                  {totals.change > 0 && (
                    <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/90 p-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-emerald-800">Change due</div>
                      <div className="text-xl font-extrabold tabular-nums text-emerald-900">
                        {formatMoney(totals.change, currencyCode)}
                      </div>
                    </div>
                  )}
                  {Number(cashGiven) > 0 && Number(cashGiven) < totals.cashPaid && (
                    <div className="text-sm font-medium text-red-700">
                      Cash tender must be at least the cash lines ({formatMoney(totals.cashPaid, currencyCode)}).
                    </div>
                  )}
                </div>
              )
            ) : null}

            <div className="space-y-1.5 rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-900/5">
              <div className="flex justify-between text-sm font-medium text-slate-600">
                <span>Entered</span>
                <span className="font-extrabold tabular-nums text-slate-900">{formatMoney(splitTotal, currencyCode)}</span>
              </div>
              <div className="flex justify-between text-sm font-medium text-slate-600">
                <span>Left to assign</span>
                <span
                  className={`font-extrabold tabular-nums ${
                    Math.abs(splitRemaining) < 0.01 ? "text-emerald-700" : "text-red-700"
                  }`}
                >
                  {formatMoney(splitRemaining, currencyCode)}
                </span>
              </div>
            </div>
          </div>
        )}

        </div>

        <footer className="shrink-0 border-t border-slate-200/90 bg-white/95 px-4 py-3 pb-[max(0.65rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:px-5">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-stretch sm:gap-3">
            <button
              type="button"
              onClick={() => void handleCancelClick()}
              disabled={momoPhase === "finalizing" || saleProcessing}
              className="min-h-[48px] flex-1 touch-manipulation rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-800 shadow-sm transition hover:bg-slate-50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            {showMomoSandboxFlow ? (
              <button
                type="button"
                onClick={() => void sendMomoPrompt()}
                disabled={
                  !isValid() ||
                  hasNoAllowedMethods ||
                  momoBusy ||
                  saleProcessing ||
                  totalPayable <= 0
                }
                className="min-h-[48px] flex-1 touch-manipulation rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white shadow-md shadow-emerald-900/15 ring-1 ring-emerald-500/25 transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:ring-0"
              >
                {momoPhase === "sending"
                  ? "Sending…"
                  : momoPhase === "pending"
                    ? "Waiting for approval…"
                    : momoPhase === "finalizing" || saleProcessing
                      ? "Completing sale…"
                      : "Send to phone"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleComplete}
                disabled={!isValid() || hasNoAllowedMethods || saleProcessing || momoBusy}
                className="min-h-[48px] flex-1 touch-manipulation rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white shadow-md shadow-emerald-900/15 ring-1 ring-emerald-500/25 transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:ring-0"
              >
                Complete sale
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

