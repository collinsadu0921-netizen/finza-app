"use client"

import { useEffect, useRef, useState } from "react"
import { createPayrollPaymentIdempotencyKey } from "@/lib/payroll/createPayrollPaymentIdempotencyKey"

type Preview = {
  eligible: boolean
  code: string
  message: string
  employee: { id: string; name: string | null }
  payroll: { run_id: string; payroll_month: string | null; batch_id: string; item_id: string }
  amount: { ghs: number; pesewas: number; currency: string }
  destination: {
    method_type: "bank" | "momo"
    label: string
    bank_name: string | null
    account_number: string | null
    momo_provider: string | null
    momo_number: string | null
    account_name: string
  } | null
  connection: { connected: boolean; environment: "test" | "live" | null }
  balance: { ghs: number; pesewas: number | null; error: string | null }
  fees: { note: string }
  active_transfer: { id: string; status: string; reference: string } | null
}

type TransferState = {
  transfer_id: string
  reference: string
  status: string
  message: string
  otp_required?: boolean
}

function money(value: number): string {
  return `GHS ${Number(value || 0).toFixed(2)}`
}

function statusTone(status: string): string {
  switch (status) {
    case "successful":
      return "bg-emerald-100 text-emerald-800"
    case "failed":
      return "bg-red-100 text-red-800"
    case "reversed":
      return "bg-rose-100 text-rose-800"
    case "requires_attention":
      return "bg-amber-100 text-amber-800"
    default:
      return "bg-blue-100 text-blue-800"
  }
}

