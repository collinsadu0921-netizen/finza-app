"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, usePathname } from "next/navigation"
import StoreSwitcher from "./StoreSwitcher"
import ClientSelector from "./ClientSelector"
import FirmSelector from "./FirmSelector"
import FirmRoleBadge from "./FirmRoleBadge"
import ClientContextWarning from "./ClientContextWarning"
import AccountingBreadcrumbs from "./AccountingBreadcrumbs"
import Sidebar from "./Sidebar"
import { isCashierAuthenticated } from "@/lib/cashierSession"
import { resolveAccess, getHomeRouteForRole, getWorkspaceFromPath } from "@/lib/accessControl"
import { autoBindSingleStore } from "@/lib/autoBindStore"
import { useExportMode } from "@/lib/hooks/useExportMode"

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(true)
  const isExportMode = useExportMode()
  const isPOSRoute = pathname?.startsWith("/pos")

  useEffect(() => {
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
  }, [router, pathname])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <p className="p-6">Loading...</p>
      </div>
    )
  }

  const cashierAuth = isCashierAuthenticated()

  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-gray-900"
      data-export-mode={isExportMode ? "true" : undefined}
    >
      {/* Sidebar - hidden in print/export/preview (export-hide) */}
      {!cashierAuth && (
        <div className="export-hide print-hide">
          <Sidebar />
        </div>
      )}

      {/* Main Layout */}
      <div className={cashierAuth ? "" : "lg:pl-64"}>
        {/* Top Navigation Bar — shown on accounting routes and non-service paths only.
            On /service/* the bar is empty (no accounting selectors, logout moved to sidebar)
            so we hide it to reclaim vertical space. */}
        {!cashierAuth && !pathname?.startsWith('/service') && (
          <nav className="export-hide print-hide bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm sticky top-0 z-30">
            <div className="px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <div className="flex items-center gap-4">
                  {/* Mobile menu button - will be handled by Sidebar component */}
                </div>
                <div className="flex items-center gap-4">
                  {!isPOSRoute && <StoreSwitcher />}
                  {/* Accounting workspace only: firm/client UI. /service/* uses business context only (no FirmSelector/ClientSelector). */}
                  {pathname?.startsWith('/accounting') && <FirmSelector />}
                  {pathname?.startsWith('/accounting') && <FirmRoleBadge />}
                  {pathname?.startsWith('/accounting') && <ClientSelector />}
                </div>
              </div>
            </div>
          </nav>
        )}

        {/* Main Content - Accounting breadcrumbs/warning only for /accounting/*; /service/* uses BusinessLayout mode (no firm chrome). */}
        <main className={pathname?.startsWith('/service') ? "min-h-screen" : "min-h-[calc(100vh-4rem)]"}>
          {pathname?.startsWith('/accounting') && (
            <>
              <div className="export-hide print-hide">
                <AccountingBreadcrumbs />
              </div>
              <div className="export-hide print-hide">
                <ClientContextWarning />
              </div>
            </>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}
















