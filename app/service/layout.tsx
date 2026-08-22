"use client"

import { Suspense, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { ServiceWalkthroughProvider } from "@/components/service/walkthrough/ServiceWalkthroughProvider"
import { setTabIndustryMode } from "@/lib/industryMode"
import { ensureSharedJsonGetAuthBoundary } from "@/lib/client/sharedJsonGetAuthBoundary"

export default function ServiceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    setTabIndustryMode("service")
    ensureSharedJsonGetAuthBoundary()
  }, [])

  return (
    <ProtectedLayout>
      <ServiceWalkthroughProvider>
        <Suspense fallback={null}>{children}</Suspense>
      </ServiceWalkthroughProvider>
    </ProtectedLayout>
  )
}
