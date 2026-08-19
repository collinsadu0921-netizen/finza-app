"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getAllUserBusinesses, setSelectedBusinessId, getSelectedBusinessId } from "@/lib/business"
import { setTabIndustryMode } from "@/lib/industryMode"
import {
  isPracticeSignupIntent,
  PRACTICE_FIRM_SETUP_PATH,
  PRACTICE_HOME_PATH,
  PRACTICE_FIRM_ONBOARDING_PATH,
  SERVICE_BUSINESS_SETUP_PATH,
} from "@/lib/auth/signupWorkspace"
import { resolvePostAuthDestination } from "@/lib/auth/resolvePostAuthDestination"

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

      const { data: authData } = await supabase.auth.getUser()
      const signupIntent = authData.user?.user_metadata?.signup_intent

      if (isPracticeSignupIntent(signupIntent)) {
        const { data: firmUser } = await supabase
          .from("accounting_firm_users")
          .select("firm_id, accounting_firms(onboarding_status)")
          .eq("user_id", userId)
          .limit(1)
          .maybeSingle()

        if (!firmUser?.firm_id) {
          router.replace(PRACTICE_FIRM_SETUP_PATH)
          return
        }

        const firm = Array.isArray(firmUser.accounting_firms)
          ? firmUser.accounting_firms[0]
          : firmUser.accounting_firms

        if (firm?.onboarding_status !== "completed") {
          router.replace(PRACTICE_FIRM_ONBOARDING_PATH)
          return
        }

        router.replace(PRACTICE_HOME_PATH)
        return
      }

      const { data: ownedRows } = await supabase
        .from("businesses")
        .select("id, industry")
        .eq("owner_id", userId)
        .is("archived_at", null)

      const { data: membershipRows } = await supabase
        .from("business_users")
        .select("business_id, businesses(id, industry, archived_at)")
        .eq("user_id", userId)

      const destination = resolvePostAuthDestination({
        signupIntent: typeof signupIntent === "string" ? signupIntent : undefined,
        hasFirmMembership: false,
        ownedBusinesses: Array.isArray(ownedRows) ? ownedRows : [],
        membershipRows: Array.isArray(membershipRows) ? membershipRows : [],
        trialIntent: authData.user?.user_metadata?.trial_intent === true,
        trialWorkspace:
          typeof authData.user?.user_metadata?.trial_workspace === "string"
            ? authData.user.user_metadata.trial_workspace
            : null,
        trialPlan:
          typeof authData.user?.user_metadata?.trial_plan === "string"
            ? authData.user.user_metadata.trial_plan
            : null,
      })

      if (destination === SERVICE_BUSINESS_SETUP_PATH) {
        setTabIndustryMode("service")
        router.replace(destination)
        return
      }

      if (destination.startsWith("/service/") || destination.startsWith("/retail/")) {
        const all = await getAllUserBusinesses(supabase, userId)
        if (all.length === 1) {
          const biz = all[0]
          setSelectedBusinessId(biz.id)
          setTabIndustryMode(biz.industry ?? "service")
        } else if (all.length > 1) {
          const preferredId = getSelectedBusinessId()
          const preferred = preferredId ? all.find((b) => b.id === preferredId) : null
          if (preferred) {
            setTabIndustryMode(preferred.industry ?? "service")
          }
        }
        router.replace(destination)
        return
      }

      router.replace(destination)
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
