"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { ProposalEditorForm } from "@/components/proposals/ProposalEditorForm"

export default function EditProposalPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [businessDefaultCurrency, setBusinessDefaultCurrency] = useState<string | null>(null)
  const [businessIndustry, setBusinessIndustry] = useState<string | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
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
        if (!cancelled) {
          setBusinessId(business.id)
          setBusinessDefaultCurrency((business.default_currency as string | null) ?? null)
          setBusinessIndustry((business.industry as string | null) ?? null)
        }
      } catch {
        if (!cancelled) setError("Failed to resolve business")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{error}</div>
      </div>
    )
  }

  if (!businessId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        Loading…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1500px] space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => router.push("/service/proposals")} className="text-sm text-slate-600 hover:text-slate-900">
              ← Proposals
            </button>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Edit proposal</h1>
          </div>
        </div>
        <ProposalEditorForm
          proposalId={id}
          businessId={businessId}
          businessDefaultCurrency={businessDefaultCurrency}
          businessIndustry={businessIndustry}
        />
      </div>
    </div>
  )
}
