"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useSyncServiceBusinessIdInUrl } from "@/lib/navigation/serviceBusinessUrl"
import { PROPOSAL_TEMPLATE_META, type ProposalTemplateId } from "@/lib/proposals/templates"

export default function NewProposalPage() {
  const router = useRouter()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [templateId, setTemplateId] = useState<ProposalTemplateId>("premium_v1")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const business = await getCurrentBusiness(supabase, user.id)
      if (business) setBusinessId(business.id)
    })()
  }, [])

  useSyncServiceBusinessIdInUrl(businessId)

  async function create() {
    try {
      setBusy(true)
      setError("")
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setError("Not logged in")
        return
      }
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        return
      }
      const res = await fetch("/api/proposals/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          business_id: business.id,
          title: title.trim() || "Untitled proposal",
          template_id: templateId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Could not create proposal")
        return
      }
      const id = data.proposal?.id as string | undefined
      if (!id) {
        setError("Invalid response")
        return
      }
      router.push(`/service/proposals/${id}/edit`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">New proposal</h1>
        <p className="mt-1 text-sm text-slate-500">Create a draft, then add sections and media.</p>
        {error ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
        <label className="mt-6 block text-sm font-medium text-slate-700">
          Title
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Website redesign"
          />
        </label>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium text-slate-700">Design</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {PROPOSAL_TEMPLATE_META.filter((template) => !template.legacy).map((template) => {
              const active = templateId === template.id
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setTemplateId(template.id)}
                  aria-pressed={active}
                  className={`rounded-2xl border p-4 text-left transition ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-800 shadow-sm hover:border-slate-300"
                  }`}
                >
                  <span className="mb-3 block h-2 w-10 rounded-full" style={{ backgroundColor: template.accent }} />
                  <span className="block text-sm font-semibold">{template.label}</span>
                  <span className={`mt-1 block text-xs leading-relaxed ${active ? "text-slate-300" : "text-slate-500"}`}>
                    {template.description}
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void create()}
            className="flex-1 rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create draft"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/service/proposals")}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
