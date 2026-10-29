"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { buildServiceRoute } from "@/lib/service/routes"

type Connection = {
  connected: boolean
  status: string
  environment: "test" | "live" | null
  validation_status: string
  masked_key: string | null
  balance_pesewas: number | null
  balance_checked_at: string | null
  balance_error: string | null
  last_error: string | null
  clearing_account_id: string | null
  fee_account_id: string | null
}

type SettingsResponse = {
  connection: Connection
  webhook_url: string
  webhook_events: string[]
  live_transfers_enabled: boolean
  mock_mode: boolean
  expected_environment: "test" | "live"
  can_edit: boolean
  accounts: { clearing: string | null; fee: string | null }
}

function ghs(pesewas: number | null): string {
  if (pesewas == null || !Number.isFinite(Number(pesewas))) return "—"
  return `GHS ${(Number(pesewas) / 100).toFixed(2)}`
}

export default function PaystackPayrollSettingsPage() {
  const searchParams = useSearchParams()
  const workspaceId = searchParams.get("business_id")?.trim() || ""
  const settingsHref = buildServiceRoute("/service/settings", workspaceId || null)

  const [data, setData] = useState<SettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [environment, setEnvironment] = useState<"test" | "live">("test")
  const [secretKey, setSecretKey] = useState("")
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError("")
      const response = await fetch("/api/settings/payroll-paystack", { cache: "no-store" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || "Could not load Paystack payroll settings.")
        setData(null)
        return
      }
      setData(body as SettingsResponse)
      if (body?.connection?.environment === "live" || body?.connection?.environment === "test") {
        setEnvironment(body.connection.environment)
      } else if (body?.expected_environment) {
        setEnvironment(body.expected_environment)
      }
    } catch {
      setError("Could not load Paystack payroll settings.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const connection = data?.connection
  const statusTone = useMemo(() => {
    if (!connection?.connected) return "bg-slate-100 text-slate-700"
    if (connection.environment === "live") return "bg-amber-100 text-amber-800"
    return "bg-emerald-100 text-emerald-800"
  }, [connection])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/settings/payroll-paystack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment, secret_key: secretKey }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || "Could not connect this Paystack account.")
        return
      }
      setSecretKey("")
      setNotice("Paystack payroll account connected. The secret key is now encrypted and is never shown again.")
      await load()
    } catch {
      setError("Could not connect this Paystack account.")
    } finally {
      setSaving(false)
    }
  }

  const disconnect = async () => {
    if (!window.confirm("Disconnect this Paystack payroll account? New salary transfers will be blocked until you reconnect.")) {
      return
    }
    setDisconnecting(true)
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/settings/payroll-paystack", { method: "DELETE" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || "Could not disconnect the Paystack account.")
        return
      }
      setNotice("Paystack payroll account disconnected.")
      await load()
    } catch {
      setError("Could not disconnect the Paystack account.")
    } finally {
      setDisconnecting(false)
    }
  }

  const copyWebhook = async () => {
    if (!data?.webhook_url) return
    try {
      await navigator.clipboard.writeText(data.webhook_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("Could not copy the webhook URL.")
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="mb-6">
          <Link href={settingsHref} className="text-sm text-slate-500 hover:text-slate-700">
            ← Back to settings
          </Link>
          <h1 className="mt-3 text-xl font-bold text-slate-900">Paystack payroll payouts</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Connect the business&apos;s own Paystack account to pay approved employee salaries directly to
            Ghanaian bank accounts or Mobile Money. Finza&apos;s subscription Paystack account is never used
            for payroll.
          </p>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Loading Paystack payroll settings…
          </div>
        ) : (
          <div className="space-y-5">
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            ) : null}
            {notice ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {notice}
              </div>
            ) : null}
            {data?.mock_mode ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Staging mock provider is active. Paystack balance, recipients and transfer outcomes are simulated
                locally and no money moves. This mode is blocked in production.
              </div>
            ) : null}

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Connection status</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Tenant-owned account only. Connecting does not authorize any transfer.
                  </p>
                </div>
                <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium ${statusTone}`}>
                  {connection?.connected
                    ? connection.environment === "live"
                      ? "Connected · live"
                      : "Connected · test"
                    : "Not connected"}
                </span>
              </div>

              <dl className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">Paystack GHS balance</dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-900">
                    {ghs(connection?.balance_pesewas ?? null)}
                  </dd>
                  {connection?.balance_error ? (
                    <p className="mt-1 text-xs text-amber-700">{connection.balance_error}</p>
                  ) : null}
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Secret key</dt>
                  <dd className="mt-1 font-mono text-sm text-slate-700">
                    {connection?.masked_key || "Not configured"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Environment</dt>
                  <dd className="mt-1 text-slate-800">
                    {connection?.environment === "live"
                      ? "Live"
                      : connection?.environment === "test"
                        ? "Test"
                        : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Transfer eligibility</dt>
                  <dd className="mt-1 text-slate-800">
                    {connection?.connected
                      ? connection.environment === "live" && !data?.live_transfers_enabled
                        ? "Live transfers are disabled in this environment"
                        : "Eligible subject to Business plan, payroll.pay permission and balance"
                      : "Connect an account to enable Paystack transfers"}
                  </dd>
                </div>
              </dl>

              {connection?.last_error ? (
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Last connection error: {connection.last_error}
                </p>
              ) : null}

              {connection?.connected ? (
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={disconnect}
                    disabled={disconnecting || !data?.can_edit}
                    className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {disconnecting ? "Disconnecting…" : "Disconnect Paystack account"}
                  </button>
                </div>
              ) : null}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                {connection?.connected ? "Rotate credentials" : "Connect Paystack"}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Use the business&apos;s own Paystack secret key. Finza validates it against Paystack before
                storing it encrypted. Secret keys are never returned to the browser after submission.
              </p>

              {!data?.can_edit ? (
                <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  You need the settings.edit permission to change the Paystack connection.
                </p>
              ) : (
                <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-slate-700">Environment</span>
                    <select
                      value={environment}
                      onChange={(event) => setEnvironment(event.target.value as "test" | "live")}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
                    >
                      <option value="test">Test</option>
                      <option value="live">Live</option>
                    </select>
                  </label>
                  <label className="text-sm sm:col-span-2">
                    <span className="mb-1 block font-medium text-slate-700">Paystack secret key</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={secretKey}
                      onChange={(event) => setSecretKey(event.target.value)}
                      placeholder={environment === "test" ? "sk_test_…" : "sk_live_…"}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-slate-900"
                    />
                  </label>
                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      disabled={saving || !secretKey.trim()}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {saving ? "Validating with Paystack…" : connection?.connected ? "Validate and rotate key" : "Connect account"}
                    </button>
                  </div>
                </form>
              )}

              {environment === "live" && !data?.live_transfers_enabled ? (
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Live Paystack salary transfers are disabled on this deployment. A live key can be stored for
                  review, but transfer initiation will be blocked until the founder enables live payouts.
                </p>
              ) : null}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Webhook setup</h2>
              <p className="mt-1 text-xs text-slate-500">
                In the business&apos;s Paystack dashboard, add this URL to the test (or live) webhook settings and
                enable transfer success, failed and reversed events.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <code className="min-w-0 flex-1 break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {data?.webhook_url || "—"}
                </code>
                <button
                  type="button"
                  onClick={copyWebhook}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {copied ? "Copied" : "Copy URL"}
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Events: {(data?.webhook_events || ["transfer.success", "transfer.failed", "transfer.reversed"]).join(", ")}.
                Signatures are verified with this tenant&apos;s secret key.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Keep Paystack OTP enabled. If Paystack asks for an OTP, Finza prompts the authorized user during
                the transfer.
              </p>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Funding and accounting</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                <li>
                  Transfers are funded from this business&apos;s Paystack balance, not from Finza&apos;s subscription
                  account.
                </li>
                <li>
                  A confirmed salary transfer debits Net Salaries Payable (2240) and credits the Paystack Payroll
                  Clearing asset account (1040). The employee net salary is never reduced by Paystack fees.
                </li>
                <li>
                  Paystack fees are recorded separately in Payment Processing Fees (5310) when the provider reports
                  the exact fee.
                </li>
                <li>
                  Funding the Paystack balance is a separate business transfer. Finza does not create a journal from
                  a balance lookup; record the funding through the normal banking/manual journal process.
                </li>
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
