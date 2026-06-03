"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { replaceIfChanged } from "@/lib/navigation/safeReplace"

export default function ServiceEstimateCreateRedirect() {
  const router = useRouter()
  const pathname = usePathname() ?? "/service/estimates/create"

  useEffect(() => {
    replaceIfChanged(router, pathname, "", "/service/estimates/new")
  }, [router, pathname])

  return (
    <div className="p-6">
      <p>Redirecting...</p>
    </div>
  )
}

