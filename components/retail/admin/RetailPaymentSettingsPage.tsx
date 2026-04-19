"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { retailPaths } from "@/lib/retail/routes"
import { getUserRole } from "@/lib/userRoles"
import { canEditBusinessWideSensitiveSettings } from "@/lib/retail/retailSensitiveSettingsEditors"
import { retailSettingsShell as RS } from "@/lib/retail/retailSettingsShell"

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

export default function RetailPaymentSettingsPage() {
  const router = useRouter()
  const [businessId, setBusinessId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [momoProviderId, setMomoProviderId] = useState<string | null>(null)
  const [momoSecretPresent, setMomoSecretPresent] = useState(false)
  const [hubtelProviderId, setHubtelProviderId] = useState<string | null>(null)
  const [hubtelSecretPresent, setHubtelSecretPresent] = useState(false)

  const [manualProviderId, setManualProviderId] = useState<string | null>(null)
  const [manualIsDefault, setManualIsDefault] = useState(false)
  const [manualIsEnabled, setManualIsEnabled] = useState(false)
  const [mwNetwork, setMwNetwork] = useState("")
  const [mwAccountName, setMwAccountName] = useState("")
  const [mwWalletNumber, setMwWalletNumber] = useState("")
  const [mwInstructions, setMwInstructions] = useState("")
  const [mwDisplayLabel, setMwDisplayLabel] = useState("")
  const [canEditPayment, setCanEditPayment] = useState(false)
  /** One-line summary of which provider is default at checkout */
  const [checkoutDefaultLine, setCheckoutDefaultLine] = useState("")

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

      const role = await getUserRole(supabase, user.id, business.id)
      setCanEditPayment(canEditBusinessWideSensitiveSettings(role))

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

      const mtn = json.mtn_momo_direct
      const hub = json.hubtel

      setMomoProviderId(mtn?.provider_id ?? null)
      setMomoSecretPresent(Boolean(mtn?.masked?.secret_present))
      const mPub = mtn?.masked?.public_config ?? {}
      setMomoApiUser(typeof mPub.api_user === "string" ? mPub.api_user : "")
      setMomoCallbackUrl(typeof mPub.callback_url === "string" ? mPub.callback_url : "")
      setMomoApiKey("")
      setMomoPrimaryKey("")

      setHubtelProviderId(hub?.provider_id ?? null)
      setHubtelSecretPresent(Boolean(hub?.masked?.secret_present))
      const hPub = hub?.masked?.public_config ?? {}
      setHubtelMerchantAccount(typeof hPub.merchant_account_number === "string" ? hPub.merchant_account_number : "")
      setHubtelPosKey("")
      setHubtelSecret("")

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

      const mtnDef = Boolean(mtn?.masked?.is_default)
      const hubDef = Boolean(hub?.masked?.is_default)
      const manDef = Boolean(mw?.masked?.is_default)
      if (mtnDef) {
        setCheckoutDefaultLine("Default at checkout: MTN MoMo")
      } else if (hubDef) {
        setCheckoutDefaultLine("Default at checkout: Hubtel")
      } else if (manDef) {
        setCheckoutDefaultLine("Default at checkout: Manual MoMo / bank transfer")
      } else {
        setCheckoutDefaultLine(
          "No default is set yet. Pick the pay option customers see first at checkout, or leave staff to choose per sale."
        )
      }

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

    if (!canEditPayment) {
      setError("Only owners and admins can change payment settings.")
      return
    }

    setSaving(true)
    try {
      const mtnSecrets: Record<string, string> = {}
      if (momoApiKey.trim()) mtnSecrets.api_key = momoApiKey.trim()
      if (momoPrimaryKey.trim()) mtnSecrets.primary_key = momoPrimaryKey.trim()

      const mtnBody: Record<string, unknown> = {
        business_id: businessId,
        public_config: {
          api_user: momoApiUser.trim(),
          callback_url: momoCallbackUrl.trim(),
        },
        environment: ENV,
      }
      if (Object.keys(mtnSecrets).length > 0) {
        mtnBody.secrets = mtnSecrets
      }

      const mtnRes = await fetch(
        momoProviderId
          ? `/api/settings/payment-providers/${momoProviderId}`
          : `/api/settings/payment-providers`,
        {
          method: momoProviderId ? "PATCH" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            momoProviderId
              ? mtnBody
              : { ...mtnBody, provider_type: "mtn_momo_direct", is_enabled: true }
          ),
        }
      )
      const mtnJson = await mtnRes.json().catch(() => ({}))
      if (!mtnRes.ok) {
        setError(mtnJson.error || "Failed to save MTN MoMo settings")
        setSaving(false)
        return
      }

      const shouldSaveHubtel =
        hubtelProviderId != null ||
        hubtelSecretPresent ||
        hubtelMerchantAccount.trim().length > 0 ||
        hubtelPosKey.trim().length > 0 ||
        hubtelSecret.trim().length > 0

      if (shouldSaveHubtel) {
        const hubSecrets: Record<string, string> = {}
        if (hubtelPosKey.trim()) hubSecrets.pos_key = hubtelPosKey.trim()
        if (hubtelSecret.trim()) hubSecrets.secret = hubtelSecret.trim()

        const hubBody: Record<string, unknown> = {
          business_id: businessId,
          public_config: {
            merchant_account_number: hubtelMerchantAccount.trim(),
          },
          environment: ENV,
        }
        if (Object.keys(hubSecrets).length > 0) {
          hubBody.secrets = hubSecrets
        }

        const hubRes = await fetch(
          hubtelProviderId
            ? `/api/settings/payment-providers/${hubtelProviderId}`
            : `/api/settings/payment-providers`,
          {
            method: hubtelProviderId ? "PATCH" : "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              hubtelProviderId
                ? hubBody
                : { ...hubBody, provider_type: "hubtel", is_enabled: true }
            ),
          }
        )
        const hubJson = await hubRes.json().catch(() => ({}))
        if (!hubRes.ok) {
          setError(hubJson.error || "Failed to save Hubtel settings")
          setSaving(false)
          return
        }
      }

      const shouldSaveManual =
        manualProviderId != null ||
        mwNetwork.trim().length > 0 ||
        mwAccountName.trim().length > 0 ||
        mwWalletNumber.trim().length > 0 ||
        mwInstructions.trim().length > 0 ||
        mwDisplayLabel.trim().length > 0

      if (shouldSaveManual) {
        const manualBody: Record<string, unknown> = {
          business_id: businessId,
          environment: ENV,
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
              manualProviderId ? manualBody : { ...manualBody, provider_type: "manual_wallet", is_enabled: true }
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

      setSuccess("Payment settings saved.")
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
    if (!canEditPayment) {
      setError("Only owners and admins can change payment settings.")
      return
    }
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
      setSuccess("Manual transfer is now the default pay option at checkout.")
      setTimeout(() => setSuccess(""), 4000)
      await loadSettings()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed")
    }
  }

  if (loading) {
    return (
      <div className={RS.outer}>
        <div className={RS.container}>
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading…</p>
        </div>
      </div>
    )
  }

  return (
    <div className={RS.outer}>
      <div className={RS.container}>
        <div className={RS.headerBlock}>
          <button type="button" onClick={() => router.push(retailPaths.dashboard)} className={RS.backLink}>
            ← Back to Dashboard
          </button>
          <h1 className={RS.title}>Payment settings</h1>
          <p className={RS.subtitle}>
            MoMo, Hubtel, and pay-to-wallet details for checkout and recording sales in Finza.
          </p>
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-950 dark:border-blue-900/40 dark:bg-blue-950/25 dark:text-blue-100">
            <span className="font-medium">Receipt layout</span> (logo, header, footer) —{" "}
            <Link href={retailPaths.receiptSettings} className={RS.linkInline}>
              Receipts &amp; printer
            </Link>
          </div>
        </div>

        <div
          className="mb-6 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          role="status"
        >
          <span className="font-semibold text-gray-900 dark:text-white">Checkout default: </span>
          {checkoutDefaultLine}
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200">
            {success}
          </div>
        )}

        {!canEditPayment && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100">
            View only: owners and admins can edit payment settings.
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSave()
          }}
          className="space-y-6"
        >
          <fieldset disabled={!canEditPayment} className="m-0 min-w-0 space-y-6 border-0 p-0">
          <div className={RS.insetCard}>
            <h2 className={`${RS.sectionTitle} mb-1`}>MTN MoMo</h2>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">Gateway connection for MoMo collections at checkout.</p>
            {momoSecretPresent && (
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                Keys are stored securely. Leave blank to keep the current key, or enter a new one to replace it.
              </p>
            )}
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
                    placeholder={momoSecretPresent ? "Leave blank to keep current key" : "Enter API Key"}
                    value={momoApiKey}
                    onChange={(e) => setMomoApiKey(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">MoMo Primary Key</label>
                  <input
                    type="password"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder={momoSecretPresent ? "Leave blank to keep current key" : "Enter Primary Key"}
                    value={momoPrimaryKey}
                    onChange={(e) => setMomoPrimaryKey(e.target.value)}
                    autoComplete="off"
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
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">MTN sends payment confirmations to this URL.</p>
                </div>
              </div>
            </div>
          </div>

          <div className={RS.insetCard}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className={RS.sectionTitle}>Pay to wallet / transfer</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Shown on checkout when this is the default. Staff still records payment in Finza (no auto-confirm).
                </p>
              </div>
              {manualProviderId && (
                <span className="shrink-0 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {manualIsDefault ? "Default at checkout" : "Not default"}
                  <span className="mx-1 text-gray-400">·</span>
                  {manualIsEnabled ? "On" : "Off"}
                </span>
              )}
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Network</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="e.g. mtn, telecel, at"
                  value={mwNetwork}
                  onChange={(e) => setMwNetwork(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Account name</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Name on the wallet"
                  value={mwAccountName}
                  onChange={(e) => setMwAccountName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Wallet number</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Number customers send money to"
                  value={mwWalletNumber}
                  onChange={(e) => setMwWalletNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Display label (optional)</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Short title on pay page"
                  value={mwDisplayLabel}
                  onChange={(e) => setMwDisplayLabel(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Instructions / note</label>
                <textarea
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white min-h-[88px]"
                  placeholder="Reference format, hours, etc."
                  value={mwInstructions}
                  onChange={(e) => setMwInstructions(e.target.value)}
                />
              </div>
              {manualProviderId && (
                <button type="button" onClick={setManualAsDefault} className={RS.secondaryButton}>
                  Use as default at checkout
                </button>
              )}
            </div>
          </div>

          <div className={RS.insetCard}>
            <h2 className={`${RS.sectionTitle} mb-1`}>Hubtel</h2>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">Optional. For Hubtel checkout flows.</p>
            {hubtelSecretPresent && (
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                Keys are stored securely. Leave blank to keep current values.
              </p>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Hubtel POS Key</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder={hubtelSecretPresent ? "Leave blank to keep current key" : "Enter POS Key"}
                  value={hubtelPosKey}
                  onChange={(e) => setHubtelPosKey(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Hubtel Secret</label>
                <input
                  type="password"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder={hubtelSecretPresent ? "Leave blank to keep current secret" : "Enter Secret"}
                  value={hubtelSecret}
                  onChange={(e) => setHubtelSecret(e.target.value)}
                  autoComplete="off"
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
          </fieldset>

          <div className="mt-6 flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
            <button type="button" onClick={() => router.push(retailPaths.dashboard)} className={`${RS.secondaryButton} w-full sm:w-auto`}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !canEditPayment}
              title={!canEditPayment ? "Only owners and admins can save payment settings" : undefined}
              className={`${RS.primaryButton} w-full px-8 py-2.5 sm:w-auto sm:min-w-[10rem]`}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
