"use client"

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, usePathname } from "next/navigation"
import { ServiceSubscriptionProvider } from "@/components/service/ServiceSubscriptionContext"
import ServiceWorkspaceSubscriptionBanners from "@/components/service/ServiceWorkspaceSubscriptionBanners"
import StoreSwitcher from "./StoreSwitcher"
import Sidebar from "./Sidebar"
import { isCashierAuthenticated } from "@/lib/cashierSession"
import { resolveAccess, isPosSurfacePath } from "@/lib/accessControl"
import { getUserRole } from "@/lib/userRoles"
import { autoBindSingleStore } from "@/lib/autoBindStore"
import { useExportMode } from "@/lib/hooks/useExportMode"
import RetailPosIdleSessionWatcher from "@/components/RetailPosIdleSessionWatcher"
import AppIdleTimeoutWatcher from "@/components/AppIdleTimeoutWatcher"
import { getCurrentBusiness } from "@/lib/business"
import AiAssistant from "@/components/AiAssistant"
import {
  WorkspaceBusinessProvider,
  type WorkspaceBusiness,
  type WorkspaceSessionUser,
} from "@/components/WorkspaceBusinessContext"
import PlatformAnnouncementsHost from "@/components/platform/PlatformAnnouncementsHost"
import { fetchAssistantBusinessSnapshot } from "@/components/ProtectedLayout-assistantSnapshot"

const ProtectedLayoutContext = createContext(false)

