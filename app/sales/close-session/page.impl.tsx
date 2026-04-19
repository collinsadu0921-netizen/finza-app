"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { calculateExpectedCash } from "@/lib/db/actions/register"
import SupervisorOverrideModal from "@/app/(dashboard)/pos/register/SupervisorOverrideModal"
import { getActiveStoreId } from "@/lib/storeSession"
import { useRouteGuard } from "@/lib/useRouteGuard"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { getAllOpenRegisterSessions, type OpenRegisterSession } from "@/lib/registerStatus"

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

export default function CloseSessionPage() {
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
        router.push("/pos")
        return
      }

      if (role !== "admin" && role !== "manager" && role !== "owner") {
        setError("Only managers and admins can close registers.")
        setLoading(false)
        router.push("/retail/dashboard")
        return
      }

      const sessions = await getAllOpenRegisterSessions(supabase, business.id, activeStoreId)

      if (!sessions || sessions.length === 0) {
        setError("No open register sessions found. Please open a register session first.")
        setLoading(false)
        return
      }

      setOpenSessions(sessions)

      if (sessions.length === 1) {
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
        router.push("/retail/dashboard")
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
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  if (error && openSessions.length === 0 && !session) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Close Register Session</h1>
          <button
            type="button"
            onClick={() => router.push("/retail/dashboard")}
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
          >
            Dashboard
          </button>
        </div>

        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="text-gray-600 mb-4">You can open a register from Retail operations when permitted.</p>
          <button
            type="button"
            onClick={() => router.push("/sales/open-session")}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Open a Session
          </button>
        </div>
      </div>
    )
  }

  if (openSessions.length > 1 && !session && !hydratingSession) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Close Register Session</h1>
          <button
            type="button"
            onClick={() => router.push("/retail/dashboard")}
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
          >
            Dashboard
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-4">
          <h2 className="text-lg font-semibold mb-2">Select a session to close</h2>
          <p className="text-sm text-gray-600 mb-4">
            More than one register is open for this store. Choose which till you are closing.
          </p>
          <ul className="space-y-2">
            {openSessions.map((s) => {
              const regName = s.registers?.name?.trim() || "Register"
              const storeName = s.stores?.name?.trim()
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => void handlePickSession(s)}
                    className="w-full text-left rounded-lg border-2 border-gray-200 px-4 py-3 hover:border-blue-400 hover:bg-blue-50/50 transition"
                  >
                    <div className="font-semibold text-gray-900">
                      {regName}
                      {storeName ? <span className="font-normal text-gray-600"> · {storeName}</span> : null}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 tabular-nums">
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
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-gray-600">Loading session…</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Close Register Session</h1>
          <button
            type="button"
            onClick={() => router.push("/retail/dashboard")}
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
          >
            Dashboard
          </button>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="text-gray-600">No session selected.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Close Register Session</h1>
        <button
          type="button"
          onClick={() => router.push("/retail/dashboard")}
          className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
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
            className="text-sm font-medium text-blue-700 hover:underline"
          >
            ← Choose a different open register
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
          {success}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-4">
        <h2 className="text-lg font-semibold mb-4">Session Details</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-gray-600 shrink-0">Register:</span>
            <span className="font-medium text-right">{registerDisplayName(session)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Opening Float:</span>
            <span className="font-medium">{format(session.opening_float)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Started At:</span>
            <span className="font-medium">{new Date(session.started_at).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Goods sold (session):</span>
            <span className="font-medium">
              {goodsSoldSessionTotal === null ? "—" : format(goodsSoldSessionTotal)}
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={handleCloseSession} className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Expected Cash</label>
            <div className="w-full border rounded px-3 py-2 bg-gray-50 font-semibold text-lg">
              {format(expectedCash)}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Calculated from: Opening Float + Cash Sales - Cash Drops - Change Given
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Counted Cash <span className="text-red-600">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={countedCash}
              onChange={(e) => setCountedCash(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="0.00"
              required
              disabled={submitting}
              autoFocus
            />
          </div>

          {countedCash && (
            <div>
              <label className="block text-sm font-medium mb-2">Variance</label>
              <div
                className={`w-full border rounded px-3 py-2 font-semibold text-lg ${
                  Math.abs(variance) < 0.01
                    ? "bg-green-50 text-green-700"
                    : variance > 0
                      ? "bg-yellow-50 text-yellow-700"
                      : "bg-red-50 text-red-700"
                }`}
              >
                {variance > 0 ? "+" : ""}
                {format(variance)}
              </div>
              {Math.abs(variance) > 0.01 && (
                <p className="text-sm text-red-600 mt-1">
                  Supervisor approval required to close with variance
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={() => router.push("/retail/dashboard")}
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400 flex-1"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 flex-1 disabled:bg-gray-400 disabled:cursor-not-allowed"
              disabled={submitting || !countedCash}
            >
              {submitting ? "Closing..." : "Close Session"}
            </button>
          </div>
        </div>
      </form>

      <SupervisorOverrideModal
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
  )
}
