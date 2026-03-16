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

  return <ProtectedLayout>{children}</ProtectedLayout>
}
