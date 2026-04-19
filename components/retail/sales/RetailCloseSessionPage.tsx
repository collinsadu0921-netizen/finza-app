"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { calculateExpectedCash } from "@/lib/db/actions/register"
import RetailSupervisorOverrideModal from "@/components/retail/register/RetailSupervisorOverrideModal"
import { getTerminalRegisterId } from "@/lib/retail/terminalRegisterBinding"
import { getActiveStoreId } from "@/lib/storeSession"
import { useRouteGuard } from "@/lib/useRouteGuard"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { getAllOpenRegisterSessions, type OpenRegisterSession } from "@/lib/registerStatus"
import { retailPaths } from "@/lib/retail/routes"

type Session = {
  id: string
  register_id: string
  opening_float: number
  started_at: string
  user_id?: string
  registers?: {
    name: string
  } | null
}

function registerDisplayName(s: Session): string {
  const n = s.registers?.name?.trim()
  if (n) return n
  if (s.register_id?.length) {
    const short = s.register_id.replace(/-/g, "").slice(0, 8).toUpperCase()
    return `Register (${short}…)`
  }
  return "Unknown"
}

export default function RetailCloseSessionPage() {
  const router = useRouter()
  useRouteGuard()

  const [session, setSession] = useState<Session | null>(null)
  const [openSessions, setOpenSessions] = useState<OpenRegisterSession[]>([])
  const [countedCash, setCountedCash] = useState("")
  const [expectedCash, setExpectedCash] = useState(0)
  const [variance, setVariance] = useState(0)
  const { format, currencyCode } = useBusinessCurrency()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [showOverrideModal, setShowOverrideModal] = useState(false)
  const [goodsSoldSessionTotal, setGoodsSoldSessionTotal] = useState<number | null>(null)
  const [hydratingSession, setHydratingSession] = useState(false)

  useEffect(() => {
    loadSession()
  }, [])

  useEffect(() => {
    if (countedCash && expectedCash !== null) {
      const counted = Number(countedCash) || 0
      setVariance(counted - expectedCash)
    }
  }, [countedCash, expectedCash])

  const hydrateSessionFromRow = useCallback(async (row: OpenRegisterSession) => {
    setHydratingSession(true)
    setError("")
    setCountedCash("")
    setVariance(0)
    setShowOverrideModal(false)

    let registers: { name: string } | null =
      row.registers?.name?.trim() ? { name: row.registers.name.trim() } : null

    if (!registers?.name && row.register_id) {
      const { data: regRow } = await supabase
        .from("registers")
        .select("name")
        .eq("id", row.register_id)
        .maybeSingle()
      const rn = regRow?.name != null ? String(regRow.name).trim() : ""
      if (rn) registers = { name: rn }
    }

    const openingFloat = Number(
      row.opening_float !== undefined && row.opening_float !== null ? row.opening_float : 0
    )

    setSession({
      id: row.id,
      register_id: row.register_id,
      opening_float: openingFloat,
      started_at: row.started_at,
      user_id: row.user_id,
      registers,
    })

    const { data: sessionSales, error: sessionSalesErr } = await supabase
      .from("sales")
      .select("amount")
      .eq("cashier_session_id", row.id)
      .eq("payment_status", "paid")

    if (sessionSalesErr) {
      console.error("Session goods sold query:", sessionSalesErr)
      setGoodsSoldSessionTotal(null)
    } else {
      const goodsTotal =
        sessionSales?.reduce((sum, r) => sum + Number((r as { amount?: unknown }).amount || 0), 0) ?? 0
      setGoodsSoldSessionTotal(goodsTotal)
    }

    const expected = await calculateExpectedCash(supabase, row.id)
    if (isNaN(expected) || !isFinite(expected)) {
      setError("Failed to calculate expected cash. Please check your sales data.")
      setExpectedCash(0)
    } else {
      setExpectedCash(expected)
    }
    setHydratingSession(false)
  }, [])

  const loadSession = async () => {
    try {
      setLoading(true)
      setError("")
      setSession(null)
      setOpenSessions([])
      setGoodsSoldSessionTotal(null)
      setCountedCash("")
      setExpectedCash(0)

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setLoading(false)
        return
      }

      const activeStoreId = getActiveStoreId()

      if (!activeStoreId || activeStoreId === "all") {
        setError(
          "Please select a store before closing a session. Go to Stores page and click 'Open Store'."
        )
        setLoading(false)
        return
      }

      const { getUserRole } = await import("@/lib/userRoles")
      const { getCurrentBusiness } = await import("@/lib/business")
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found.")
        setLoading(false)
        return
      }

      const role = await getUserRole(supabase, user.id, business.id)
      if (role === "cashier") {
        setError("Cashiers cannot close registers. Please contact a manager or admin.")
        setLoading(false)
        router.push(retailPaths.pos)
        return
      }

      if (role !== "admin" && role !== "manager" && role !== "owner") {
        setError("Only managers and admins can close registers.")
        setLoading(false)
        router.push(retailPaths.dashboard)
        return
      }

      const sessions = await getAllOpenRegisterSessions(supabase, business.id, activeStoreId)

      if (!sessions || sessions.length === 0) {
        setError("No open register sessions found. Please open a register session first.")
        setLoading(false)
        return
      }

      setOpenSessions(sessions)

      const boundRegisterId = getTerminalRegisterId(business.id, activeStoreId)
      const boundMatch = boundRegisterId ? sessions.find((s) => s.register_id === boundRegisterId) : null

      if (boundMatch) {
        await hydrateSessionFromRow(boundMatch)
      } else if (sessions.length === 1) {
        await hydrateSessionFromRow(sessions[0])
      } else {
        setSession(null)
        setGoodsSoldSessionTotal(null)
        setExpectedCash(0)
      }

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load session")
      setLoading(false)
    }
  }

  const handlePickSession = async (row: OpenRegisterSession) => {
    await hydrateSessionFromRow(row)
  }

  const handleCloseSession = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")
    setSubmitting(true)

    try {
      if (!session) {
        setError("Session not found")
        setSubmitting(false)
        return
      }

      const counted = Number(countedCash)
      if (isNaN(counted) || counted < 0) {
        setError("Counted cash must be a valid number >= 0")
        setSubmitting(false)
        return
      }

      const varianceAmount = counted - expectedCash

      if (Math.abs(varianceAmount) > 0.01) {
        setShowOverrideModal(true)
        setSubmitting(false)
        return
      }

      await closeSession(counted, varianceAmount)
    } catch (err: any) {
      setError(err.message || "Failed to close session")
      setSubmitting(false)
    }
  }

  const closeSession = async (counted: number, varianceAmount: number) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user || !session) return

      const response = await fetch("/api/register/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          register_id: session.register_id,
          session_id: session.id,
          counted_cash: counted,
          expected_cash: expectedCash,
          variance_amount: varianceAmount,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to close session")
      }

      setSuccess("Register session closed successfully!")
      setTimeout(() => {
        router.push(retailPaths.dashboard)
      }, 1500)
    } catch (err: any) {
      setError(err.message || "Failed to close session")
      setSubmitting(false)
    }
  }

  const handleOverrideSuccess = async () => {
    if (!session) return

    const counted = Number(countedCash)
    const varianceAmount = counted - expectedCash

    await closeSession(counted, varianceAmount)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-rose-600" aria-hidden />
        <p className="mt-4 text-sm font-semibold text-slate-600">Loading session…</p>
      </div>
    )
  }

  if (error && openSessions.length === 0 && !session) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-white px-4 py-10">
        <div className="mx-auto max-w-lg">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">Shift end</p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">Close register</h1>
            </div>
            <button
              type="button"
              onClick={() => router.push(retailPaths.dashboard)}
              className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Dashboard
            </button>
          </div>
          <div
            role="alert"
            className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          >
            {error}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
            <p className="text-sm font-medium text-slate-600">Open a register session first, then return here to close out.</p>
            <button
              type="button"
              onClick={() => router.push(retailPaths.salesOpenSession)}
              className="mt-6 min-h-[48px] w-full rounded-xl bg-blue-600 py-3 text-sm font-extrabold text-white shadow-md hover:bg-blue-700"
            >
              Open register session
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (openSessions.length > 1 && !session && !hydratingSession) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-white px-4 py-10">
        <div className="mx-auto max-w-lg">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">Shift end</p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">Which till?</h1>
              <p className="mt-2 text-sm text-slate-600">Pick the open register you are closing for this store.</p>
            </div>
            <button
              type="button"
              onClick={() => router.push(retailPaths.dashboard)}
              className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Dashboard
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
            >
              {error}
            </div>
          )}

          <ul className="space-y-2">
            {openSessions.map((s) => {
              const regName = s.registers?.name?.trim() || "Register"
              const storeName = s.stores?.name?.trim()
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => void handlePickSession(s)}
                    className="w-full touch-manipulation rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-blue-500 hover:shadow-md"
                  >
                    <div className="text-base font-extrabold text-slate-900">
                      {regName}
                      {storeName ? <span className="font-semibold text-slate-500"> · {storeName}</span> : null}
                    </div>
                    <div className="mt-1 text-xs font-medium tabular-nums text-slate-500">
                      Opened {new Date(s.started_at).toLocaleString()}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    )
  }

  if (hydratingSession) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" aria-hidden />
        <p className="mt-3 text-sm font-semibold text-slate-600">Preparing close-out…</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
          <h1 className="text-xl font-extrabold text-slate-900">No session selected</h1>
          <p className="mt-2 text-sm text-slate-600">Go back and choose an open register.</p>
          <button
            type="button"
            onClick={() => router.push(retailPaths.dashboard)}
            className="mt-6 min-h-[44px] w-full rounded-xl bg-slate-800 py-3 text-sm font-bold text-white hover:bg-slate-900"
          >
            Retail dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-white px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">Shift end</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">Close register</h1>
            <p className="mt-2 text-sm font-medium text-slate-600">Count cash, review variance, then close.</p>
          </div>
          <button
            type="button"
            onClick={() => router.push(retailPaths.dashboard)}
            className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Dashboard
          </button>
        </div>

        {openSessions.length > 1 && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => {
                setSession(null)
                setCountedCash("")
                setGoodsSoldSessionTotal(null)
                setExpectedCash(0)
                setError("")
              }}
              className="text-sm font-bold text-blue-700 underline decoration-blue-200 underline-offset-4 hover:text-blue-900"
            >
              ← Choose a different open register
            </button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          >
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
            {success}
          </div>
        )}

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-md">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Session snapshot</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
              <dt className="font-medium text-slate-500">Register</dt>
              <dd className="text-right font-extrabold text-slate-900">{registerDisplayName(session)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
              <dt className="font-medium text-slate-500">Opening float</dt>
              <dd className="font-bold tabular-nums text-slate-900">{format(session.opening_float)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
              <dt className="font-medium text-slate-500">Started</dt>
              <dd className="text-right text-xs font-semibold text-slate-700">
                {new Date(session.started_at).toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-slate-500">Goods sold (session)</dt>
              <dd className="font-bold tabular-nums text-slate-900">
                {goodsSoldSessionTotal === null ? "—" : format(goodsSoldSessionTotal)}
              </dd>
            </div>
          </dl>
        </div>

        <form onSubmit={handleCloseSession} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Expected cash</label>
              <div className="min-h-[52px] w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-xl font-extrabold tabular-nums text-slate-900">
                {format(expectedCash)}
              </div>
              <p className="mt-2 text-xs font-medium leading-relaxed text-slate-500">
                Opening float + cash sales − drops − change (system calculation).
              </p>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Counted cash in drawer <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                className="min-h-[52px] w-full touch-manipulation rounded-xl border-2 border-slate-200 bg-white px-4 text-lg font-extrabold tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-500/15"
                placeholder="0.00"
                required
                disabled={submitting}
                autoFocus
              />
            </div>

            {countedCash ? (
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Variance</label>
                <div
                  className={`min-h-[52px] w-full rounded-xl border-2 px-4 py-3 text-xl font-extrabold tabular-nums ${
                    Math.abs(variance) < 0.01
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : variance > 0
                        ? "border-amber-200 bg-amber-50 text-amber-950"
                        : "border-red-200 bg-red-50 text-red-900"
                  }`}
                >
                  {variance > 0 ? "+" : ""}
                  {format(variance)}
                </div>
                {Math.abs(variance) > 0.01 && (
                  <p className="mt-2 text-xs font-semibold text-red-700">Supervisor approval required when variance is not zero.</p>
                )}
              </div>
            ) : null}

            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
              <button
                type="button"
                onClick={() => router.push(retailPaths.dashboard)}
                className="min-h-[48px] flex-1 touch-manipulation rounded-xl border border-slate-200 bg-slate-50 py-3 text-sm font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[48px] flex-1 touch-manipulation rounded-xl bg-rose-600 py-3 text-sm font-extrabold text-white shadow-lg hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none"
                disabled={submitting || !countedCash}
              >
                {submitting ? "Closing…" : "Close session"}
              </button>
            </div>
          </div>
        </form>

      <RetailSupervisorOverrideModal
        isOpen={showOverrideModal}
        onClose={() => {
          setShowOverrideModal(false)
          setSubmitting(false)
        }}
        onSuccess={handleOverrideSuccess}
        registerId={session.register_id}
        sessionId={session.id}
        cashierId={session.user_id || ""}
        varianceAmount={variance}
        expectedCash={expectedCash}
        countedCash={Number(countedCash) || 0}
        currencyCode={currencyCode ?? "GHS"}
      />
      </div>
    </div>
  )
}
