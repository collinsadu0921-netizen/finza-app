"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useSyncServiceBusinessIdInUrl } from "@/lib/navigation/serviceBusinessUrl"
import { PROPOSAL_TEMPLATE_META, type ProposalTemplateId } from "@/lib/proposals/templates"
import { ProposalTemplatePreview } from "@/components/proposals/ProposalTemplatePreview"

export default function NewProposalPage() {
  const router = useRouter()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [templateId, setTemplateId] = useState<ProposalTemplateId>("premium_v1")
  const [preparedByName, setPreparedByName] = useState("")
  const [preparedByTitle, setPreparedByTitle] = useState("")
  const [preparedByEmail, setPreparedByEmail] = useState("")
  const [preparedByPhone, setPreparedByPhone] = useState("")
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
      const { data } = await supabase.from("users").select("full_name").eq("id", user.id).maybeSingle()
      const rowName = typeof data?.full_name === "string" ? data.full_name.trim() : ""
      const metaName =
        typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : ""
      if (rowName || metaName) setPreparedByName(rowName || metaName)
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
          prepared_by_name: preparedByName.trim() || null,
          prepared_by_title: preparedByTitle.trim() || null,
          prepared_by_email: preparedByEmail.trim() || null,
          prepared_by_phone: preparedByPhone.trim() || null,
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
      <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-bold text-slate-900">New proposal</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose a document design, then add your content and branding in the editor.
        </p>
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

        <fieldset className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">Prepared by (optional)</legend>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            The business remains the official issuer. Leave optional contact fields blank to keep them private; you can
            edit these details later in the proposal editor.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="font-medium text-slate-700">Full name</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={preparedByName}
                maxLength={200}
                placeholder="e.g. Collins"
                onChange={(event) => setPreparedByName(event.target.value)}
              />
            </label>
            <label className="block text-xs">
              <span className="font-medium text-slate-700">Position / job title (optional)</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={preparedByTitle}
                maxLength={160}
                placeholder="e.g. Business Representative"
                onChange={(event) => setPreparedByTitle(event.target.value)}
              />
            </label>
            <label className="block text-xs">
              <span className="font-medium text-slate-700">Email on cover (optional)</span>
              <input
                type="email"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={preparedByEmail}
                maxLength={254}
                placeholder="Leave blank to hide"
                onChange={(event) => setPreparedByEmail(event.target.value)}
              />
            </label>
            <label className="block text-xs">
              <span className="font-medium text-slate-700">Phone on cover (optional)</span>
              <input
                type="tel"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={preparedByPhone}
                maxLength={50}
                placeholder="Leave blank to hide"
                onChange={(event) => setPreparedByPhone(event.target.value)}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium text-slate-700">Design</legend>
          <p className="mt-1 text-xs text-slate-500">
            Each preview uses the same colours, typography and cover treatment as the client document.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {PROPOSAL_TEMPLATE_META.filter((template) => !template.legacy).map((template) => (
              <ProposalTemplatePreview
                key={template.id}
                template={template}
                selected={templateId === template.id}
                onSelect={() => setTemplateId(template.id)}
              />
            ))}
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
