"use client"

import { useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { setTabIndustryMode } from "@/lib/industryMode"

export default function ServiceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    setTabIndustryMode("service")
  }, [])

  return <ProtectedLayout>{children}</ProtectedLayout>
}
