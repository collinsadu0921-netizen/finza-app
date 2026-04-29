"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export default function MockSubscriptionCheckoutPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const checkoutSessionId = searchParams.get("checkout")?.trim() || ""
  const businessId = searchParams.get("business_id")?.trim() || ""
  const tier = searchParams.get("tier")?.trim() || ""
  const cycle = searchParams.get("cycle")?.trim() || ""

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const simulate = async (outcome: "success" | "failure" | "cancelled" | "expired") => {
    if (!checkoutSessionId || !businessId) return
    setBusy(true)
    setError("")
    try {
      const simRes = await fetch("/api/subscription/mock/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkout_session_id: checkoutSessionId,
          business_id: businessId,
          outcome,
        }),
      })
      const sim = await simRes.json()
      if (!simRes.ok) throw new Error(sim.error || "Simulation failed")

      const verifyRes = await fetch(
        `/api/subscription/verify?checkout_session_id=${encodeURIComponent(checkoutSessionId)}&business_id=${encodeURIComponent(businessId)}`,
        { cache: "no-store" }
      )
      const verify = await verifyRes.json()
      if (!verifyRes.ok) throw new Error(verify.error || "Verification failed")

      router.replace(
        `/service/settings/subscription?business_id=${encodeURIComponent(businessId)}&mock_result=${encodeURIComponent(verify.status || sim.status || outcome)}`
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Mock checkout failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-xl px-4 py-10">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Mock subscription checkout</h1>
          <p className="mt-1 text-sm text-slate-500">
            Simulation only. No real Hubtel or Paystack transaction is performed.
          </p>

          <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p>
              <span className="font-medium text-slate-700">Session:</span> {checkoutSessionId || "—"}
            </p>
            <p>
              <span className="font-medium text-slate-700">Plan:</span> {tier || "—"}
            </p>
            <p>
              <span className="font-medium text-slate-700">Cycle:</span> {cycle || "—"}
            </p>
          </div>

          {error ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy || !checkoutSessionId || !businessId}
              onClick={() => void simulate("success")}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Simulate success
            </button>
            <button
              type="button"
              disabled={busy || !checkoutSessionId || !businessId}
              onClick={() => void simulate("failure")}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Simulate failure
            </button>
            <button
              type="button"
              disabled={busy || !checkoutSessionId || !businessId}
              onClick={() => void simulate("cancelled")}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Simulate cancelled
            </button>
            <button
              type="button"
              disabled={busy || !checkoutSessionId || !businessId}
              onClick={() => void simulate("expired")}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Simulate expired
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

