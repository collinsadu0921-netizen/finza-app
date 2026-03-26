"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { setActiveFirmId } from "@/lib/accounting/firm/session"

/**
 * Firm Setup Page
 * Step 9.3 Batch C
 * 
 * Allows new accounting firm users to:
 * - Create a new firm
 * - Join an existing firm (if invited)
 * 
 * This page is shown after signup when signup_intent = 'accounting_firm'
 */
export default function FirmSetupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [mode, setMode] = useState<"create" | "join">("create")
  const [firmName, setFirmName] = useState("")
  const [firmCode, setFirmCode] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadUser()
  }, [])

  const loadUser = async () => {
    try {
      const { data: authData } = await supabase.auth.getUser()
      if (authData.user) {
        setUser(authData.user)
      }
    } catch (err) {
      console.error("Error loading user:", err)
    } finally {
      setLoading(false)
    }
  }

  const ensureUserRecord = async (authUser: any) => {
    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle()

    if (existingUser) {
      return existingUser
    }

    const { data: newUser, error: newUserError } = await supabase
      .from("users")
      .insert({
        id: authUser.id,
        email: authUser.email,
        full_name: authUser.user_metadata?.full_name || "",
      })
      .select()
      .single()

    if (newUserError) {
      throw newUserError
    }

    return newUser
  }

  const handleCreateFirm = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    try {
      if (!user) {
        throw new Error("Not logged in")
      }

      if (!firmName.trim()) {
        throw new Error("Firm name is required")
      }

      // Ensure user record exists
      const userRecord = await ensureUserRecord(user)

      // Create firm
      const { data: firm, error: firmError } = await supabase
        .from("accounting_firms")
        .insert({
          name: firmName.trim(),
          created_by: userRecord.id,
        })
        .select("id, name")
        .single()

      if (firmError) {
        throw new Error(firmError.message || "Failed to create firm")
      }

      // Add user to firm as partner
      const { error: userError } = await supabase
        .from("accounting_firm_users")
        .insert({
          firm_id: firm.id,
          user_id: userRecord.id,
          role: "partner",
        })

      if (userError) {
        // Rollback: delete firm if user addition fails
        await supabase.from("accounting_firms").delete().eq("id", firm.id)
        throw new Error(userError.message || "Failed to add user to firm")
      }

      // Set active firm
      setActiveFirmId(firm.id, firm.name)

      // Redirect to firm onboarding
      router.push("/accounting/firm/onboarding")
    } catch (err: any) {
      setError(err.message || "Failed to create firm")
      setSubmitting(false)
    }
  }

  const handleJoinFirm = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    try {
      if (!user) {
        throw new Error("Not logged in")
      }

      if (!firmCode.trim()) {
        throw new Error("Firm code is required")
      }

      // Ensure user record exists
      const userRecord = await ensureUserRecord(user)

      // Find firm by code (if you implement firm codes)
      // For now, show error that joining is not yet implemented
      throw new Error("Joining existing firms is not yet available. Please create a new firm.")

      // TODO: Implement firm code lookup and joining logic
    } catch (err: any) {
      setError(err.message || "Failed to join firm")
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-8">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              Set Up Your Accounting Firm
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              Create a new firm or join an existing one
            </p>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Mode Selection */}
          <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex gap-4">
              <button
                onClick={() => setMode("create")}
                className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                  mode === "create"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                Create New Firm
              </button>
              <button
                onClick={() => setMode("join")}
                className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                  mode === "join"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                Join Existing Firm
              </button>
            </div>
          </div>

          {/* Create Firm Form */}
          {mode === "create" && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                Create New Firm
              </h2>
              <form onSubmit={handleCreateFirm} className="space-y-6">
                <div>
                  <label
                    htmlFor="firm_name"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Firm Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="firm_name"
                    required
                    value={firmName}
                    onChange={(e) => setFirmName(e.target.value)}
                    placeholder="Enter your accounting firm name"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    This will be the name of your accounting firm
                  </p>
                </div>

                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button
                    type="submit"
                    disabled={submitting || !firmName.trim()}
                    className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    {submitting ? "Creating..." : "Create Firm & Continue"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Join Firm Form */}
          {mode === "join" && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                Join Existing Firm
              </h2>
              <form onSubmit={handleJoinFirm} className="space-y-6">
                <div>
                  <label
                    htmlFor="firm_code"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Firm Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="firm_code"
                    required
                    value={firmCode}
                    onChange={(e) => setFirmCode(e.target.value)}
                    placeholder="Enter firm invitation code"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Get this code from a Partner in your firm
                  </p>
                </div>

                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    <strong>Note:</strong> Joining existing firms is not yet available. Please create a new firm or ask a Partner to add you manually.
                  </p>
                </div>

                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button
                    type="submit"
                    disabled={true}
                    className="w-full px-6 py-3 bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 rounded-lg cursor-not-allowed font-medium"
                  >
                    Coming Soon
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="mt-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-200 mb-2">
              What happens next?
            </h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-blue-700 dark:text-blue-300">
              <li>You'll be added to the firm as a Partner</li>
              <li>You'll complete firm onboarding (legal name, jurisdiction, reporting standards)</li>
              <li>You can then add external clients and start managing their accounting</li>
            </ul>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
