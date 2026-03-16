"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { getCashierSession, setCashierSession, isCashierAuthenticated } from "@/lib/cashierSession"
import { setActiveStoreId } from "@/lib/storeSession"
import { supabase } from "@/lib/supabaseClient"

export default function PinLoginPage() {
  const router = useRouter()
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [remainingTime, setRemainingTime] = useState<number | null>(null)

  useEffect(() => {
    // If already authenticated as cashier, redirect to POS
    if (isCashierAuthenticated()) {
      router.push("/pos")
      return
    }

    // Don't redirect if admin/manager is logged in - allow cashier PIN login
    // Cashiers can log in even when admin session exists (different auth systems)
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
        // Store cashier session
        setCashierSession({
          cashierId: data.cashier.id,
          cashierName: data.cashier.name,
          storeId: data.cashier.store_id,
          businessId: data.cashier.business_id,
        })

        // Set active store for store context
        // Get store name from database
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

        // Redirect to POS
        router.push("/pos")
      } else {
        setError("Invalid PIN")
        setLoading(false)
      }
    } catch (err: any) {
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
          <p className="text-gray-600 text-sm">
            Enter your PIN to access the POS system
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 text-red-700 px-4 py-3 rounded-r mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium">{error}</span>
            </div>
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
                const value = e.target.value.replace(/\D/g, "")
                if (value.length <= 6) {
                  setPin(value)
                  setError("")
                }
              }}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none disabled:bg-gray-50 disabled:cursor-not-allowed text-center text-2xl tracking-widest font-mono"
              placeholder="••••"
              required
              disabled={loading}
              autoFocus
              maxLength={6}
              minLength={4}
            />
            <p className="text-xs text-gray-500 mt-2 text-center">
              4-6 digits
            </p>
          </div>

          <button
            type="submit"
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold py-3 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
            disabled={loading || pin.length < 4}
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Verifying...
              </span>
            ) : (
              "Enter POS"
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Admin or Manager?{" "}
            <button
              onClick={() => router.push("/login")}
              className="text-blue-600 font-semibold hover:text-blue-700 transition-colors duration-200 focus:outline-none focus:underline"
            >
              Sign in with email
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