function clearWorkspaceAndAssistantState(params: {
  setRestrictRetailCashierChrome: (v: boolean) => void
  setWorkspaceBusiness: (v: WorkspaceBusiness) => void
  setWorkspaceSessionUser: (v: WorkspaceSessionUser) => void
  setAiBusinessId: (v: string | null) => void
  setAiContext: (v: Record<string, unknown> | null) => void
  setAssistantContextLoading: (v: boolean) => void
  aiBusinessIdRef: MutableRefObject<string | null>
  assistantContextCacheBusinessIdRef: MutableRefObject<string | null>
  assistantCachedPayloadRef: MutableRefObject<Record<string, unknown> | null>
  assistantContextLoadInflightRef: MutableRefObject<Promise<Record<string, unknown> | undefined> | null>
}) {
  params.setRestrictRetailCashierChrome(false)
  params.setWorkspaceBusiness(null)
  params.setWorkspaceSessionUser(null)
  params.setAiBusinessId(null)
  params.aiBusinessIdRef.current = null
  params.setAiContext(null)
  params.setAssistantContextLoading(false)
  params.assistantContextCacheBusinessIdRef.current = null
  params.assistantCachedPayloadRef.current = null
  params.assistantContextLoadInflightRef.current = null
}

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const isNestedProtectedLayout = useContext(ProtectedLayoutContext)
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(isNestedProtectedLayout ? false : true)
  /** True only while handling session error or denied access before navigation (never show protected shell). */
  const [redirectBanner, setRedirectBanner] = useState(false)
  const [aiBusinessId, setAiBusinessId] = useState<string | null>(null)
  const [aiContext, setAiContext] = useState<Record<string, unknown> | null>(null)
  const [assistantContextLoading, setAssistantContextLoading] = useState(false)
  const aiBusinessIdRef = useRef<string | null>(null)
  /** Business id whose assistant snapshot row caps were last fetched into `aiContext` */
  const assistantContextCacheBusinessIdRef = useRef<string | null>(null)
  /** Latest successful snapshot payload (mirrors merged assistant context for API calls before re-render). */
  const assistantCachedPayloadRef = useRef<Record<string, unknown> | null>(null)
  const assistantContextLoadInflightRef =
    useRef<Promise<Record<string, unknown> | undefined> | null>(null)

  useEffect(() => {
    aiBusinessIdRef.current = aiBusinessId
  }, [aiBusinessId])

  /** New workspace clears cached assistant snapshot until the user opens the assistant again */
  useEffect(() => {
    setAiContext(null)
    assistantContextCacheBusinessIdRef.current = null
    assistantCachedPayloadRef.current = null
    assistantContextLoadInflightRef.current = null
    setAssistantContextLoading(false)
  }, [aiBusinessId])
  const [workspaceBusiness, setWorkspaceBusiness] = useState<WorkspaceBusiness>(null)
  const [workspaceSessionUser, setWorkspaceSessionUser] = useState<WorkspaceSessionUser>(null)
  /** DB role cashier on a retail business — hide owner sidebar/nav (parallel to PIN session chrome). */
  const [restrictRetailCashierChrome, setRestrictRetailCashierChrome] = useState(false)
  const [cashierSessionBump, setCashierSessionBump] = useState(0)
  /** Bumped when pathname / cashier bump changes so in-flight checkAccess can bail (avoids stale state + UI flicker). */
  const layoutAccessEpochRef = useRef(0)
  const isExportMode = useExportMode()
  const isPOSRoute = isPosSurfacePath(pathname ?? "")
  const cashierAuth = isCashierAuthenticated()
  /** Cashier PIN entry — no session yet, so still hide owner shell (kiosk / shared register). */
  const rawPath = pathname?.split("?")[0] ?? ""
  const pathNoTrailing = rawPath.replace(/\/$/, "") || "/"
  const isRetailCashierPinScreen =
    pathNoTrailing === "/retail/pos/pin" || pathNoTrailing === "/pos/pin"
  /** Hide sidebar + top bar: active PIN session, DB cashier role, or cashier PIN login route */
  const hideRetailOwnerChrome =
    cashierAuth || restrictRetailCashierChrome || isRetailCashierPinScreen
  /** Hide floating assistant on POS paths and whenever retail cashier / PIN session uses the restricted shell */
  const hideFloatingAssistant =
    pathname?.startsWith("/retail/pos") ||
    pathname?.startsWith("/pos/") ||
    hideRetailOwnerChrome
  const isAccountingRoute = pathname?.startsWith("/accounting")

  useEffect(() => {
    // Nested usage should be a transparent wrapper to prevent duplicate chrome.
    if (isNestedProtectedLayout) {
      if (loading) setLoading(false)
      return
    }

    const epoch = ++layoutAccessEpochRef.current
    let isMounted = true

    const stale = () => !isMounted || layoutAccessEpochRef.current !== epoch

    async function checkAccess() {
      // CENTRALIZED ACCESS CONTROL: Single source of truth for all access decisions
      // This function evaluates ALL conditions (auth, role, workspace, route, store) in ONE place
      // Redirects happen HERE ONLY - no other guards should redirect

      setRedirectBanner(false)

      console.log("ProtectedLayout: Resolving access for", pathname)

      // Get user ID from session
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

      if (stale()) return

      if (sessionError) {
        console.error("ProtectedLayout: Session error:", sessionError)
        if (stale()) return
        setRedirectBanner(true)
        clearWorkspaceAndAssistantState({
          setRestrictRetailCashierChrome,
          setWorkspaceBusiness,
          setWorkspaceSessionUser,
          setAiBusinessId,
          setAiContext,
          setAssistantContextLoading,
          aiBusinessIdRef,
          assistantContextCacheBusinessIdRef,
          assistantCachedPayloadRef,
          assistantContextLoadInflightRef,
        })
        router.replace("/login")
        return
      }
      
      const userId = sessionData?.session?.user?.id || null
      
      // STORE CONTEXT AUTO-BIND: Auto-set activeStoreId if user has exactly one store
      // This prevents unnecessary redirects to /select-store for single-store users
      if (userId) {
        await autoBindSingleStore(supabase, userId)
      }

      if (stale()) return
      
      // CENTRALIZED ACCESS RESOLUTION: Single function makes ALL access decisions
      const decision = await resolveAccess(supabase, userId, pathname || "")
      
      if (stale()) return
      
      if (typeof window !== "undefined" && process.env.NODE_ENV === "development" && pathname?.startsWith("/accounting")) {
        console.log("[ProtectedLayout] accounting decision", { allowed: decision.allowed, redirectTo: decision.redirectTo, reason: decision.reason })
      }
      
      if (!decision.allowed) {
        // SINGLE REDIRECT POINT: All redirects happen here only
        if (stale()) return
        const redirectTo = decision.redirectTo || "/login"
        console.log(`ProtectedLayout: Access denied (${decision.reason}), redirecting to ${redirectTo}`)
        setRedirectBanner(true)
        clearWorkspaceAndAssistantState({
          setRestrictRetailCashierChrome,
          setWorkspaceBusiness,
          setWorkspaceSessionUser,
          setAiBusinessId,
          setAiContext,
          setAssistantContextLoading,
          aiBusinessIdRef,
          assistantContextCacheBusinessIdRef,
          assistantCachedPayloadRef,
          assistantContextLoadInflightRef,
        })
        router.replace(redirectTo)
        return
      }

      if (userId) {
        try {
          const business = await getCurrentBusiness(supabase, userId)
          if (stale()) return
          setAiBusinessId(business?.id || null)
          setWorkspaceBusiness((business as WorkspaceBusiness) ?? null)
          setWorkspaceSessionUser(
            sessionData?.session?.user
              ? {
                  id: sessionData.session.user.id,
                  email: sessionData.session.user.email,
                  user_metadata: sessionData.session.user.user_metadata,
                }
              : null
          )
          let restrictChrome = false
          if (business?.id && (business.industry || "").toLowerCase() === "retail") {
            const role = await getUserRole(supabase, userId, business.id)
            restrictChrome = role === "cashier"
          }
          if (!stale()) setRestrictRetailCashierChrome(restrictChrome)
        } catch (error) {
          console.error("ProtectedLayout: Failed to resolve business for AI context", error)
          if (!stale()) {
            setAiBusinessId(null)
            setWorkspaceBusiness(null)
            setWorkspaceSessionUser(null)
            setRestrictRetailCashierChrome(false)
          }
        }
      } else if (!stale()) {
        setWorkspaceBusiness(null)
        setWorkspaceSessionUser(null)
        setRestrictRetailCashierChrome(false)
      }
      
      if (stale()) return
      console.log("ProtectedLayout: Access granted")
      setRedirectBanner(false)
      setLoading(false)
    }
    
    checkAccess()
    
    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false
    }
    // Note: do not depend on `loading` — setting loading false here would re-fire this effect and re-run
    // resolveAccess + getUserRole, which caused visible retail UI flicker.
  }, [router, pathname, isNestedProtectedLayout, cashierSessionBump])

  useEffect(() => {
    if (typeof window === "undefined") return
    const onCashierSession = () => setCashierSessionBump((n) => n + 1)
    window.addEventListener("cashierSessionChanged", onCashierSession)
    return () => window.removeEventListener("cashierSessionChanged", onCashierSession)
  }, [])

  const ensureAssistantContextLoaded = useCallback(async (): Promise<
    Record<string, unknown> | undefined
  > => {
    const bid = aiBusinessIdRef.current
    if (!bid || isNestedProtectedLayout) return undefined

    if (
      assistantContextCacheBusinessIdRef.current === bid &&
      assistantCachedPayloadRef.current !== null
    ) {
      return assistantCachedPayloadRef.current
    }

    const inflight = assistantContextLoadInflightRef.current
    if (inflight) {
      await inflight
      if (aiBusinessIdRef.current !== bid) return undefined
      return assistantCachedPayloadRef.current ?? undefined
    }

    const capturedBid = bid
    const promise = (async (): Promise<Record<string, unknown> | undefined> => {
      setAssistantContextLoading(true)
      const t0 = typeof performance !== "undefined" ? performance.now() : 0
      try {
        const snapshot = await fetchAssistantBusinessSnapshot(supabase, capturedBid)
        if (aiBusinessIdRef.current !== capturedBid) return undefined
        const row = snapshot as Record<string, unknown>
        assistantCachedPayloadRef.current = row
        setAiContext(row)
        assistantContextCacheBusinessIdRef.current = capturedBid
        if (process.env.NODE_ENV !== "production") {
          const elapsed = typeof performance !== "undefined" ? performance.now() - t0 : 0
          console.debug(
            `[ProtectedLayout] Assistant business snapshot loaded in ${Math.round(elapsed)}ms (capped sampling; ids not logged)`
          )
        }
        return row
      } catch (error) {
        console.error("ProtectedLayout: Failed to load assistant business snapshot", error)
        if (aiBusinessIdRef.current !== capturedBid) return undefined
        const fallback: Record<string, unknown> = {
          generated_at: new Date().toISOString(),
          business_id: capturedBid,
          page_scope: "global",
          warning: "Some context data could not be loaded.",
        }
        assistantCachedPayloadRef.current = fallback
        setAiContext(fallback)
        assistantContextCacheBusinessIdRef.current = capturedBid
        return fallback
      } finally {
        if (aiBusinessIdRef.current === capturedBid) {
          setAssistantContextLoading(false)
        }
      }
    })()

    assistantContextLoadInflightRef.current = promise
    try {
      return await promise
    } finally {
      if (assistantContextLoadInflightRef.current === promise) {
        assistantContextLoadInflightRef.current = null
      }
    }
  }, [isNestedProtectedLayout])

  if (isNestedProtectedLayout) {
    return <>{children}</>
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <p className="p-6">{redirectBanner ? "Redirecting…" : "Loading..."}</p>
      </div>
    )
  }

  const invoiceIdFromPath =
    pathname?.match(/\/service\/invoices\/([0-9a-f-]{36})\/(?:view|edit)/i)?.[1] ?? null

  return (
    <ProtectedLayoutContext.Provider value={true}>
      <WorkspaceBusinessProvider
        value={{ business: workspaceBusiness, sessionUser: workspaceSessionUser }}
      >
      <Suspense fallback={null}>
        <ServiceSubscriptionProvider>
          <RetailPosIdleSessionWatcher pathname={pathname} />
          <AppIdleTimeoutWatcher pathname={pathname} />
          <div
            className="min-h-screen bg-gray-50 dark:bg-gray-900"
            data-export-mode={isExportMode ? "true" : undefined}
          >
            <ServiceWorkspaceSubscriptionBanners
              contentOffsetClassName={hideRetailOwnerChrome || isAccountingRoute ? "" : "lg:pl-64"}
            />
            {/* Sidebar - hidden in print/export/preview (export-hide) */}
            {!hideRetailOwnerChrome && !isAccountingRoute && (
              <div className="export-hide print-hide">
                <Sidebar />
              </div>
            )}

            {/* Main Layout */}
            <div className={hideRetailOwnerChrome || isAccountingRoute ? "" : "lg:pl-64"}>
          {/* Top navigation for non-accounting workspaces. */}
          {!hideRetailOwnerChrome && !pathname?.startsWith('/service') && !isAccountingRoute && (
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

          {/* Main content — full height when owner top nav is hidden (PIN, POS shell, cashier) */}
          <main
            className={
              pathname?.startsWith("/service")
                ? "min-h-screen"
                : hideRetailOwnerChrome
                  ? "min-h-screen"
                  : "min-h-[calc(100vh-4rem)]"
            }
          >
            <PlatformAnnouncementsHost
              businessIndustry={
                workspaceBusiness != null && typeof workspaceBusiness.industry === "string"
                  ? workspaceBusiness.industry
                  : undefined
              }
            >
              {children}
            </PlatformAnnouncementsHost>
            {!hideFloatingAssistant && (
              <div className="fixed bottom-3 right-3 z-40 w-auto max-w-[calc(100vw-1.5rem)] print-hide">
                <AiAssistant
                  ensureAssistantContext={ensureAssistantContextLoaded}
                  assistantContextLoading={assistantContextLoading}
                  context={{
                    business_id: aiBusinessId ?? undefined,
                    ...(aiContext ?? {}),
                    current_path: pathname || "/",
                    ...(invoiceIdFromPath ? { page_invoice_id: invoiceIdFromPath } : {}),
                  }}
                />
              </div>
            )}
          </main>
            </div>
          </div>
        </ServiceSubscriptionProvider>
      </Suspense>
      </WorkspaceBusinessProvider>
    </ProtectedLayoutContext.Provider>
  )
}
















