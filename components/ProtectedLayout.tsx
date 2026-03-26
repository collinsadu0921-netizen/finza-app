"use client"

import { Suspense, createContext, useContext, useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, usePathname } from "next/navigation"
import { ServiceSubscriptionProvider } from "@/components/service/ServiceSubscriptionContext"
import StoreSwitcher from "./StoreSwitcher"
import Sidebar from "./Sidebar"
import { isCashierAuthenticated } from "@/lib/cashierSession"
import { resolveAccess } from "@/lib/accessControl"
import { autoBindSingleStore } from "@/lib/autoBindStore"
import { useExportMode } from "@/lib/hooks/useExportMode"
import RetailPosIdleSessionWatcher from "@/components/RetailPosIdleSessionWatcher"
import AppIdleTimeoutWatcher from "@/components/AppIdleTimeoutWatcher"

const ProtectedLayoutContext = createContext(false)

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const isNestedProtectedLayout = useContext(ProtectedLayoutContext)
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(isNestedProtectedLayout ? false : true)
  const isExportMode = useExportMode()
  const isPOSRoute = pathname?.startsWith("/pos")
  const isAccountingRoute = pathname?.startsWith("/accounting")

  useEffect(() => {
    // Nested usage should be a transparent wrapper to prevent duplicate chrome.
    if (isNestedProtectedLayout) {
      if (loading) setLoading(false)
      return
    }

    let isMounted = true
    
    async function checkAccess() {
      // CENTRALIZED ACCESS CONTROL: Single source of truth for all access decisions
      // This function evaluates ALL conditions (auth, role, workspace, route, store) in ONE place
      // Redirects happen HERE ONLY - no other guards should redirect
      
      console.log("ProtectedLayout: Resolving access for", pathname)
      
      // Get user ID from session
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      
      if (!isMounted) return
      
      if (sessionError) {
        console.error("ProtectedLayout: Session error:", sessionError)
        setLoading(false)
        router.push("/login")
        return
      }
      
      const userId = sessionData?.session?.user?.id || null
      
      // STORE CONTEXT AUTO-BIND: Auto-set activeStoreId if user has exactly one store
      // This prevents unnecessary redirects to /select-store for single-store users
      if (userId) {
        await autoBindSingleStore(supabase, userId)
      }
      
      // CENTRALIZED ACCESS RESOLUTION: Single function makes ALL access decisions
      const decision = await resolveAccess(supabase, userId, pathname || "")
      
      if (!isMounted) return
      
      if (typeof window !== "undefined" && process.env.NODE_ENV === "development" && pathname?.startsWith("/accounting")) {
        console.log("[ProtectedLayout] accounting decision", { allowed: decision.allowed, redirectTo: decision.redirectTo, reason: decision.reason })
      }
      
      if (!decision.allowed) {
        // SINGLE REDIRECT POINT: All redirects happen here only
        const redirectTo = decision.redirectTo || "/login"
        console.log(`ProtectedLayout: Access denied (${decision.reason}), redirecting to ${redirectTo}`)
        setLoading(false)
        router.push(redirectTo)
        return
      }
      
      console.log("ProtectedLayout: Access granted")
      setLoading(false)
    }
    
    checkAccess()
    
    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false
    }
  }, [router, pathname, isNestedProtectedLayout, loading])

  if (isNestedProtectedLayout) {
    return <>{children}</>
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <p className="p-6">Loading...</p>
      </div>
    )
  }

  const cashierAuth = isCashierAuthenticated()

  return (
    <ProtectedLayoutContext.Provider value={true}>
      <Suspense fallback={null}>
        <ServiceSubscriptionProvider>
          <RetailPosIdleSessionWatcher pathname={pathname} />
          <AppIdleTimeoutWatcher pathname={pathname} />
          <div
            className="min-h-screen bg-gray-50 dark:bg-gray-900"
            data-export-mode={isExportMode ? "true" : undefined}
          >
            {/* Sidebar - hidden in print/export/preview (export-hide) */}
            {!cashierAuth && !isAccountingRoute && (
              <div className="export-hide print-hide">
                <Sidebar />
              </div>
            )}

            {/* Main Layout */}
            <div className={cashierAuth || isAccountingRoute ? "" : "lg:pl-64"}>
          {/* Top navigation for non-accounting workspaces. */}
          {!cashierAuth && !pathname?.startsWith('/service') && !isAccountingRoute && (
            <nav className="export-hide print-hide bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm sticky top-0 z-30">
              <div className="px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                  <div className="flex items-center gap-4">
                    {/* Mobile menu button - will be handled by Sidebar component */}
                  </div>
                  <div className="flex items-center gap-4">
                    {!isPOSRoute && <StoreSwitcher />}
                  </div>
                </div>
              </div>
            </nav>
          )}

          {/* Main content */}
          <main className={pathname?.startsWith('/service') ? "min-h-screen" : "min-h-[calc(100vh-4rem)]"}>
            {children}
          </main>
            </div>
          </div>
        </ServiceSubscriptionProvider>
      </Suspense>
    </ProtectedLayoutContext.Provider>
  )
}
















