"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [signupIntent, setSignupIntent] = useState<"business_owner" | "accounting_firm">("business_owner")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      // Get the app URL for email confirmation redirect
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 
        (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')
      
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${appUrl}/auth/callback`,
          data: {
            full_name: fullName,
            signup_intent: signupIntent, // Step 9.3 Batch B: Store signup intent
          },
        },
      })

      if (authError) {
        setError(authError.message || "Failed to sign up")
        setLoading(false)
        return
      }

      if (data.user) {
        // Step 9.3 Batch C: Route based on signup intent
        if (signupIntent === "accounting_firm") {
          router.push("/accounting/firm/setup")
        } else {
          // Default: business owner flow (unchanged)
          router.push("/business-setup")
        }
      }
    } catch (err: any) {
      setError(err.message || "An error occurred")
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 px-4 py-8">
      <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
        {/* Header Section */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Create your account</h1>
          <p className="text-gray-600 text-sm">
            Get started with your free account today
          </p>
        </div>

        {/* Step 9.3 Batch A: Signup Intent Selection */}
        <div className="mb-6 bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            How will you use Finza?
          </label>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setSignupIntent("accounting_firm")}
              className={`w-full px-4 py-3 rounded-lg text-left transition-all ${
                signupIntent === "accounting_firm"
                  ? "bg-blue-600 text-white border-2 border-blue-600"
                  : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-2 border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🧮</span>
                <div>
                  <div className="font-medium">I manage accounting for clients</div>
                  <div className="text-xs opacity-80">For accounting firms and bookkeepers</div>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setSignupIntent("business_owner")}
              className={`w-full px-4 py-3 rounded-lg text-left transition-all ${
                signupIntent === "business_owner"
                  ? "bg-blue-600 text-white border-2 border-blue-600"
                  : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-2 border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🏢</span>
                <div>
                  <div className="font-medium">I run my own business</div>
                  <div className="text-xs opacity-80">For business owners and operators</div>
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Error Message */}
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

        {/* Signup Form */}
        <form onSubmit={handleSignup} className="space-y-5">
          <div>
            <label htmlFor="fullName" className="block text-sm font-semibold text-gray-700 mb-2">
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
              placeholder="John Doe"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
              placeholder="you@example.com"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
              placeholder="At least 6 characters"
              required
              minLength={6}
              disabled={loading}
            />
            <p className="mt-1 text-xs text-gray-500">Must be at least 6 characters long</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold py-3 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating account...
              </span>
            ) : (
              "Create account"
            )}
          </button>
        </form>

        {/* Login Link */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Already have an account?{" "}
            <button
              onClick={() => router.push("/login")}
              className="text-blue-600 font-semibold hover:text-blue-700 transition-colors duration-200 focus:outline-none focus:underline"
            >
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