export default function PaystackSalaryPaymentModal({
  runId,
  batchId,
  itemId,
  employeeName,
  amount,
  onClose,
  onCompleted,
  onStatusChange,
}: {
  runId: string
  batchId: string
  itemId: string
  employeeName: string | null
  amount: number
  onClose: () => void
  onCompleted: () => void
  onStatusChange?: (status: string) => void
}) {
  const base = `/api/payroll/runs/${runId}/payment-batches/${batchId}/items/${itemId}`
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [transfer, setTransfer] = useState<TransferState | null>(null)
  const [otp, setOtp] = useState("")
  const [verifying, setVerifying] = useState(false)
  const idempotencyKeyRef = useRef<string | null>(null)
  const transferRef = useRef<TransferState | null>(null)
  const completedRef = useRef(false)
  const pollAttemptsRef = useRef(0)

  transferRef.current = transfer

  const notifyCompleted = () => {
    if (completedRef.current) return
    completedRef.current = true
    onCompleted()
  }

  const notifyStatusChange = (nextStatus: string) => {
    onStatusChange?.(nextStatus)
  }

  const loadPreview = async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${base}/paystack-preview`, { cache: "no-store" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || "Could not check Paystack eligibility.")
        setPreview(null)
        return
      }
      setPreview(body as Preview)
    } catch {
      setError("Could not check Paystack eligibility.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, batchId, itemId])

  // Poll the provider through the existing verify endpoint while the transfer
  // is still settling. This updates the modal and parent automatically and
  // never initiates another transfer.
  useEffect(() => {
    const transferId = transfer?.transfer_id
    if (!transferId) return
    const activeStatuses = new Set(["initiating", "pending", "awaiting_authorization", "requires_attention"])
    if (!activeStatuses.has(String(transfer?.status || ""))) return

    let cancelled = false
    pollAttemptsRef.current = 0

    const poll = async () => {
      if (cancelled) return
      const current = transferRef.current
      if (!current || !activeStatuses.has(String(current.status))) return
      if (pollAttemptsRef.current >= 12) return
      pollAttemptsRef.current += 1
      try {
        const response = await fetch(`/api/payroll/paystack/transfers/${transferId}/verify`, {
          method: "POST",
        })
        const body = await response.json().catch(() => ({}))
        if (cancelled || !response.ok) return
        const nextStatus = String(body.status || "")
        if (!nextStatus) return
        setTransfer((value) =>
          value
            ? { ...value, status: nextStatus, message: String(body.message || value.message) }
            : value
        )
        notifyStatusChange(nextStatus)
        if (nextStatus === "successful" || nextStatus === "reversed") notifyCompleted()
      } catch {
        // Transient failures are retried by the next poll.
      }
    }

    const timer = window.setInterval(poll, 5000)
    const first = window.setTimeout(poll, 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.clearTimeout(first)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfer?.transfer_id])

  const pay = async () => {
    if (!confirmed || submitting) return
    setSubmitting(true)
    setError("")
    try {
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = createPayrollPaymentIdempotencyKey("payroll-batch-item")
      }
      const response = await fetch(`${base}/paystack-pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeyRef.current,
        },
        body: JSON.stringify({ confirm: true, idempotency_key: idempotencyKeyRef.current }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok && response.status !== 202) {
        setError(body.error || "Paystack could not initiate this salary transfer.")
        if (body.status === "failed") {
          idempotencyKeyRef.current = null
        }
        if (body.transfer_id) {
          setTransfer({
            transfer_id: String(body.transfer_id),
            reference: String(body.reference || ""),
            status: String(body.status || "requires_attention"),
            message: String(body.error || body.message || ""),
            otp_required: Boolean(body.otp_required),
          })
          notifyStatusChange(String(body.status || "requires_attention"))
        }
        return
      }
      setTransfer({
        transfer_id: String(body.transfer_id),
        reference: String(body.reference || ""),
        status: String(body.status || "pending"),
        message: String(body.message || ""),
        otp_required: Boolean(body.otp_required),
      })
      notifyStatusChange(String(body.status || "pending"))
      if (body.status === "failed") {
        idempotencyKeyRef.current = null
      }
      if (body.status === "successful") {
        notifyCompleted()
      }
    } catch {
      setError("The transfer outcome is uncertain. Verify the transfer status before retrying.")
    } finally {
      setSubmitting(false)
    }
  }

  const submitOtp = async () => {
    if (!transfer || submitting) return
    setSubmitting(true)
    setError("")
    try {
      const response = await fetch(`/api/payroll/paystack/transfers/${transfer.transfer_id}/otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || "Paystack did not accept this OTP.")
        return
      }
      setTransfer((current) =>
        current
          ? { ...current, status: String(body.status), message: String(body.message || "") }
          : current
      )
      notifyStatusChange(String(body.status))
      setOtp("")
      if (body.status === "successful") notifyCompleted()
    } catch {
      setError("Could not submit the Paystack OTP. Verify the transfer before retrying.")
    } finally {
      setSubmitting(false)
    }
  }

  const verify = async () => {
    if (!transfer || verifying) return
    setVerifying(true)
    setError("")
    try {
      const response = await fetch(`/api/payroll/paystack/transfers/${transfer.transfer_id}/verify`, {
        method: "POST",
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || "Could not verify this Paystack transfer.")
        return
      }
      setTransfer((current) =>
        current
          ? { ...current, status: String(body.status), message: String(body.message || "") }
          : current
      )
      notifyStatusChange(String(body.status))
      if (body.status === "successful" || body.status === "reversed") notifyCompleted()
    } catch {
      setError("Could not verify this Paystack transfer.")
    } finally {
      setVerifying(false)
    }
  }

  const busy = loading || submitting || verifying
  const status = transfer?.status ?? null
  const canRetryVisibly = status === "failed"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Pay with Paystack</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {employeeName || "Employee"}  -  {money(amount)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
            aria-label="Close"
          >
            x
          </button>
        </div>

        {loading ? <p className="mt-5 text-sm text-gray-500">Checking eligibility with Paystack...</p> : null}

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {!loading && preview ? (
          <div className="mt-5 space-y-4">
            {!preview.eligible && !transfer ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {preview.message}
                {preview.active_transfer ? (
                  <button type="button" onClick={verify} className="mt-2 block text-xs font-semibold underline">
                    Verify existing transfer
                  </button>
                ) : null}
              </div>
            ) : null}

            {preview.eligible ? (
              <>
                <div className="rounded-lg border border-gray-200 p-4 text-sm dark:border-gray-700">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-500 dark:text-gray-400">Salary</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{money(preview.amount.ghs)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-gray-500 dark:text-gray-400">Destination</span>
                    <span className="text-right text-gray-800 dark:text-gray-200">{preview.destination?.label}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-gray-500 dark:text-gray-400">Account name</span>
                    <span className="text-right text-gray-800 dark:text-gray-200">
                      {preview.destination?.account_name}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-gray-500 dark:text-gray-400">Paystack balance</span>
                    <span className="text-right text-gray-800 dark:text-gray-200">
                      {money(preview.balance.ghs)}  -  {preview.connection.environment === "live" ? "Live" : "Test"}
                    </span>
                  </div>
                </div>

                <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
                  {preview.fees.note}
                </p>

                <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I confirm this salary transfer to the destination shown. Paystack transfers are final unless the
                    provider reverses them.
                  </span>
                </label>

                <button
                  type="button"
                  onClick={pay}
                  disabled={!confirmed || busy}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting ? "Contacting Paystack..." : `Pay ${money(preview.amount.ghs)} with Paystack`}
                </button>
              </>
            ) : null}

            {transfer ? (
              <div className="rounded-lg border border-gray-200 p-4 text-sm dark:border-gray-700">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500 dark:text-gray-400">Transfer status</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusTone(transfer.status)}`}>
                    {transfer.status.replace(/_/g, " ")}
                  </span>
                </div>
                {transfer.reference ? (
                  <p className="mt-2 break-all text-xs text-gray-500 dark:text-gray-400">
                    Reference: {transfer.reference}
                  </p>
                ) : null}
                {transfer.message ? (
                  <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">{transfer.message}</p>
                ) : null}
                {transfer.otp_required || transfer.status === "awaiting_authorization" ? (
                  <div className="mt-3 space-y-2">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                      Paystack OTP
                    </label>
                    <input
                      inputMode="numeric"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      placeholder="Enter the OTP sent by Paystack"
                    />
                    <button
                      type="button"
                      onClick={submitOtp}
                      disabled={otp.length < 4 || busy}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {submitting ? "Authorizing..." : "Authorize transfer"}
                    </button>
                  </div>
                ) : null}
                {status !== "successful" && status !== "reversed" ? (
                  <button
                    type="button"
                    onClick={verify}
                    disabled={busy}
                    className="mt-3 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    {verifying ? "Verifying..." : "Verify transfer status"}
                  </button>
                ) : null}
                {canRetryVisibly ? (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    This transfer failed safely. Close this dialog and try again only after checking the employee
                    destination and Paystack balance.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

