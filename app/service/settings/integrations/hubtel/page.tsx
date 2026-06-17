"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useServiceSubscription } from "@/components/service/ServiceSubscriptionContext"
import { buildServiceRoute } from "@/lib/service/routes"

type HubtelSettings = {
  business_id: string
  environment: "test" | "live"
  provider_id: string | null
  configured: boolean
  invoice_checkout_enabled: boolean
  collection_account_number: string | null
  business_display_name: string | null
  api_id_configured: boolean
  api_key_configured: boolean
  connection_status: string
  encryption_key_configured: boolean
}

const STATUS_LABEL: Record<string, string> = {
  not_connected: "Not connected",
  pending_verification: "Pending verification",
  connected: "Connected",
  failed: "Failed",
  disconnected: "Disconnected",
}

type PendingItem = {
  id: string
  clientReference: string
  status: string
  recoverableAmountMismatch?: boolean
  amount: number | null
  invoiceNumber: string | null
  customerName: string | null
  lastVerificationError: string | null
  createdAt: string
}

export default function ServiceHubtelIntegrationPage() {
  const searchParams = useSearchParams()
  const urlBusinessId = searchParams.get("business_id")?.trim() || null
  const { businessId: contextBusinessId } = useServiceSubscription()
  const businessId = useMemo(() => urlBusinessId ?? contextBusinessId ?? null, [urlBusinessId, contextBusinessId])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [settings, setSettings] = useState<HubtelSettings | null>(null)

  const [apiId, setApiId] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [collectionAccountNumber, setCollectionAccountNumber] = useState("")
  const [businessDisplayName, setBusinessDisplayName] = useState("")
  const [environment, setEnvironment] = useState<"test" | "live">("live")
  const [invoiceCheckoutEnabled, setInvoiceCheckoutEnabled] = useState(false)

  const load = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(
        `/api/service/settings/integrations/hubtel?business_id=${encodeURIComponent(businessId)}&environment=${environment}`,
        { cache: "no-store" }
      )
      const data = (await res.json()) as HubtelSettings & { error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to load Hubtel settings")
      setSettings(data)
      setCollectionAccountNumber(data.collection_account_number ?? "")
      setBusinessDisplayName(data.business_display_name ?? "")
      setInvoiceCheckoutEnabled(data.invoice_checkout_enabled)
      setApiId("")
      setApiKey("")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load Hubtel settings")
    } finally {
      setLoading(false)
    }
  }, [businessId, environment])

  useEffect(() => {
    void load()
  }, [load])

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId) return
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      const res = await fetch("/api/service/settings/integrations/hubtel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          api_id: apiId.trim() || undefined,
          api_key: apiKey.trim() || undefined,
          collection_account_number: collectionAccountNumber.trim(),
          business_display_name: businessDisplayName.trim() || null,
          environment,
          invoice_checkout_enabled: invoiceCheckoutEnabled,
        }),
      })
      const data = (await res.json()) as { error?: string; message?: string; settings?: HubtelSettings }
      if (!res.ok) throw new Error(data.error || "Failed to save Hubtel settings")
      setSuccess(data.message || "Hubtel integration saved.")
      if (data.settings) setSettings(data.settings)
      setApiId("")
      setApiKey("")
      void load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save Hubtel settings")
    } finally {
      setSaving(false)
    }
  }

  const paymentsHref = buildServiceRoute("/service/settings/payments", businessId ?? undefined)

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <Link
            href={buildServiceRoute("/service/settings", businessId ?? undefined)}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            ← Back to Settings
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Hubtel Integration</h1>
          <p className="mt-1 text-sm text-slate-500">
            Configure Hubtel Online Checkout for service invoice payments. API credentials are encrypted and never
            shown after saving.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Customer invoice checkout uses the <strong>Live</strong> environment credentials. Manual bank/MoMo
            instructions on invoices are configured separately under{" "}
            <Link href={paymentsHref} className="underline hover:no-underline">
              Payment integrations
            </Link>
            .
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}
        {success ? (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </div>
        ) : null}

        {settings && !settings.encryption_key_configured ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>Encryption key missing.</strong> Set <code className="text-xs">TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY</code>{" "}
            in <code className="text-xs">.env.local</code> before saving API credentials.
          </div>
        ) : null}

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Current status</h2>
          {loading ? (
            <p className="mt-2 text-sm text-slate-500">Loading…</p>
          ) : settings ? (
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-xs text-slate-500">Connection ({environment})</dt>
                <dd className="font-medium text-slate-800">
                  {STATUS_LABEL[settings.connection_status] ?? settings.connection_status}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-xs text-slate-500">Invoice checkout</dt>
                <dd className="font-medium text-slate-800">
                  {settings.configured && settings.invoice_checkout_enabled
                    ? "Ready"
                    : settings.invoice_checkout_enabled
                      ? "Enabled — incomplete credentials"
                      : "Disabled"}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-xs text-slate-500">API ID</dt>
                <dd className="font-medium text-slate-800">
                  {settings.api_id_configured ? "Configured" : "Not set"}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-xs text-slate-500">API Key</dt>
                <dd className="font-medium text-slate-800">
                  {settings.api_key_configured ? "Saved (hidden)" : "Not set"}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>

        <form onSubmit={onSave} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Hubtel Online Checkout</h2>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={invoiceCheckoutEnabled}
              onChange={(e) => setInvoiceCheckoutEnabled(e.target.checked)}
              className="rounded border-slate-300"
            />
            Enable Hubtel invoice checkout
          </label>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Environment</label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value === "test" ? "test" : "live")}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="live">Live (used for customer invoice payments)</option>
              <option value="test">Test</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Collection Account Number</label>
            <input
              value={collectionAccountNumber}
              onChange={(e) => setCollectionAccountNumber(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              placeholder="Hubtel merchant / collection account number"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Hubtel API ID</label>
            <input
              type="password"
              value={apiId}
              onChange={(e) => setApiId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              placeholder={
                settings?.api_id_configured ? "Leave blank to keep saved API ID" : "Enter Hubtel API ID"
              }
              autoComplete="off"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Hubtel API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              placeholder={
                settings?.api_key_configured ? "Leave blank to keep saved API Key" : "Enter Hubtel API Key"
              }
              autoComplete="off"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Business display name (optional)</label>
            <input
              value={businessDisplayName}
              onChange={(e) => setBusinessDisplayName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              placeholder="Optional display name"
            />
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={saving || !businessId || loading}
              className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Hubtel settings"}
            </button>
          </div>
        </form>

        <HubtelPendingVerificationPanel businessId={businessId} />
      </div>
    </div>
  )
}

function HubtelPendingVerificationPanel({ businessId }: { businessId: string | null }) {
  const [items, setItems] = useState<PendingItem[]>([])
  const [loading, setLoading] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [retryingAll, setRetryingAll] = useState(false)
  const [statusProxyConfigured, setStatusProxyConfigured] = useState<boolean | null>(null)

  const load = async () => {
    if (!businessId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/payments/hubtel/tenant/invoice/pending?business_id=${encodeURIComponent(businessId)}`,
        { credentials: "include", cache: "no-store" }
      )
      const data = await res.json()
      setItems(Array.isArray(data.items) ? data.items : [])
      if (typeof data.statusProxyConfigured === "boolean") {
        setStatusProxyConfigured(data.statusProxyConfigured)
      }
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [businessId])

  const retryAll = async () => {
    setRetryingAll(true)
    try {
      await fetch("/api/payments/hubtel/tenant/invoice/pending", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, retryAll: true }),
      })
      await load()
    } finally {
      setRetryingAll(false)
    }
  }

  const retry = async (clientReference: string) => {
    setRetrying(clientReference)
    try {
      await fetch("/api/payments/hubtel/tenant/invoice/pending", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, clientReference }),
      })
      await load()
    } finally {
      setRetrying(null)
    }
  }

  if (!businessId) return null

  return (
    <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/50 p-5">
      <h2 className="text-lg font-bold text-gray-900">Hubtel pending verification</h2>
      <p className="mt-1 text-sm text-gray-600">
        Payments Hubtel reported but Finza could not confirm, or failed settlement due to fee/gross amount
        mismatch. Retry verification after fixing status proxy configuration.
      </p>
      {statusProxyConfigured === false ? (
        <p className="mt-2 text-xs font-medium text-amber-900">
          Hubtel status proxy is not configured on this deployment. Set HUBTEL_STATUS_PROXY_URL and
          HUBTEL_STATUS_PROXY_SECRET on Vercel, then redeploy.
        </p>
      ) : null}
      {items.length > 0 ? (
        <button
          type="button"
          onClick={() => void retryAll()}
          disabled={retryingAll}
          className="mt-3 text-xs font-semibold text-amber-900 underline disabled:opacity-50"
        >
          {retryingAll ? "Retrying all…" : "Retry all pending verifications"}
        </button>
      ) : null}
      {loading ? (
        <p className="mt-3 text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No pending verifications.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-amber-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900">
                    {item.invoiceNumber ? `Invoice ${item.invoiceNumber}` : item.clientReference}
                  </p>
                  {item.customerName ? <p className="text-gray-600">{item.customerName}</p> : null}
                  {item.amount != null ? <p className="text-gray-600">Amount: {item.amount}</p> : null}
                  {item.lastVerificationError ? (
                    <p className="text-xs text-red-600 mt-1">{item.lastVerificationError}</p>
                  ) : null}
                  {item.recoverableAmountMismatch ? (
                    <p className="text-xs text-amber-800 mt-1">
                      Paid at Hubtel; settlement failed on gross fee mismatch. Safe to retry.
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void retry(item.clientReference)}
                  disabled={retrying === item.clientReference}
                  className="text-xs font-semibold text-amber-800 underline disabled:opacity-50"
                >
                  {retrying === item.clientReference ? "Retrying…" : "Retry verification"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
