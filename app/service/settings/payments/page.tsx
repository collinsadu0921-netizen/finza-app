"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"

type MomoSettings = {
  api_user: string
  api_key: string
  primary_key: string
  callback_url: string
}

type HubtelSettings = {
  pos_key: string
  secret: string
  merchant_account_number: string
}

export default function ServicePaymentSettingsPage() {
  const router = useRouter()
  const [businessId, setBusinessId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  // MTN MoMo fields
  const [momoApiUser, setMomoApiUser] = useState("")
  const [momoApiKey, setMomoApiKey] = useState("")
  const [momoPrimaryKey, setMomoPrimaryKey] = useState("")
  const [momoCallbackUrl, setMomoCallbackUrl] = useState("")

  // Hubtel fields
  const [hubtelPosKey, setHubtelPosKey] = useState("")
  const [hubtelSecret, setHubtelSecret] = useState("")
  const [hubtelMerchantAccount, setHubtelMerchantAccount] = useState("")

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
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

      // Load MTN MoMo settings
      if (business.momo_settings) {
        const momo = business.momo_settings as MomoSettings
        setMomoApiUser(momo.api_user || "")
        setMomoApiKey(momo.api_key || "")
        setMomoPrimaryKey(momo.primary_key || "")
        setMomoCallbackUrl(momo.callback_url || "")
      }

      // Load Hubtel settings
      if (business.hubtel_settings) {
        const hubtel = business.hubtel_settings as HubtelSettings
        setHubtelPosKey(hubtel.pos_key || "")
        setHubtelSecret(hubtel.secret || "")
        setHubtelMerchantAccount(hubtel.merchant_account_number || "")
      }

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load settings")
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setError("")
    setSuccess("")

    if (!businessId) {
      setError("Business not found. Please refresh the page.")
      return
    }

    try {
      // Prepare MTN MoMo settings
      const momoSettings: MomoSettings = {
        api_user: momoApiUser.trim(),
        api_key: momoApiKey.trim(),
        primary_key: momoPrimaryKey.trim(),
        callback_url: momoCallbackUrl.trim(),
      }

      // Prepare Hubtel settings
      const hubtelSettings: HubtelSettings = {
        pos_key: hubtelPosKey.trim(),
        secret: hubtelSecret.trim(),
        merchant_account_number: hubtelMerchantAccount.trim(),
      }

      // Update business with payment settings
      const { error: updateError } = await supabase
        .from("businesses")
        .update({
          momo_settings: momoSettings,
          hubtel_settings: hubtelSettings,
        })
        .eq("id", businessId)

      if (updateError) {
        setError(updateError.message || "Failed to save settings")
        return
      }

      setSuccess("Payment settings saved successfully!")
      setTimeout(() => setSuccess(""), 3000)
    } catch (err: any) {
      setError(err.message || "Failed to save settings")
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  return (
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
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Payment Settings
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg">Configure Mobile Money and payment gateway credentials</p>
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

        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSave()
          }}
          className="space-y-6"
        >
          {/* MTN MoMo Section */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">MTN MoMo API Credentials</h2>
            <div className="space-y-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">MoMo API User</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Enter API User"
                    value={momoApiUser}
                    onChange={(e) => setMomoApiUser(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">MoMo API Key</label>
                  <input
                    type="password"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Enter API Key"
                    value={momoApiKey}
                    onChange={(e) => setMomoApiKey(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">MoMo Primary Key</label>
                  <input
                    type="password"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Enter Primary Key"
                    value={momoPrimaryKey}
                    onChange={(e) => setMomoPrimaryKey(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">MoMo Callback URL</label>
                  <input
                    type="url"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="https://yourdomain.com/api/payments/momo/callback"
                    value={momoCallbackUrl}
                    onChange={(e) => setMomoCallbackUrl(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    This URL will receive payment confirmation callbacks from MTN
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Hubtel Section */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Hubtel Credentials (Optional)</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Hubtel POS Key</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Enter POS Key"
                  value={hubtelPosKey}
                  onChange={(e) => setHubtelPosKey(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Hubtel Secret</label>
                <input
                  type="password"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Enter Secret"
                  value={hubtelSecret}
                  onChange={(e) => setHubtelSecret(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Hubtel Merchant Account Number</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Enter Merchant Account Number"
                  value={hubtelMerchantAccount}
                  onChange={(e) => setHubtelMerchantAccount(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-indigo-700 font-medium shadow-lg transition-all flex items-center justify-center gap-2"
            >
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
