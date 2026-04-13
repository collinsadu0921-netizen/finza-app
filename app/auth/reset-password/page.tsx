"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { FinzaLogo } from "@/components/FinzaLogo"

const MIN_PASSWORD_LENGTH = 8

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [phase, setPhase] = useState<"checking" | "ready" | "invalid">("checking")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    const establishSession = async () => {
      const code = searchParams.get("code")

      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            if (!cancelled) {
              setPhase("invalid")
              setError(exchangeError.message)
            }
            return
          }
          if (!cancelled) setPhase("ready")
          router.replace("/auth/reset-password", { scroll: false })
          return
        }

        const checkSession = async () => {
          const {
            data: { session },
          } = await supabase.auth.getSession()
          if (session?.user) {
            if (!cancelled) setPhase("ready")
            return true
          }
          return false
        }

        let ok = await checkSession()
        if (!ok) {
          await new Promise((r) => setTimeout(r, 150))
          ok = await checkSession()
        }

        if (!cancelled && !ok) {
          setPhase("invalid")
          setError("This reset link is invalid or has expired. Request a new one from the sign-in page.")
        }
      } catch (e: any) {
        if (!cancelled) {
          setPhase("invalid")
          setError(e?.message || "Could not verify reset link.")
        }
      }
    }

    void establishSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === "PASSWORD_RECOVERY" && session?.user) {
        setPhase("ready")
        setError("")
      }
      if (event === "SIGNED_IN" && session?.user) {
        setPhase("ready")
        setError("")
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [searchParams, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError("Passwords do not match.")
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message || "Could not update password")
        setLoading(false)
        return
      }

      await supabase.auth.signOut()
      router.replace("/login?reset=success")
    } catch (err: any) {
      setError(err.message || "Something went wrong")
      setLoading(false)
    }
  }

  if (phase === "checking") {
    return (
      <div className="text-center py-8">
        <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-gray-600 text-sm mt-4">Verifying your link…</p>
      </div>
    )
  }

  if (phase === "invalid") {
    return (
      <div className="space-y-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        <div className="flex flex-col gap-2 text-center">
          <Link
            href="/forgot-password"
            className="inline-flex justify-center items-center w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700"
          >
            Request a new link
          </Link>
          <Link href="/login" className="text-sm text-blue-600 font-semibold hover:text-blue-700 py-2">
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <div>
        <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
          New password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          disabled={loading}
        />
      </div>

      <div>
        <label htmlFor="confirm" className="block text-sm font-semibold text-gray-700 mb-2">
          Confirm new password
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          placeholder="Re-enter password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          disabled={loading}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 transition-colors"
      >
        {loading ? "Updating…" : "Update password"}
      </button>

      <p className="text-center text-sm text-gray-600">
        <Link href="/login" className="text-blue-600 font-semibold hover:text-blue-700">
          Cancel and sign in
        </Link>
      </p>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 px-4 py-8">
      <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <FinzaLogo height={72} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Choose a new password</h1>
          <p className="text-gray-600 text-sm">Use a strong password you don&apos;t use elsewhere.</p>
        </div>

        <Suspense
          fallback={
            <div className="text-center py-8">
              <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-gray-600 text-sm mt-4">Loading…</p>
            </div>
          }
        >
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  )
}
