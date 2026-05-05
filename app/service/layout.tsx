"use client"

import { Suspense, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { ServiceWalkthroughProvider } from "@/components/service/walkthrough/ServiceWalkthroughProvider"
import { setTabIndustryMode } from "@/lib/industryMode"

export default function ServiceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    setTabIndustryMode("service")
  }, [])

  return (
    <ProtectedLayout>
      <Suspense fallback={null}>
        <ServiceWalkthroughProvider>{children}</ServiceWalkthroughProvider>
      </Suspense>
    </ProtectedLayout>
  )
}
