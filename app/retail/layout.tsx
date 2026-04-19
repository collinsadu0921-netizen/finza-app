"use client"

import { useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { setTabIndustryMode } from "@/lib/industryMode"

export default function RetailLayout({
  children,
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    setTabIndustryMode("retail")
  }, [])

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50 text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">
        {children}
      </div>
    </ProtectedLayout>
  )
}
