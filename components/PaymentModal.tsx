"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { formatMoney } from "@/lib/money"
import { normalizeCountry, getAllowedMethods, getMobileMoneyLabel } from "@/lib/payments/eligibility"

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
}

interface PaymentModalProps {
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
}: PaymentModalProps) {
  const [paymentMode, setPaymentMode] = useState<"single" | "split" | "layaway">("single")
  const [singleMethod, setSingleMethod] = useState<"cash" | "momo" | "card">("cash")
  const [splitPayments, setSplitPayments] = useState<PaymentLine[]>([
    { method: "cash", amount: 0 },
  ])
  const [cashGiven, setCashGiven] = useState("")
  const [error, setError] = useState("")
  const [currency, setCurrency] = useState<string>(currencyCode || "")
  const [foreignAmount, setForeignAmount] = useState("")
  const [exchangeRate, setExchangeRate] = useState("")
  // Layaway fields (Phase 2)
  const [layawayDeposit, setLayawayDeposit] = useState("")
  const [layawayPaymentMethod, setLayawayPaymentMethod] = useState<"cash" | "momo" | "card">("cash")

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

  // Reset when modal opens/closes
  useEffect(() => {
    if (isOpen) {
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
    }
  }, [isOpen, currencyCode, canUseCash, availableMethods])

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
        const cashGivenNum = Number(cashGiven) || 0
        const change = totalPaid - totalPayable
        return {
          totalPaid,
          cashPaid,
          cashGiven: cashGivenNum,
          change: change >= 0 ? change : 0,
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
        return true // Non-cash single payment is always valid
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

      // If cash is involved, validate cash given
      if (hasCash()) {
        const cashGivenNum = Number(cashGiven)
        if (isNaN(cashGivenNum) || cashGivenNum < 0) return false
        
        const cashPaid = splitPayments
          .filter((p) => p.method === "cash")
          .reduce((sum, p) => sum + Number(p.amount || 0), 0)
        
        // Cash given must be >= cash portion required
        if (cashGivenNum < cashPaid) return false
        
        // Change calculation must be valid
        const change = total - totalPayable
        if (isNaN(change)) return false
        // Change can only come from cash, so if change > 0, cashGiven must cover it
        if (change > 0 && cashGivenNum < totalPayable) return false
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

  const handleComplete = () => {
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
          const cashGivenNum = Number(cashGiven)
          const cashPaid = splitPayments
            .filter((p) => p.method === "cash")
            .reduce((sum, p) => sum + Number(p.amount || 0), 0)
          if (cashGivenNum < cashPaid) {
            setError(`Cash given (${formatMoney(cashGivenNum, currencyCode)}) must be at least the cash portion (${formatMoney(cashPaid, currencyCode)})`)
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
        const cashGivenNum = Number(cashGiven)
        // Only calculate change from cash payments, not foreign currency
        const cashPaid = normalizedPayments
          .filter((p) => p.method === "cash")
          .reduce((sum, p) => sum + p.amount, 0)
        result.cash_received = cashGivenNum
        // Change = cash given - cash portion paid (not total paid)
        result.change_given = Math.max(0, cashGivenNum - cashPaid)
      }
    }

    onComplete(result)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4">Payment</h2>

        {/* Phase 4: Offline mode banner */}
        {isOffline && (
          <div className="bg-yellow-50 border-2 border-yellow-300 text-yellow-800 px-4 py-3 rounded mb-4">
            <p className="font-semibold mb-2">⚠️ OFFLINE MODE</p>
            <p className="text-sm mb-2">
              You are currently offline. Only cash and card (with offline auth) are available.
              This transaction will be synced when connection is restored.
            </p>
          </div>
        )}

        {/* Blocking banner if no methods allowed */}
        {hasNoAllowedMethods && (
          <div className="bg-red-50 border-2 border-red-300 text-red-800 px-4 py-3 rounded mb-4">
            <p className="font-semibold mb-2">No payment methods available</p>
            <p className="text-sm mb-2">
              Please set your business country in <a href="/settings/business-profile" className="underline font-semibold">Business Profile</a> to enable payment methods.
            </p>
          </div>
        )}

        <div className="mb-4">
          <div className="text-lg font-semibold mb-2">
            Total Payable: {formatMoney(totalPayable, currencyCode)}
          </div>
        </div>

        {/* Currency Selector - DISABLED: Foreign currency not fully supported end-to-end */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Currency</label>
          <select
            value={currency}
            onChange={(e) => {
              const newCurrency = e.target.value
              // Prevent switching to foreign currency - FX not fully supported
              if (newCurrency !== currencyCode) {
                setError("Foreign currency payments are not currently supported. Exchange rate capture, ledger posting, and reporting for foreign currency are not fully implemented. Please use the base business currency only.")
                return
              }
              setCurrency(newCurrency)
              setForeignAmount("")
              setExchangeRate("")
              setError("")
            }}
            className="border rounded px-3 py-2 w-full"
            disabled={!currencyCode} // Disable if no currency code provided
          >
            {currencyCode && <option value={currencyCode}>{currencyCode}</option>}
            {/* Foreign currency options removed - not fully supported end-to-end */}
          </select>
          {currency !== currencyCode && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mt-2 text-sm">
              Foreign currency payments are not currently supported. Exchange rate capture, ledger posting, and reporting for foreign currency are not fully implemented. Please use the base business currency only.
            </div>
          )}
        </div>

        {/* Exchange Rate Input - REMOVED: Foreign currency not supported */}

        {/* Payment Mode Selection */}
        <div className="mb-4">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setPaymentMode("single")}
              className={`px-4 py-2 rounded ${
                paymentMode === "single"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-700"
              }`}
            >
              Single Payment
            </button>
            <button
              onClick={() => setPaymentMode("split")}
              className={`px-4 py-2 rounded ${
                paymentMode === "split"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-700"
              }`}
            >
              Split Payment
            </button>
            <button
              onClick={() => setPaymentMode("layaway")}
              className={`px-4 py-2 rounded ${
                paymentMode === "layaway"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-700"
              }`}
              disabled={!selectedCustomer || selectedCustomer.status === "blocked" || isOffline}
              title={
                isOffline
                  ? "Layaway not available offline"
                  : !selectedCustomer
                  ? "Select a customer first"
                  : selectedCustomer.status === "blocked"
                  ? "Customer is blocked"
                  : ""
              }
            >
              Layaway / Pay Later
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Single Payment Mode */}
        {paymentMode === "single" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Payment Method</label>
              <div className={`grid gap-2 ${availableMethods.length === 1 ? "grid-cols-1" : availableMethods.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                {availableMethods.map((method) => (
                  <button
                    key={method.value}
                    onClick={() => setSingleMethod(method.value)}
                    className={`px-4 py-3 rounded font-semibold ${
                      singleMethod === method.value
                        ? method.value === "cash"
                          ? "bg-green-600 text-white"
                          : method.value === "momo"
                          ? "bg-blue-600 text-white"
                          : "bg-purple-600 text-white"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                    disabled={hasNoAllowedMethods}
                  >
                    {method.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-gray-50 p-4 rounded">
              <div className="text-sm text-gray-600">Amount:</div>
              <div className="text-xl font-bold">{formatMoney(totalPayable, currencyCode)}</div>
            </div>
            {singleMethod === "cash" && (
              <div className="space-y-2">
                <label className="block text-sm font-medium">
                  Cash Given <span className="text-red-600">*</span>
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
                  className="border rounded px-3 py-2 w-full text-lg"
                  autoFocus
                />
                {totals.change > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded p-3">
                    <div className="text-sm text-gray-600">Change Due:</div>
                    <div className="text-xl font-bold text-green-700">
                      {formatMoney(totals.change, currencyCode)}
                    </div>
                  </div>
                )}
                {Number(cashGiven) > 0 && Number(cashGiven) < totalPayable && (
                  <div className="text-sm text-red-600">
                    Cash given is less than total payable
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Layaway Payment Mode */}
        {paymentMode === "layaway" && (
          <div className="space-y-4">
            {!selectedCustomer ? (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
                Please select a customer first to create a layaway sale.
              </div>
            ) : selectedCustomer.status === "blocked" ? (
              <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
                Cannot create layaway for blocked customer: {selectedCustomer.name}
              </div>
            ) : (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded p-3">
                  <div className="text-sm text-gray-600">Customer:</div>
                  <div className="font-semibold">{selectedCustomer.name}</div>
                </div>
                <div className="bg-gray-50 p-4 rounded space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Total Amount:</span>
                    <span className="font-semibold">{formatMoney(totalPayable, currencyCode)}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Deposit Amount <span className="text-red-600">*</span>
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
                    className="border rounded px-3 py-2 w-full text-lg"
                    autoFocus
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    Minimum deposit: {formatMoney(totalPayable * 0.1, currencyCode)} (10%)
                  </div>
                </div>
                {Number(layawayDeposit) > 0 && (
                  <div className="bg-gray-50 p-4 rounded space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Deposit:</span>
                      <span className="font-semibold">{formatMoney(Number(layawayDeposit), currencyCode)}</span>
                    </div>
                    <div className="flex justify-between text-sm border-t pt-2">
                      <span className="text-gray-600">Outstanding:</span>
                      <span className="font-semibold text-orange-600">
                        {formatMoney(totalPayable - Number(layawayDeposit), currencyCode)}
                      </span>
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-2">Deposit Payment Method</label>
                  <div className={`grid gap-2 ${availableMethods.length === 1 ? "grid-cols-1" : availableMethods.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                    {availableMethods.map((method) => (
                      <button
                        key={method.value}
                        onClick={() => setLayawayPaymentMethod(method.value)}
                        className={`px-4 py-3 rounded font-semibold ${
                          layawayPaymentMethod === method.value
                            ? method.value === "cash"
                              ? "bg-green-600 text-white"
                              : method.value === "momo"
                              ? "bg-blue-600 text-white"
                              : "bg-purple-600 text-white"
                            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                        }`}
                        disabled={hasNoAllowedMethods}
                      >
                        {method.label}
                      </button>
                    ))}
                  </div>
                </div>
                {layawayPaymentMethod === "cash" && Number(layawayDeposit) > 0 && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      Cash Given <span className="text-red-600">*</span>
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
                      className="border rounded px-3 py-2 w-full text-lg"
                    />
                    {Number(cashGiven) >= Number(layawayDeposit) && (
                      <div className="bg-green-50 border border-green-200 rounded p-3">
                        <div className="text-sm text-gray-600">Change Due:</div>
                        <div className="text-xl font-bold text-green-700">
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
          <div className="space-y-4">
            <div className="space-y-3">
              {splitPayments.map((payment, index) => (
                <div key={index} className="border rounded p-3 bg-gray-50">
                  <div className="flex gap-2 items-center">
                    <select
                      value={payment.method}
                      onChange={(e) =>
                        handleUpdateSplitPayment(
                          index,
                          "method",
                          e.target.value
                        )
                      }
                      className="border rounded px-3 py-2 flex-1"
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
                      value={payment.amount || ""}
                      onChange={(e) =>
                        handleUpdateSplitPayment(
                          index,
                          "amount",
                          e.target.value
                        )
                      }
                      placeholder="0.00"
                      className="border rounded px-3 py-2 w-32"
                    />
                    <button
                      onClick={() => handleRemoveSplitLine(index)}
                      disabled={splitPayments.length <= 1}
                      className="text-red-600 hover:text-red-800 disabled:text-gray-400 disabled:cursor-not-allowed px-2"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleAddSplitLine}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              + Add Payment Method
            </button>

            {hasCash() && (
              <div className="space-y-2 border-t pt-3">
                <label className="block text-sm font-medium">
                  Cash Given <span className="text-red-600">*</span>
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
                  className="border rounded px-3 py-2 w-full text-lg"
                />
                {totals.change > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded p-3">
                    <div className="text-sm text-gray-600">Change Due:</div>
                    <div className="text-xl font-bold text-green-700">
                      {formatMoney(totals.change, currencyCode)}
                    </div>
                  </div>
                )}
                {Number(cashGiven) > 0 && Number(cashGiven) < totals.cashPaid && (
                  <div className="text-sm text-red-600">
                    Cash given ({formatMoney(Number(cashGiven), currencyCode)}) must be at least the cash portion ({formatMoney(totals.cashPaid, currencyCode)})
                  </div>
                )}
              </div>
            )}

            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span>Total Entered:</span>
                <span className="font-semibold">{formatMoney(splitTotal, currencyCode)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Remaining:</span>
                <span
                  className={`font-semibold ${
                    Math.abs(splitRemaining) < 0.01
                      ? "text-green-600"
                      : splitRemaining > 0
                      ? "text-red-600"
                      : "text-red-600"
                  }`}
                >
                  {formatMoney(splitRemaining, currencyCode)}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-4 mt-4 border-t">
          <button
            onClick={onClose}
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded flex-1 hover:bg-gray-400"
          >
            Cancel
          </button>
          <button
            onClick={handleComplete}
            disabled={!isValid() || hasNoAllowedMethods}
            className="bg-blue-600 text-white px-4 py-2 rounded flex-1 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            Complete Sale
          </button>
        </div>
      </div>
    </div>
  )
}

