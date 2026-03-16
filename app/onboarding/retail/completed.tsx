"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

interface RetailOnboardingCompletedProps {
  business: any
  businessId: string
  onComplete: () => void
}

export default function RetailOnboardingCompleted({
  business,
  businessId,
  onComplete
}: RetailOnboardingCompletedProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const finalizeOnboarding = async () => {
    setLoading(true)
    setError("")

    try {
      const response = await fetch("/api/onboarding/retail/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || "Failed to complete onboarding")
        setLoading(false)
        return
      }

      // On success, proceed to POS
      onComplete()
      router.push("/pos")
    } catch (err: any) {
      console.error("Error finalizing onboarding:", err)
      setError(err.message || "Failed to complete onboarding")
      setLoading(false)
    }
  }

  useEffect(() => {
    // Auto-finalize and redirect after 2 seconds
    const timer = setTimeout(() => {
      finalizeOnboarding()
    }, 2000)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="text-center">
      <div className="mb-6">
        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          You're All Set!
        </h2>
        {loading && (
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Finalizing onboarding... Please wait.
          </p>
        )}
        {!loading && !error && (
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Your retail business is ready. Redirecting to POS terminal...
          </p>
        )}
        {error && (
          <div className="mb-6">
            <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
            <button
              onClick={finalizeOnboarding}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium"
            >
              {loading ? "Processing..." : "Retry"}
            </button>
          </div>
        )}
      </div>

      {!error && (
        <button
          onClick={finalizeOnboarding}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-3 rounded-lg font-medium"
        >
          {loading ? "Processing..." : "Go to POS Now"}
        </button>
      )}
    </div>
  )
}



















