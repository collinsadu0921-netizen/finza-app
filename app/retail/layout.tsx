"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { setTabIndustryMode } from "@/lib/industryMode"

export default function RetailLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isPublicInvite = pathname === "/retail/invite" || pathname.startsWith("/retail/invite/")

  useEffect(() => {
    if (!isPublicInvite) setTabIndustryMode("retail")
  }, [isPublicInvite])

  if (isPublicInvite) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">
        {children}
      </div>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50 text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">
        {children}
      </div>
    </ProtectedLayout>
  )
}
