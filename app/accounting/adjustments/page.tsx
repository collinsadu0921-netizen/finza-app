"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { supabase } from "@/lib/supabaseClient"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import AdjustmentsContent from "@/components/accounting/AdjustmentsContent"

export default function AdjustmentsPage() {
  const searchParams = useSearchParams()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [noContext, setNoContext] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function resolveCtx() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const ctx = await resolveAccountingContext({ supabase, userId: user.id, searchParams, source: "workspace" })
      if (cancelled) return
      if ("error" in ctx) { setNoContext(true); return }
      setBusinessId(ctx.businessId)
    }
    resolveCtx()
    return () => { cancelled = true }
  }, [searchParams])

  if (noContext) {
    return (
      <ProtectedLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-6 text-amber-800 dark:text-amber-200">
            <p className="font-medium">Select a client or ensure you have an active business.</p>
            <p className="text-sm mt-1">No business context is available.</p>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  if (!businessId) {
    return (
      <ProtectedLayout>
        <div className="p-6"><p>Loading...</p></div>
      </ProtectedLayout>
    )
  }

  return <AdjustmentsContent businessId={businessId} />
}
