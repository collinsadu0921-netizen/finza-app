"use client"

import { useState, useEffect, useMemo } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { retailPaths } from "@/lib/retail/routes"
import { getActiveStoreId } from "@/lib/storeSession"
import { getTerminalRegisterId, setTerminalRegisterId } from "@/lib/retail/terminalRegisterBinding"
import { useRouteGuard } from "@/lib/useRouteGuard"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { RetailMenuSelect, type MenuSelectOption } from "@/components/retail/RetailBackofficeUi"

type Register = {
  id: string
  name: string
  is_default?: boolean
}

export default function RetailOpenSessionPage() {
  const router = useRouter()
  // Route guard: Only managers/admins can access this page
  useRouteGuard()
  
  const [registers, setRegisters] = useState<Register[]>([])
  const [selectedRegisterId, setSelectedRegisterId] = useState("")
  const [openingFloat, setOpeningFloat] = useState("")
  const [businessId, setBusinessId] = useState("")
  const { format } = useBusinessCurrency()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [bindTerminalAfterOpen, setBindTerminalAfterOpen] = useState(true)

  const registerMenuOptions = useMemo(() => {
    const head: MenuSelectOption[] = [{ value: "", label: "Choose register…" }]
    return head.concat(registers.map((r) => ({ value: r.id, label: r.name })))
  }, [registers])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      // STRICT: Only admin/manager can open register (cashiers blocked)
      const { getUserRole } = await import("@/lib/userRoles")
      const role = await getUserRole(supabase, user.id, business.id)
      
      if (role === "cashier") {
        setError("Cashiers cannot open registers. Please contact a manager or admin.")
        setLoading(false)
        router.push(retailPaths.pos)
        return
      }
      
      if (role !== "admin" && role !== "manager" && role !== "owner") {
        setError("Only managers and admins can open registers.")
        setLoading(false)
        router.push(retailPaths.dashboard)
        return
      }

      // Get active store from session (single source of truth)
      // NEVER use user.store_id after session is created
      const activeStoreId = getActiveStoreId()
      const storeIdForRegisters = activeStoreId && activeStoreId !== 'all' ? activeStoreId : null

      // REGISTER-BASED: Check if the selected register already has an open session
      // (We'll check this after register selection, not here during load)
      // This allows multiple registers to be open simultaneously

      // Load registers (filter by active store)
      // CRITICAL: Use default register semantics, NOT alphabetical ordering
      let registersQuery = supabase
        .from("registers")
        .select("id, name, store_id, is_default")
        .eq("business_id", business.id)
      
      if (storeIdForRegisters) {
        registersQuery = registersQuery.eq("store_id", storeIdForRegisters)
      }
      
      // Order by default first, then by creation date (not name)
      // Handle case where is_default column doesn't exist yet
      let regs: any[] | null = null
      let regsError: any = null
      
      try {
        const result = await registersQuery
          .order("is_default", { ascending: false })
          .order("created_at", { ascending: true })
        regs = result.data
        regsError = result.error
      } catch (err: any) {
        // If is_default column doesn't exist, order by created_at only
        if (err.message?.includes("is_default") || err.code === "42703") {
          const result = await registersQuery
            .order("created_at", { ascending: true })
          regs = result.data
          regsError = result.error
        } else {
          regsError = err
        }
      }

      if (regsError) throw regsError

      setRegisters(regs || [])

      const boundRegisterId =
        storeIdForRegisters && business.id ? getTerminalRegisterId(business.id, storeIdForRegisters) : null
      const boundStillValid = !!(boundRegisterId && regs?.some((r) => r.id === boundRegisterId))

      if (boundStillValid && boundRegisterId) {
        setSelectedRegisterId(boundRegisterId)
      } else {
        const defaultRegister = regs?.find((r) => r.is_default)
        if (defaultRegister) {
          setSelectedRegisterId(defaultRegister.id)
        } else if (regs && regs.length > 0) {
          setSelectedRegisterId(regs[0].id)
        }
      }
      
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load data")
      setLoading(false)
    }
  }

  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")
    setSubmitting(true)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in")
        setSubmitting(false)
        return
      }

      if (!selectedRegisterId) {
        setError("Please select a register")
        setSubmitting(false)
        return
      }

      const floatAmount = Number(openingFloat)
      if (isNaN(floatAmount) || floatAmount < 0) {
        setError("Opening float must be a valid number >= 0")
        setSubmitting(false)
        return
      }

      const activeStoreId = getActiveStoreId()

      const { data: register, error: registerError } = await supabase
        .from("registers")
        .select("store_id, name")
        .eq("id", selectedRegisterId)
        .maybeSingle()

      if (registerError && registerError.code !== "PGRST116") {
        console.error("Error fetching register:", registerError)
      }

      if (!activeStoreId || activeStoreId === "all") {
        setError("Please select a store before opening a session. Go to Stores page and click 'Open Store'.")
        setSubmitting(false)
        return
      }

      if (register?.store_id && register.store_id !== activeStoreId) {
        setError(`This register does not belong to the store you have open. Switch store or pick another register.`)
        setSubmitting(false)
        return
      }

      if (register && !register.store_id) {
        setError(
          `Register "${register.name || selectedRegisterId}" is not assigned to a store. Assign it in Register settings first.`,
        )
        setSubmitting(false)
        return
      }

      const res = await fetch(retailPaths.apiRegisterOpenSession, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          register_id: selectedRegisterId,
          opening_float: floatAmount,
        }),
      })

      const payload = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (res.status === 409) {
          setError(
            payload.error ||
              "This register already has an open session. Close it first or choose a different register.",
          )
        } else {
          setError(payload.error || "Failed to open register session")
        }
        setSubmitting(false)
        return
      }

      if (bindTerminalAfterOpen) {
        setTerminalRegisterId(businessId, activeStoreId, selectedRegisterId)
      }

      setSuccess("Register session opened successfully!")
      setSubmitting(false)
      router.push(retailPaths.pos)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to open session")
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" aria-hidden />
        <p className="mt-4 text-sm font-semibold text-slate-600">Loading registers…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-white px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">Shift start</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">Open register</h1>
            <p className="mt-2 text-sm font-medium text-slate-600">Count the drawer float before first sale.</p>
          </div>
          <button
            type="button"
            onClick={() => router.push(retailPaths.dashboard)}
            className="shrink-0 touch-manipulation rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
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

        {success && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
            {success}
          </div>
        )}

        <form
          onSubmit={handleOpenSession}
          className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        >
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Register <span className="text-red-600">*</span>
            </label>
            <RetailMenuSelect
              value={selectedRegisterId}
              onValueChange={setSelectedRegisterId}
              options={registerMenuOptions}
              className="min-h-[48px] touch-manipulation rounded-xl"
              disabled={submitting}
            />
            {registers.length === 0 && (
              <p className="mt-2 text-sm text-slate-500">
                No registers found. Add one in{" "}
                <button
                  type="button"
                  onClick={() => router.push(retailPaths.adminRegisters)}
                  className="font-bold text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-800"
                >
                  Register settings
                </button>
                .
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Opening float (cash in drawer) <span className="text-red-600">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
              className="min-h-[52px] w-full touch-manipulation rounded-xl border-2 border-slate-200 bg-slate-50/50 px-4 text-lg font-extrabold tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/15"
              placeholder="0.00"
              required
              disabled={submitting}
            />
            <p className="mt-2 text-xs font-medium leading-relaxed text-slate-500">
              Enter the physical cash you are handing over at shift start. This anchors expected cash at close-out.
            </p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/90 p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={bindTerminalAfterOpen}
                onChange={(e) => setBindTerminalAfterOpen(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                disabled={submitting}
              />
              <span>
                <span className="block text-sm font-bold text-slate-800">Link this device to this till</span>
                <span className="mt-0.5 block text-xs font-medium leading-relaxed text-slate-600">
                  Recommended: cashiers on this screen will use this register automatically. Change anytime from POS →
                  &quot;Change till register&quot;.
                </span>
              </span>
            </label>
          </div>

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
              onClick={(e) => {
                if (!selectedRegisterId) {
                  e.preventDefault()
                  setError("Please select a register")
                  return
                }
                if (!openingFloat) {
                  e.preventDefault()
                  setError("Please enter opening float")
                  return
                }
              }}
              className="min-h-[48px] flex-1 touch-manipulation rounded-xl bg-blue-600 py-3 text-sm font-extrabold text-white shadow-lg hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none"
              disabled={submitting || !selectedRegisterId || !openingFloat}
            >
              {submitting ? "Opening…" : "Open session & go to POS"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
