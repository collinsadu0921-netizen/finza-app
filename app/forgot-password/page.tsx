"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { FinzaLogo } from "@/components/FinzaLogo"
import { getPublicAppUrl } from "@/lib/auth/publicAppUrl"

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        setError("App is not configured for sign-in.")
        setLoading(false)
        return
      }

      const origin = getPublicAppUrl()
      const redirectTo = `${origin}/auth/reset-password`

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      })

      if (resetError) {
        setError(resetError.message || "Could not send reset email")
        setLoading(false)
        return
      }

      setSent(true)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Something went wrong")
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 px-4 py-8">
      <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <FinzaLogo height={72} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Reset your password</h1>
          <p className="text-gray-600 text-sm">
            Enter your email and we&apos;ll send you a link to choose a new password.
          </p>
        </div>

        {sent ? (
          <div className="space-y-6">
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg text-sm">
              If an account exists for <strong>{email.trim()}</strong>, you&apos;ll receive an email with a reset
              link shortly. Check your inbox and spam folder.
            </div>
            <p className="text-sm text-gray-600 text-center">
              The link expires after a short time for security.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => router.push("/login")}
                className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Back to sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setSent(false)
                  setEmail("")
                }}
                className="w-full text-sm text-blue-600 font-semibold hover:text-blue-700 py-2"
              >
                Use a different email
              </button>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none disabled:bg-gray-50"
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-600">
              <Link href="/login" className="text-blue-600 font-semibold hover:text-blue-700">
                ← Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
