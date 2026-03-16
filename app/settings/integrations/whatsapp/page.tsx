"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useToast } from "@/components/ui/ToastProvider"
import { useConfirm } from "@/components/ui/ConfirmProvider"

interface WhatsAppStatus {
  connected: boolean
  phone_number: string | null
  business_id: string | null
  phone_number_id: string | null
  token_expires_at: string | null
}

function WhatsAppSettingsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const { openConfirm } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [status, setStatus] = useState<WhatsAppStatus | null>(null)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    // Check for success/error messages from OAuth callback
    const successParam = searchParams.get("success")
    const errorParam = searchParams.get("error")

    if (successParam === "connected") {
      setSuccess("WhatsApp connected successfully!")
      toast.showToast("WhatsApp connected successfully!", "success")
      // Remove query params
      router.replace("/settings/integrations/whatsapp")
    }

    if (errorParam) {
      const errorMessages: Record<string, string> = {
        missing_parameters: "Missing required parameters",
        invalid_state: "Invalid authentication state",
        unauthorized: "Unauthorized access",
        not_configured: "WhatsApp integration not configured",
        token_exchange_failed: "Failed to exchange authorization code",
        no_token: "No access token received",
        business_accounts_failed: "Failed to fetch business accounts",
        no_business_accounts: "No Meta Business accounts found",
        phone_numbers_failed: "Failed to fetch phone numbers",
        no_phone_numbers: "No WhatsApp phone numbers found",
        save_failed: "Failed to save connection details",
      }
      const errorMessage = errorMessages[errorParam] || `Error: ${errorParam}`
      setError(errorMessage)
      toast.showToast(errorMessage, "error")
      // Remove query params
      router.replace("/settings/integrations/whatsapp")
    }

    loadStatus()
  }, [])

  const loadStatus = async () => {
    try {
      setLoading(true)
      setError("")
      const response = await fetch("/api/whatsapp/status")
      if (!response.ok) {
        throw new Error("Failed to load WhatsApp status")
      }

      const data = await response.json()
      setStatus(data)
    } catch (err: any) {
      console.error("Error loading WhatsApp status:", err)
      setError(err.message || "Failed to load WhatsApp status")
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = () => {
    // Redirect to OAuth flow
    window.location.href = "/api/whatsapp/connect"
  }

  const handleDisconnect = async () => {
    openConfirm({
      title: "Disconnect WhatsApp",
      description:
        "Are you sure you want to disconnect WhatsApp? You will need to reconnect to send invoices via WhatsApp.",
      onConfirm: () => runDisconnect(),
    })
  }

  const runDisconnect = async () => {
    try {
      setDisconnecting(true)
      setError("")

      const response = await fetch("/api/whatsapp/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to disconnect WhatsApp")
      }

      setSuccess("WhatsApp disconnected successfully")
      toast.showToast("WhatsApp disconnected successfully", "success")
      await loadStatus() // Reload status
    } catch (err: any) {
      console.error("Error disconnecting WhatsApp:", err)
      setError(err.message || "Failed to disconnect WhatsApp")
      toast.showToast(err.message || "Failed to disconnect WhatsApp", "error")
    } finally {
      setDisconnecting(false)
    }
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <button
              onClick={() => router.back()}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent mb-2">
              WhatsApp Integration
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              Connect your WhatsApp Business number to send invoices directly to customers
            </p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400 text-green-700 dark:text-green-400 px-4 py-3 rounded mb-6">
              {success}
            </div>
          )}

          {/* Connection Status Card */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-200 dark:border-gray-700 mb-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Connection Status</h2>
                <p className="text-gray-600 dark:text-gray-400">Current WhatsApp Business API connection status</p>
              </div>
              {status?.connected ? (
                <div className="flex items-center gap-2 px-4 py-2 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded-full">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="font-semibold">Connected</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-400 rounded-full">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="font-semibold">Not Connected</span>
                </div>
              )}
            </div>

            {status?.connected ? (
              <div className="space-y-4">
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                    </svg>
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Connected Phone Number</p>
                      <p className="text-lg font-semibold text-gray-900 dark:text-white">{status.phone_number || "N/A"}</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="w-full bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {disconnecting ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Disconnecting...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                      Disconnect WhatsApp
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-1">How it works</p>
                      <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1 list-disc list-inside">
                        <li>Connect your Meta Business Account</li>
                        <li>Select your WhatsApp Business number</li>
                        <li>Start sending invoices directly via WhatsApp</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleConnect}
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white px-6 py-3 rounded-lg hover:from-green-700 hover:to-emerald-700 font-medium shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                  </svg>
                  Connect WhatsApp
                </button>
              </div>
            )}
          </div>

          {/* Information Card */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">About WhatsApp Integration</h3>
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>
                Connect your WhatsApp Business number using Meta&apos;s WhatsApp Cloud API to send invoices directly to your
                customers.
              </p>
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                <p className="font-medium text-gray-900 dark:text-white mb-2">Requirements:</p>
                <ul className="space-y-1 text-sm list-disc list-inside">
                  <li>Meta Business Account</li>
                  <li>WhatsApp Business API access</li>
                  <li>Verified WhatsApp Business phone number</li>
                </ul>
              </div>
              <p className="text-sm">
                <strong>Note:</strong> You will be redirected to Meta to authorize Finza to access your WhatsApp Business
                account. Only business management permissions are requested.
              </p>
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}

export default function WhatsAppSettingsPage() {
  return (
    <Suspense fallback={
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    }>
      <WhatsAppSettingsContent />
    </Suspense>
  )
}

