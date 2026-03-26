"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import WorkspaceSidebar from "@/components/accounting/WorkspaceSidebar"
import PermissionVisibilityBanner from "@/components/accounting/PermissionVisibilityBanner"
import ServiceOwnerAccountingBanner from "@/components/accounting/ServiceOwnerAccountingBanner"

type AccountingWorkspaceShellProps = {
  children: React.ReactNode
}

type FirmRow = {
  firm_id: string
  firm_name: string
}

type ClientRow = {
  business_id: string
}

type RequestRow = {
  status: string
}

type WorkItemRow = {
  id: string
}

const CLIENT_DEPENDENT_ROUTES = [
  "/accounting/tasks",
  "/accounting/requests",
  "/accounting/filings",
  "/accounting/documents",
]

function isClientDependentRoute(pathname: string): boolean {
  return CLIENT_DEPENDENT_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

function getPageTitle(pathname: string, hasClientSelected: boolean): string {
  if (hasClientSelected) return "Client Workspace"
  if (pathname.startsWith("/accounting/clients")) return "Clients"
  return "Firm Dashboard"
}

export default function AccountingWorkspaceShell({ children }: AccountingWorkspaceShellProps) {
  const pathname = usePathname() ?? ""
  const searchParams = useSearchParams()
  const router = useRouter()
  const businessId = searchParams.get("business_id")?.trim() ?? ""
  const hasClientSelected = Boolean(businessId)
  const isFirmSetupRoute =
    pathname.startsWith("/accounting/firm/setup") || pathname.startsWith("/accounting/firm/onboarding")

  const [loading, setLoading] = useState(true)
  const [firmCount, setFirmCount] = useState(0)
  const [clientCount, setClientCount] = useState(0)
  const [openTasks, setOpenTasks] = useState(0)
  const [openRequests, setOpenRequests] = useState(0)
  const [userInitial, setUserInitial] = useState("U")

  useEffect(() => {
    let mounted = true

    async function loadWorkspaceState() {
      setLoading(true)
      try {
        const { data: authData } = await supabase.auth.getUser()
        if (!mounted) return
        const email = authData.user?.email ?? ""
        setUserInitial(email ? email.charAt(0).toUpperCase() : "U")

        const firmsRes = await fetch("/api/accounting/firm/firms", { cache: "no-store" })
        const firmsJson = firmsRes.ok ? await firmsRes.json() : { firms: [] }
        const firms: FirmRow[] = firmsJson.firms ?? []
        if (!mounted) return
        setFirmCount(firms.length)

        if (firms.length === 0) {
          setClientCount(0)
          setOpenTasks(0)
          setOpenRequests(0)
          return
        }

        const [clientsRes, tasksRes, requestsRes] = await Promise.all([
          fetch("/api/accounting/firm/clients", { cache: "no-store" }),
          fetch("/api/accounting/control-tower/work-items?limit=200", { cache: "no-store" }),
          fetch("/api/accounting/requests", { cache: "no-store" }),
        ])

        if (!mounted) return

        const clientsJson = clientsRes.ok ? await clientsRes.json() : { clients: [] }
        const tasksJson = tasksRes.ok ? await tasksRes.json() : { work_items: [] }
        const requestsJson = requestsRes.ok ? await requestsRes.json() : { requests: [] }

        const clients: ClientRow[] = clientsJson.clients ?? []
        const workItems: WorkItemRow[] = tasksJson.work_items ?? []
        const requests: RequestRow[] = requestsJson.requests ?? []
        setClientCount(clients.length)
        setOpenTasks(workItems.length)
        setOpenRequests(requests.filter((r) => r.status === "open" || r.status === "in_progress").length)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadWorkspaceState()
    return () => {
      mounted = false
    }
  }, [pathname])

  const hasFirm = firmCount > 0
  const pageTitle = useMemo(() => getPageTitle(pathname, hasClientSelected), [pathname, hasClientSelected])
  const shouldGateClientRoute = hasFirm && !hasClientSelected && isClientDependentRoute(pathname)
  const showNoClientDashboard = hasFirm && !hasClientSelected && (pathname === "/accounting/dashboard" || pathname === "/accounting")
  const showSidebar = hasFirm && !isFirmSetupRoute

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-b-2 border-blue-600 animate-spin" />
      </div>
    )
  }

  if (!hasFirm && !isFirmSetupRoute) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-8">
          <p className="text-sm font-semibold text-blue-700 mb-3">Finza</p>
          <h1 className="text-3xl font-semibold text-gray-900 mb-3">Set up your accounting firm</h1>
          <p className="text-gray-600 mb-6">
            Create your firm to start managing clients, filings, and tasks.
          </p>
          <div className="flex flex-wrap gap-3 mb-6">
            <button
              onClick={() => router.push("/accounting/firm/setup")}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium"
            >
              Create Firm
            </button>
            <button
              onClick={() => router.push("/accounting/firm/setup")}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium"
            >
              Join Firm
            </button>
          </div>
          <div className="border-t border-gray-200 pt-4 text-sm text-gray-700 space-y-1">
            <p>What you&apos;ll get:</p>
            <p>- Manage multiple clients</p>
            <p>- Track filings and deadlines</p>
            <p>- Request documents easily</p>
            <p>- Keep everything in one place</p>
          </div>
        </div>
      </div>
    )
  }

  if (isFirmSetupRoute) {
    return <>{children}</>
  }

  return (
    <div data-workspace-mode="accounting" className="bg-gray-100/60 min-h-[calc(100vh-4rem)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {showSidebar && (
            <WorkspaceSidebar hasClientSelected={hasClientSelected} hasFirm={hasFirm} />
          )}
          <main className="min-w-0 flex-1 space-y-4">
            <header className="rounded-xl border border-gray-200 bg-white px-5 py-4 flex items-center justify-between gap-4">
              <h1 className="text-xl font-semibold text-gray-900">{pageTitle}</h1>
              <div className="flex items-center gap-3">
                <input
                  type="search"
                  placeholder="Search"
                  className="h-9 rounded-lg border border-gray-300 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="h-9 w-9 rounded-full bg-gray-900 text-white text-sm font-semibold flex items-center justify-center">
                  {userInitial}
                </div>
              </div>
            </header>

            <ServiceOwnerAccountingBanner />
            <PermissionVisibilityBanner />

            {(showNoClientDashboard || shouldGateClientRoute) ? (
              <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-semibold text-amber-800">No client selected</p>
                  <p className="text-sm text-amber-700 mt-1">
                    Create or select a client to start working.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => router.push("/accounting/firm/clients/add")}
                      className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                    >
                      Create Client
                    </button>
                    <button
                      onClick={() => router.push("/accounting/clients")}
                      className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
                    >
                      View Clients
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <p className="text-sm text-gray-500">Clients</p>
                    <p className="text-2xl font-semibold text-gray-900">{clientCount}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <p className="text-sm text-gray-500">Open Tasks</p>
                    <p className="text-2xl font-semibold text-gray-900">{openTasks}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <p className="text-sm text-gray-500">Open Requests</p>
                    <p className="text-2xl font-semibold text-gray-900">{openRequests}</p>
                  </div>
                </div>

                <div className="text-sm text-gray-700">
                  Suggested next step: <span className="font-medium">Add your first client</span>
                </div>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
