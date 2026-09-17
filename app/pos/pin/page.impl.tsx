"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  setCashierSession,
  setCashierPosToken,
  isCashierAuthenticated,
} from "@/lib/cashierSession"
import { setActiveStoreId } from "@/lib/storeSession"
import { supabase } from "@/lib/supabaseClient"
import { retailPaths } from "@/lib/retail/routes"
import { activateRetailPosPinUrlIsolation } from "@/lib/retail/posPinUrlIsolation"
import {
  afterCashierPinSuccessSecureTerminal,
  exitCashierLockForAdminReauth,
} from "@/lib/retail/cashierTerminalLock"
import { getTerminalRegisterId } from "@/lib/retail/terminalRegisterBinding"
import { PosTerminalSetupHint } from "@/components/retail/pos/PosTerminalSetupHint"

export default function PinLoginPage() {
  const router = useRouter()
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [remainingTime, setRemainingTime] = useState<number | null>(null)
  const [showAdminUnlock, setShowAdminUnlock] = useState(false)
  const [adminEmail, setAdminEmail] = useState("")
  const [adminPassword, setAdminPassword] = useState("")
  const [adminUnlockLoading, setAdminUnlockLoading] = useState(false)

  useEffect(() => {
    if (isCashierAuthenticated()) {
      router.push("/retail/pos")
      return
    }
    activateRetailPosPinUrlIsolation()
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    if (!pin || pin.length < 4 || pin.length > 6) {
      setError("PIN must be 4-6 digits")
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

        await afterCashierPinSuccessSecureTerminal({
          lock: {
            businessId: data.cashier.business_id,
            storeId: data.cashier.store_id,
            registerId: getTerminalRegisterId(data.cashier.business_id, data.cashier.store_id),
          },
        })
        router.push("/retail/pos")
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

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 px-4 py-8">
      <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Cashier Login</h1>
          <p className="text-gray-600 text-sm">Enter your PIN to access the POS system</p>
          {remainingTime != null && remainingTime > 0 && (
            <p className="mt-2 text-sm text-amber-700">Try again in {remainingTime} minutes.</p>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 text-red-700 px-4 py-3 rounded-r mb-6">
            <span className="text-sm font-medium">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="pin" className="block text-sm font-semibold text-gray-700 mb-2">
              PIN Code
            </label>
            <input
              id="pin"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pin}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "").slice(0, 6)
                setPin(value)
                setError("")
              }}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl tracking-widest"
              maxLength={6}
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={loading || pin.length < 4}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Enter POS"}
          </button>
        </form>

        <div className="mt-6 space-y-4 text-center">
          {!showAdminUnlock ? (
            <p className="text-sm text-gray-600">
              Owner or manager?{" "}
              <button
                type="button"
                onClick={() => {
                  setShowAdminUnlock(true)
                  void supabase.auth.getUser().then(({ data }) => {
                    const em = data.user?.email?.trim()
                    if (em) setAdminEmail(em)
                  })
                }}
                className="text-blue-600 font-semibold"
              >
                Admin access
              </button>
            </p>
          ) : (
            <form
              className="text-left space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                setAdminUnlockLoading(true)
                void exitCashierLockForAdminReauth({
                  email: adminEmail,
                  password: adminPassword,
                  navigateToAdmin: () => router.replace(retailPaths.dashboard),
                }).then((result) => {
                  setAdminUnlockLoading(false)
                  if (!result.ok) {
                    setError(result.error)
                    setAdminPassword("")
                  }
                })
              }}
            >
              <input
                type="email"
                placeholder="Email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                required
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={adminUnlockLoading}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold"
                >
                  {adminUnlockLoading ? "Verifying…" : "Unlock admin"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdminUnlock(false)}
                  className="px-3 border rounded-lg text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        <PosTerminalSetupHint />
      </div>
    </div>
  )
}
