"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { buildServiceRoute } from "@/lib/service/routes"

type RouteDto = {
  id: string
  recipient_address: string
  is_active: boolean
  created_at: string
  updated_at: string
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
  } catch {
    return iso
  }
}

export default function ServiceInboundEmailSettingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [effectiveBusinessId, setEffectiveBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [domainConfigured, setDomainConfigured] = useState(false)
  const [domain, setDomain] = useState<string | null>(null)
  const [route, setRoute] = useState<RouteDto | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copyLabel, setCopyLabel] = useState("Copy address")

  const bid = searchParams.get("business_id")?.trim() || effectiveBusinessId

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const biz = await getCurrentBusiness(supabase, user.id)
      if (cancelled) return
      setBusinessId(biz?.id ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const fromUrl = searchParams.get("business_id")?.trim()
    if (fromUrl) {
      setEffectiveBusinessId(fromUrl)
      return
    }
    if (businessId) {
      const next = new URLSearchParams(searchParams.toString())
      next.set("business_id", businessId)
      router.replace(`/service/settings/inbound-email?${next.toString()}`)
      setEffectiveBusinessId(businessId)
    }
  }, [businessId, router, searchParams])

  const load = useCallback(async () => {
    if (!bid) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/business/inbound-email?business_id=${encodeURIComponent(bid)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not load inbound email settings")
        setRoute(null)
        setCanManage(false)
        return
      }
      setDomainConfigured(!!data.domain_configured)
      setDomain(typeof data.domain === "string" ? data.domain : null)
      setRoute(data.route ?? null)

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user?.id) {
        setCanManage(false)
        return
      }
      const { data: bu } = await supabase
        .from("business_users")
        .select("role")
        .eq("business_id", bid)
        .eq("user_id", user.id)
        .maybeSingle()

      const { data: biz } = await supabase.from("businesses").select("owner_id").eq("id", bid).maybeSingle()
      const isOwner = biz?.owner_id === user.id
      const role = isOwner ? "owner" : (bu?.role as string | undefined)
      setCanManage(role === "owner" || role === "admin")
    } catch {
      setError("Could not load inbound email settings")
      setCanManage(false)
    } finally {
      setLoading(false)
    }
  }, [bid])

  useEffect(() => {
    void load()
  }, [load])

  const copyAddress = async () => {
    if (!route?.recipient_address) return
    try {
      await navigator.clipboard.writeText(route.recipient_address)
      setCopyLabel("Copied")
      setTimeout(() => setCopyLabel("Copy address"), 2000)
    } catch {
      setCopyLabel("Copy failed")
      setTimeout(() => setCopyLabel("Copy address"), 2000)
    }
  }

  const createAddress = async () => {
    if (!bid) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/business/inbound-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: bid, action: "create" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not create address")
        return
      }
      setRoute(data.route ?? null)
    } finally {
      setBusy(false)
    }
  }

  const rotateAddress = async () => {
    if (!bid) return
    if (
      !window.confirm(
        "Generate a new inbound address? The old address will stop working immediately. Emails in flight may be lost."
      )
    ) {
      return
    }
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/business/inbound-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: bid, action: "rotate" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not rotate address")
        return
      }
      setRoute(data.route ?? null)
    } finally {
      setBusy(false)
    }
  }

  const setActive = async (isActive: boolean) => {
    if (!bid) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/business/inbound-email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: bid, is_active: isActive }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not update status")
        return
      }
      setRoute(data.route ?? null)
    } finally {
      setBusy(false)
    }
  }

  if (!bid && !loading) {
    return (
      <main className="max-w-2xl mx-auto p-6">
        <p className="text-sm text-slate-600">Select a workspace business to manage inbound email.</p>
      </main>
    )
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <p className="text-xs text-slate-500 mb-1">
          <Link href={buildServiceRoute("/service/settings", bid ?? undefined)} className="hover:underline">
            ← Settings
          </Link>
        </p>
        <h1 className="text-xl font-semibold text-slate-900">Inbound email for documents</h1>
        <p className="mt-1 text-sm text-slate-600">
          Send supplier invoices and receipts to a dedicated address. Files appear in{" "}
          <Link
            href={buildServiceRoute("/service/incoming-documents", bid ?? undefined)}
            className="text-blue-700 font-medium hover:underline"
          >
            Incoming documents
          </Link>{" "}
          for review before you post them to expenses or bills.
        </p>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && (
        <p className="text-sm text-red-700 rounded-lg border border-red-100 bg-red-50 px-3 py-2" role="alert">
          {error}
        </p>
      )}

      {!loading && !domainConfigured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
          Inbound email is not configured for this environment. Your administrator must set{" "}
          <code className="rounded bg-white/80 px-1">FINZA_INBOUND_EMAIL_DOMAIN</code> on the server.
        </div>
      )}

      {!loading && domainConfigured && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                route?.is_active === false ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-900"
              }`}
            >
              {route?.is_active === false ? "Deactivated" : route ? "Active" : "Not set up"}
            </span>
            {route && (
              <span className="text-xs text-slate-500">Last updated {formatTs(route.updated_at)}</span>
            )}
          </div>

          {route ? (
            <>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Your Finza address</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="text-sm break-all rounded-md bg-slate-50 border border-slate-200 px-2 py-1.5 text-slate-900">
                    {route.recipient_address}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyAddress()}
                    disabled={route.is_active === false}
                    className="text-sm font-medium rounded-lg border border-slate-200 px-3 py-1.5 text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                  >
                    {copyLabel}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-600">No inbound address yet. Generate one to start receiving files.</p>
          )}

          {!canManage && (
            <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
              Only workspace owners and admins can create, rotate, or deactivate this address.
            </p>
          )}

          {canManage && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              {!route && (
                <button
                  type="button"
                  disabled={busy || !domainConfigured}
                  onClick={() => void createAddress()}
                  className="text-sm font-medium rounded-lg bg-slate-900 text-white px-4 py-2 hover:bg-slate-800 disabled:opacity-50"
                >
                  Generate inbound address
                </button>
              )}
              {route && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void rotateAddress()}
                    className="text-sm font-medium rounded-lg border border-slate-200 px-4 py-2 text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Regenerate address
                  </button>
                  {route.is_active ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setActive(false)}
                      className="text-sm font-medium rounded-lg border border-amber-200 px-4 py-2 text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setActive(true)}
                      className="text-sm font-medium rounded-lg border border-emerald-200 px-4 py-2 text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      Reactivate
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <div className="text-xs text-slate-600 space-y-2 border-t border-slate-100 pt-4">
            <p>
              <span className="font-medium text-slate-700">Supported attachments:</span> PDF, PNG, JPEG, WebP. Send
              files as attachments (not only in the email body).
            </p>
            <p>
              Documents still go through the normal review and linking flow before they are posted to your books.
            </p>
            {domain && (
              <p className="text-slate-500">
                Mail domain for this workspace: <code className="text-slate-700">{domain}</code>
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
