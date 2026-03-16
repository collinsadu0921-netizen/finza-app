"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

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

      const business = await getCurrentBusiness(supabase, userId)
      const landing =
        business?.industry === "retail"
          ? "/retail/dashboard"
          : "/service/dashboard"

      router.replace(landing)
    }

    resolveLanding()
  }, [router])

  return (
    <div className="flex items-center justify-center h-screen">
      <p>Redirecting...</p>
    </div>
  )
}













