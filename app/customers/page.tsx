"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

export default function CustomersPage() {
  const router = useRouter()

  useEffect(() => {
    const resolveRedirect = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData?.session?.user?.id ?? null

      if (!userId) {
        router.replace("/login")
        return
      }

      const business = await getCurrentBusiness(supabase, userId)
      const customersRoute =
        business?.industry === "retail"
          ? "/retail/customers"
          : "/service/customers"

      router.replace(customersRoute)
    }

    resolveRedirect()
  }, [router])

  return (
    <div className="flex items-center justify-center h-screen">
      <p>Redirecting...</p>
    </div>
  )
}
