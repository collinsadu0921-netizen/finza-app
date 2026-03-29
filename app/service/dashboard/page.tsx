"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import ServiceDashboardCockpit from "@/components/dashboard/service/ServiceDashboardCockpit"
import ServiceDashboardSkeleton from "@/components/dashboard/service/ServiceDashboardSkeleton"

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

export default function ServiceDashboardPage() {
  const [business, setBusiness] = useState<{ id: string; default_currency?: string; trading_name?: string; legal_name?: string; name?: string } | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadDashboard() {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const user = sessionData?.session?.user
        if (!user) {
          setLoading(false)
          return
        }

        // Derive a display name from auth metadata
        const meta = user.user_metadata as Record<string, string> | undefined
        const displayName =
          meta?.full_name ??
          meta?.name ??
          (user.email ? user.email.split("@")[0] : null)
        setUserName(displayName)

        const biz = await getCurrentBusiness(supabase, user.id)
        setBusiness(biz as any)
      } catch (error) {
        console.error("Failed to load dashboard:", error)
      } finally {
        setLoading(false)
      }
    }

    loadDashboard()
  }, [])

  if (loading || !business) {
    return (
      <div className="p-6">
        <ServiceDashboardSkeleton />
      </div>
    )
  }

  const bizName =
    (business as any).trading_name ??
    (business as any).legal_name ??
    (business as any).name ??
    "your business"

  const firstName = userName?.split(" ")[0] ?? null

  return (
    <div className="p-6 space-y-5">
      {/* Personalised greeting */}
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
