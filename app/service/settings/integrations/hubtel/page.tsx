"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useServiceSubscription } from "@/components/service/ServiceSubscriptionContext"
import { buildServiceRoute } from "@/lib/service/routes"

type HubtelConnection = {
  business_id: string
  provider: "hubtel"
  merchant_number: string
  environment: "test" | "live"
  status: "pending_verification" | "connected" | "failed" | "disconnected"
  business_display_name: string | null
  updated_at: string
}

const STATUS_LABEL: Record<string, string> = {
  not_connected: "Not connected",
  pending_verification: "Pending verification",
  connected: "Connected",
  failed: "Failed",
  disconnected: "Disconnected",
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
  const [connections, setConnections] = useState<HubtelConnection[]>([])
  const [merchantNumber, setMerchantNumber] = useState("")
  const [businessDisplayName, setBusinessDisplayName] = useState("")
  const [environment, setEnvironment] = useState<"test" | "live">("test")

  const load = async () => {
    if (!businessId) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(
        `/api/service/settings/integrations/hubtel?business_id=${encodeURIComponent(businessId)}`,
        { cache: "no-store" }
      )
      const data = (await res.json()) as { error?: string; connections?: HubtelConnection[] }
      if (!res.ok) throw new Error(data.error || "Failed to load Hubtel settings")
      setConnections(Array.isArray(data.connections) ? data.connections : [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load Hubtel settings")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  const statusForEnv = (env: "test" | "live"): string => {
    const row = connections.find((c) => c.environment === env)
    return row?.status ?? "not_connected"
  }

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
          merchant_number: merchantNumber,
          business_display_name: businessDisplayName || null,
          environment,
        }),
      })
      const data = (await res.json()) as { error?: string; message?: string }
      if (!res.ok) throw new Error(data.error || "Failed to save Hubtel settings")
      setSuccess(data.message || "Saved.")
      setMerchantNumber("")
      void load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save Hubtel settings")
    } finally {
      setSaving(false)
    }
  }

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
            Save your merchant number for onboarding. Connection remains pending verification until Hubtel
            verification is implemented.
          </p>
        </div>

        {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        {success ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Current status</h2>
          {loading ? (
            <p className="mt-2 text-sm text-slate-500">Loading…</p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-xs text-slate-500">Test</p>
                <p className="font-medium text-slate-800">{STATUS_LABEL[statusForEnv("test")]}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-xs text-slate-500">Live</p>
                <p className="font-medium text-slate-800">{STATUS_LABEL[statusForEnv("live")]}</p>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={onSave} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Set up Hubtel connection</h2>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Hubtel merchant number</label>
            <input
              value={merchantNumber}
              onChange={(e) => setMerchantNumber(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              placeholder="Enter merchant number"
              required
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
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Environment</label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value === "live" ? "live" : "test")}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </div>
          <div className="pt-1">
            <button
              type="submit"
              disabled={saving || !businessId}
              className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save as pending verification"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

