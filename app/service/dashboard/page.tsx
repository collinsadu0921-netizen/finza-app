"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useWorkspaceBusiness } from "@/components/WorkspaceBusinessContext"
import ServiceDashboardCockpit from "@/components/dashboard/service/ServiceDashboardCockpit"
import ServiceDashboardSkeleton from "@/components/dashboard/service/ServiceDashboardSkeleton"

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

type BusinessState = {
  id: string
  default_currency?: string
  trading_name?: string
  legal_name?: string
  name?: string
}

export default function ServiceDashboardPage() {
  const router = useRouter()
  const { business: ctxBusiness, sessionUser } = useWorkspaceBusiness()
  const [localBusiness, setLocalBusiness] = useState<BusinessState | null>(null)
  const [localUserName, setLocalUserName] = useState<string | null>(null)
  const [fallbackLoading, setFallbackLoading] = useState(() => !ctxBusiness?.id)

  const business = useMemo((): BusinessState | null => {
    if (ctxBusiness?.id) return ctxBusiness as BusinessState
    return localBusiness
  }, [ctxBusiness, localBusiness])

  const userNameFromCtx = useMemo(() => {
    if (!sessionUser) return null
    const meta = sessionUser.user_metadata as Record<string, string> | undefined
    return (
      meta?.full_name ??
      meta?.name ??
      (sessionUser.email ? sessionUser.email.split("@")[0] : null)
    )
  }, [sessionUser])

  const userName = userNameFromCtx ?? localUserName

  useEffect(() => {
    if (ctxBusiness?.id) {
      setFallbackLoading(false)
      return
    }

    let cancelled = false

    async function loadDashboard() {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const user = sessionData?.session?.user
        if (!user) {
          if (!cancelled) setFallbackLoading(false)
          return
        }

        const meta = user.user_metadata as Record<string, string> | undefined
        const displayName =
          meta?.full_name ??
          meta?.name ??
          (user.email ? user.email.split("@")[0] : null)
        if (!cancelled) setLocalUserName(displayName)

        const biz = await getCurrentBusiness(supabase, user.id)
        if (!cancelled && !biz) {
          router.replace("/business-setup")
          return
        }
        if (!cancelled) {
          setLocalBusiness(biz as BusinessState | null)
        }
      } catch (error) {
        console.error("Failed to load dashboard:", error)
      } finally {
        if (!cancelled) setFallbackLoading(false)
      }
    }

    loadDashboard()
    return () => {
      cancelled = true
    }
  }, [ctxBusiness?.id, router])

  const showSkeleton = fallbackLoading || !business

  if (showSkeleton) {
    return (
      <div className="p-6">
        <ServiceDashboardSkeleton />
      </div>
    )
  }

  const bizName =
    business.trading_name ?? business.legal_name ?? business.name ?? "your business"

  const firstName = userName?.split(" ")[0] ?? null

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-0.5">
            {getGreeting()}{firstName ? `, ${firstName}` : ""}
          </p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {bizName}
          </h1>
        </div>
        <p className="text-xs text-slate-400 hidden sm:block">
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      <ServiceDashboardCockpit business={business} />
    </div>
  )
}
