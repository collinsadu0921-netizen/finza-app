"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  getCashierSession,
  setCashierSession,
  setCashierPosToken,
  isCashierAuthenticated,
} from "@/lib/cashierSession"
import { setActiveStoreId } from "@/lib/storeSession"
import { supabase } from "@/lib/supabaseClient"
import { retailPaths } from "@/lib/retail/routes"
import {
  activateRetailPosPinUrlIsolation,
  clearRetailPosPinUrlIsolation,
} from "@/lib/retail/posPinUrlIsolation"
import { PosTerminalSetupHint } from "@/components/retail/pos/PosTerminalSetupHint"

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["clear", "0", "back"],
] as const

export default function RetailPosPinPage() {
  const router = useRouter()
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [, setRemainingTime] = useState<number | null>(null)

  useEffect(() => {
    if (isCashierAuthenticated()) {
      router.push(retailPaths.pos)
      return
    }
    activateRetailPosPinUrlIsolation()
  }, [router])

  const appendDigit = (d: string) => {
    if (loading) return
    if (pin.length >= 6) return
    setPin((p) => p + d)
    setError("")
  }

  const backspace = () => {
    if (loading) return
    setPin((p) => p.slice(0, -1))
    setError("")
  }

  const clearPin = () => {
    if (loading) return
    setPin("")
    setError("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    if (!pin || pin.length < 4 || pin.length > 6) {
      setError("PIN must be 4–6 digits")
      setLoading(false)
      return
    }

    if (!/^\d+$/.test(pin)) {
      setError("PIN must contain only digits")
      setLoading(false)
      return
    }

    try {
      const response = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin_code: pin }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 429) {
          setRemainingTime(data.remainingTime || 15)
          setError(`Too many failed attempts. Please try again in ${data.remainingTime || 15} minutes.`)
        } else {
          setError(data.error || "Invalid PIN")
        }
        setLoading(false)
        return
      }

      if (data.success && data.cashier) {
        setCashierSession({
          cashierId: data.cashier.id,
          cashierName: data.cashier.name,
          storeId: data.cashier.store_id,
          businessId: data.cashier.business_id,
        })
        setCashierPosToken(
          typeof data.cashier_pos_token === "string" ? data.cashier_pos_token : null
        )

        const { data: storeData } = await supabase
          .from("stores")
          .select("name")
          .eq("id", data.cashier.store_id)
          .maybeSingle()

        if (storeData) {
          setActiveStoreId(data.cashier.store_id, storeData.name)
        } else {
          setActiveStoreId(data.cashier.store_id, null)
        }

        clearRetailPosPinUrlIsolation()
        router.push(retailPaths.pos)
      } else {
        setError("Invalid PIN")
        setLoading(false)
      }
    } catch (err: unknown) {
      console.error("PIN login error:", err)
      setError("An error occurred. Please try again.")
      setLoading(false)
    }
  }

  /** Visual: 4 required minimum + 2 optional — avoids looking like “exactly 6 digits”. */
  const slotStates = Array.from({ length: 6 }, (_, i) => {
    const filled = i < pin.length
    const requiredSlot = i < 4
    return { filled, requiredSlot }
  })

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-md">
          <div className="mb-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-500">Finza terminal</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Cashier sign-in</h1>
            <p className="mt-2 text-sm text-slate-400">Enter your PIN to sign in to this till</p>
            <p className="mt-2 text-xs font-medium text-slate-500">
              PIN is <span className="text-slate-300">4–6 digits</span> — first four positions are the minimum length.
            </p>
          </div>

            {error && (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-red-500/40 bg-red-950/60 px-4 py-3 text-sm font-medium text-red-100"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur-md sm:p-8">
            <label htmlFor="pin-hidden" className="sr-only">
              PIN code
            </label>
            <input
              id="pin-hidden"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              value={pin}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "").slice(0, 6)
                setPin(value)
                setError("")
              }}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
            />

            <div
              className="mb-2 flex flex-wrap items-end justify-center gap-1.5 sm:gap-2"
              aria-live="polite"
              aria-label={`${pin.length} digits entered, minimum 4, maximum 6`}
            >
              {slotStates.map(({ filled, requiredSlot }, idx) => (
                <span
                  key={idx}
                  className={`flex items-center justify-center rounded-xl border-2 font-mono font-bold transition-colors ${
                    idx < 4
                      ? "h-12 w-10 text-lg sm:h-14 sm:w-12 sm:text-xl"
                      : "h-10 w-8 text-sm opacity-90 sm:h-11 sm:w-9"
                  } ${
                    filled
                      ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-300"
                      : requiredSlot
                        ? "border-dashed border-slate-500 bg-slate-950/40 text-transparent"
                        : "border-slate-700/80 border-dashed bg-slate-950/30 text-transparent"
                  }`}
                >
                  {filled ? "●" : ""}
                </span>
              ))}
            </div>
            <p className="mb-6 text-center text-[10px] text-slate-500">
              Larger boxes = required length · smaller = optional extra digits
            </p>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {KEYS.flat().map((key) => {
                if (key === "clear") {
                  return (
                    <button
                      key="clear"
                      type="button"
                      disabled={loading}
                      onClick={clearPin}
                      className="min-h-[52px] touch-manipulation rounded-2xl border border-slate-700 bg-slate-800/80 text-xs font-bold uppercase tracking-wide text-slate-200 hover:bg-slate-800 disabled:opacity-40 sm:min-h-[56px]"
                    >
                      Clear
                    </button>
                  )
                }
                if (key === "back") {
                  return (
                    <button
                      key="back"
                      type="button"
                      disabled={loading}
                      onClick={backspace}
                      className="min-h-[52px] touch-manipulation rounded-2xl border border-slate-700 bg-slate-800/80 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40 sm:min-h-[56px]"
                    >
                      ⌫
                    </button>
                  )
                }
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={loading}
                    onClick={() => appendDigit(key)}
                    className="min-h-[52px] touch-manipulation rounded-2xl border border-slate-700 bg-slate-800/50 text-xl font-extrabold text-white shadow-inner hover:border-slate-500 hover:bg-slate-800 active:scale-[0.97] disabled:opacity-40 sm:min-h-[56px] sm:text-2xl"
                  >
                    {key}
                  </button>
                )
              })}
            </div>

            <button
              type="submit"
              disabled={loading || pin.length < 4}
              className="mt-5 min-h-[52px] w-full touch-manipulation rounded-2xl bg-emerald-500 py-3.5 text-base font-extrabold tracking-tight text-emerald-950 shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-400 focus:outline-none focus:ring-4 focus:ring-emerald-400/30 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Checking…
                </span>
              ) : (
                "Unlock POS"
              )}
            </button>
          </form>

          <div className="mt-8 space-y-3 text-center text-sm text-slate-400">
            <p>
              <button
                type="button"
                onClick={() => {
                  clearRetailPosPinUrlIsolation()
                  router.push(retailPaths.dashboard)
                }}
                className="font-semibold text-slate-200 underline decoration-slate-600 underline-offset-4 hover:text-white"
              >
                Exit to retail dashboard
              </button>
            </p>
            <p>
              Manager on this device?{" "}
              <button
                type="button"
                onClick={() => {
                  clearRetailPosPinUrlIsolation()
                  router.push("/login")
                }}
                className="font-bold text-emerald-400 underline decoration-emerald-700 underline-offset-4 hover:text-emerald-300"
              >
                Sign in with email
              </button>
            </p>
          </div>

          <div className="mt-8">
            <PosTerminalSetupHint variant="dark" />
          </div>
        </div>
      </div>
    </div>
  )
}
