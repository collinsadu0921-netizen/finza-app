"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getAllUserBusinesses, setSelectedBusinessId, getSelectedBusinessId } from "@/lib/business"
import { setTabIndustryMode } from "@/lib/industryMode"

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    const resolveLanding = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData?.session?.user?.id ?? null

      if (!userId) {
        router.replace("/login")
        return
      }

      // Account intent takes priority over workspace defaults.
      // New accountant users should not be forced into service-first routing.
      const { data: authData } = await supabase.auth.getUser()
      const signupIntent = authData.user?.user_metadata?.signup_intent

      if (signupIntent === "accounting_firm") {
        const { data: firmUsers } = await supabase
          .from("accounting_firm_users")
          .select("firm_id")
          .eq("user_id", userId)
          .limit(1)

        if (firmUsers && firmUsers.length > 0) {
          router.replace("/accounting/firm")
          return
        }

        router.replace("/accounting/firm/setup")
        return
      }

      const all = await getAllUserBusinesses(supabase, userId)

      if (all.length === 0) {
        // No business yet — send to service dashboard to set up
        setTabIndustryMode("service")
        router.replace("/service/dashboard")
        return
      }

      if (all.length === 1) {
        // Single workspace — select it and go straight to dashboard
        const biz = all[0]
        setSelectedBusinessId(biz.id)
        setTabIndustryMode(biz.industry ?? "service")
        router.replace(biz.industry === "retail" ? "/retail/dashboard" : "/service/dashboard")
        return
      }

      // Multiple workspaces — check if one was previously selected
      const preferredId = getSelectedBusinessId()
      if (preferredId) {
        const preferred = all.find(b => b.id === preferredId)
        if (preferred) {
          setTabIndustryMode(preferred.industry ?? "service")
          router.replace(preferred.industry === "retail" ? "/retail/dashboard" : "/service/dashboard")
          return
        }
      }

      // No preference stored — show workspace selector
      router.replace("/select-workspace")
    }

    resolveLanding()
  }, [router])

  return (
    <div className="flex items-center justify-center h-screen bg-slate-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700 mx-auto" />
        <p className="mt-3 text-slate-500 text-sm">Loading…</p>
      </div>
    </div>
  )
}
