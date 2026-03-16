"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import ServiceDashboardCockpit from "@/components/dashboard/service/ServiceDashboardCockpit"
import ServiceDashboardSkeleton from "@/components/dashboard/service/ServiceDashboardSkeleton"

export default function ServiceDashboardPage() {
  const [business, setBusiness] = useState<{ id: string; default_currency?: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadBusiness() {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData?.session?.user?.id
      if (!userId) {
        setLoading(false)
        return
      }

      const { data } = await supabase
        .from("businesses")
        .select("id, default_currency")
        .eq("owner_id", userId)
        .maybeSingle()

      setBusiness(data)
      setLoading(false)
    }

    loadBusiness()
  }, [])

  if (loading || !business) {
    return (
      <div className="p-6">
        <ServiceDashboardSkeleton />
      </div>
    )
  }

  return (
    <div className="p-6">
      <ServiceDashboardCockpit business={business} />
    </div>
  )
}

