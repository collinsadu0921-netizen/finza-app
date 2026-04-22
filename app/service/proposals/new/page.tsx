"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

export default function NewProposalPage() {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

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
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
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
