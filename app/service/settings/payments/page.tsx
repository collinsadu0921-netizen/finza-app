"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { buildServiceRoute } from "@/lib/service/routes"

type IntegratedSlice = {
  provider_id: string | null
  source: string
  masked: {
    secret_present: boolean
    secret_summary: string | null
    public_config: Record<string, unknown>
    is_enabled?: boolean
    is_default?: boolean
    configured?: boolean
  }
  /** Full manual_wallet public fields (authenticated API only). */
  settings_public?: Record<string, unknown> | null
}

type SettingsResponse = {
  mtn_momo_direct: IntegratedSlice
  hubtel: IntegratedSlice
  manual_wallet: IntegratedSlice
}

const ENV = "live"

export default function ServicePaymentSettingsPage() {
  const router = useRouter()
  const [businessId, setBusinessId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [hubtelConfigured, setHubtelConfigured] = useState(false)

  const [manualProviderId, setManualProviderId] = useState<string | null>(null)
  const [manualIsDefault, setManualIsDefault] = useState(false)
  const [manualIsEnabled, setManualIsEnabled] = useState(false)
  const [mwNetwork, setMwNetwork] = useState("")
  const [mwAccountName, setMwAccountName] = useState("")
  const [mwWalletNumber, setMwWalletNumber] = useState("")
  const [mwInstructions, setMwInstructions] = useState("")
  const [mwDisplayLabel, setMwDisplayLabel] = useState("")
  /** True after user edits manual wallet fields. */
  const [manualWalletDirty, setManualWalletDirty] = useState(false)

  const hubtelIntegrationHref = useMemo(
    () => buildServiceRoute("/service/settings/integrations/hubtel", businessId || null),
    [businessId]
  )

  const invoiceAppearanceHref = useMemo(
    () => buildServiceRoute("/service/settings/invoice-settings", businessId || null),
    [businessId]
  )

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

      const res = await fetch(
        `/api/settings/payment-providers?business_id=${encodeURIComponent(business.id)}&environment=${ENV}`,
        { credentials: "include" }
      )
      const json = (await res.json().catch(() => ({}))) as SettingsResponse & { error?: string }
      if (!res.ok) {
        setError(json.error || "Failed to load payment settings")
        setLoading(false)
        return
      }

      const hub = json.hubtel
      setHubtelConfigured(Boolean(hub?.masked?.configured ?? hub?.masked?.secret_present))

      const mw = json.manual_wallet
      setManualProviderId(mw?.provider_id ?? null)
      setManualIsDefault(Boolean(mw?.masked?.is_default))
      setManualIsEnabled(Boolean(mw?.masked?.is_enabled))
      const mwPub = (mw?.settings_public ?? mw?.masked?.public_config ?? {}) as Record<string, unknown>
      setMwNetwork(typeof mwPub.network === "string" ? mwPub.network : "")
      setMwAccountName(
        typeof mwPub.account_name === "string"
          ? mwPub.account_name
          : typeof mwPub.accountName === "string"
            ? mwPub.accountName
            : ""
      )
      setMwWalletNumber(
        typeof mwPub.wallet_number === "string"
          ? mwPub.wallet_number
          : typeof mwPub.walletNumber === "string"
            ? mwPub.walletNumber
            : ""
      )
      setMwInstructions(typeof mwPub.instructions === "string" ? mwPub.instructions : "")
      setMwDisplayLabel(
        typeof mwPub.display_label === "string"
          ? mwPub.display_label
          : typeof mwPub.displayLabel === "string"
            ? mwPub.displayLabel
            : ""
      )
      setManualWalletDirty(false)

      setLoading(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load settings")
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

    setSaving(true)
    try {
      if (!manualWalletDirty) {
        setError("No changes to save. Edit manual wallet fields, or configure Hubtel under Settings → Integrations → Hubtel.")
        setSaving(false)
        return
      }

      if (manualWalletDirty) {
        if (manualIsEnabled && !mwWalletNumber.trim() && !mwDisplayLabel.trim()) {
          setError("Manual wallet requires a wallet number or display label when enabled.")
          setSaving(false)
          return
        }
        const manualBody: Record<string, unknown> = {
          business_id: businessId,
          environment: ENV,
          is_enabled: manualIsEnabled,
          public_config: {
            network: mwNetwork.trim(),
            account_name: mwAccountName.trim(),
            wallet_number: mwWalletNumber.trim(),
            instructions: mwInstructions.trim(),
            display_label: mwDisplayLabel.trim(),
          },
        }
        const manualRes = await fetch(
          manualProviderId ? `/api/settings/payment-providers/${manualProviderId}` : `/api/settings/payment-providers`,
          {
            method: manualProviderId ? "PATCH" : "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              manualProviderId
                ? manualBody
                : { ...manualBody, provider_type: "manual_wallet", is_enabled: manualIsEnabled || true }
            ),
          }
        )
        const manualJson = await manualRes.json().catch(() => ({}))
        if (!manualRes.ok) {
          setError(manualJson.error || "Failed to save manual wallet settings")
          setSaving(false)
          return
        }
      }

      setSuccess("Payment integrations saved.")
      setTimeout(() => setSuccess(""), 3000)
      await loadSettings()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  const setManualAsDefault = async () => {
    if (!businessId || !manualProviderId) return
    setError("")
    try {
      const res = await fetch(`/api/settings/payment-providers/${manualProviderId}/set-default`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, environment: ENV }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error || "Could not set default provider")
        return
      }
      setSuccess("Manual wallet is now the default payment method for invoices.")
      setTimeout(() => setSuccess(""), 4000)
      await loadSettings()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed")
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
        <div className="mb-8" data-tour="service-payment-settings-overview">
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
            Payment integrations
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            Manual wallet instructions for customer invoice payments. Hubtel Online Checkout is configured separately.
          </p>
          <div className="mt-4 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/90 dark:bg-blue-950/35 px-4 py-3 text-sm text-blue-950 dark:text-blue-100">
            <span className="font-semibold">Bank account and MoMo numbers on the PDF?</span>{" "}
            Set those under{" "}
            <Link href={invoiceAppearanceHref} className="underline font-medium hover:no-underline">
              Invoices &amp; quotes (appearance)
            </Link>
            .
          </div>
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
          {/* Hubtel — configured on Integrations page only */}
          <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/80 dark:bg-indigo-950/30 p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Hubtel Online Checkout</h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
              {hubtelConfigured
                ? "Hubtel checkout is configured for this business."
                : "Hubtel checkout is not configured yet."}{" "}
              API credentials and Collection Account Number are managed on the Hubtel integration page only — not here.
            </p>
            <Link
              href={hubtelIntegrationHref}
              className="inline-flex text-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
            >
              Settings → Integrations → Hubtel
            </Link>
          </div>

          {/* Manual wallet — shown on customer invoice when set as default */}
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700"
            data-tour="service-payment-settings-bank"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Manual wallet (MoMo / transfer)</h2>
              {manualProviderId && (
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  {manualIsDefault ? "Default for invoices" : "Not default"}
                  {" · "}
                  {manualIsEnabled ? "Enabled" : "Disabled"}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Customers see these details on the public invoice when this provider is the business default. Staff still
              records payment in Finza — there is no automatic confirmation.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Network</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="e.g. mtn, telecel, at"
                  value={mwNetwork}
                  onChange={(e) => {
                    setManualWalletDirty(true)
                    setMwNetwork(e.target.value)
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Account name</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Name on the wallet"
                  value={mwAccountName}
                  onChange={(e) => {
                    setManualWalletDirty(true)
                    setMwAccountName(e.target.value)
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Wallet number</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Number customers send money to"
                  value={mwWalletNumber}
                  onChange={(e) => {
                    setManualWalletDirty(true)
                    setMwWalletNumber(e.target.value)
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Display label (optional)</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Short title on pay page"
                  value={mwDisplayLabel}
                  onChange={(e) => {
                    setManualWalletDirty(true)
                    setMwDisplayLabel(e.target.value)
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Instructions / note</label>
                <textarea
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white min-h-[88px]"
                  placeholder="Reference format, hours, etc."
                  value={mwInstructions}
                  onChange={(e) => {
                    setManualWalletDirty(true)
                    setMwInstructions(e.target.value)
                  }}
                />
              </div>
              {manualProviderId && (
                <button
                  type="button"
                  onClick={setManualAsDefault}
                  className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Set as default payment method for invoices
                </button>
              )}
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
              disabled={saving}
              className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-indigo-700 font-medium shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              data-tour="service-payment-settings-save"
            >
              {saving ? "Saving…" : "Save Settings"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
