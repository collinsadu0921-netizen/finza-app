"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getAllUserBusinesses, setSelectedBusinessId, clearSelectedBusinessId } from "@/lib/business"
import { setTabIndustryMode, clearTabIndustryMode } from "@/lib/industryMode"
import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"

type WorkspaceBusiness = {
  id: string
  name: string | null
  trading_name: string | null
  legal_name: string | null
  industry: string | null
  logo_url: string | null
  address_city: string | null
  address_region: string | null
  _role: string
}

const INDUSTRY_CONFIG: Record<string, {
  label: string
  color: string
  bg: string
  border: string
  icon: React.ReactNode
}> = {
  service: {
    label: "Service",
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
      </svg>
    ),
  },
  retail: {
    label: "Retail",
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
      </svg>
    ),
  },
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
  cashier: "Cashier",
  employee: "Employee",
  member: "Member",
}

export default function SelectWorkspacePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [businesses, setBusinesses] = useState<WorkspaceBusiness[]>([])
  const [userName, setUserName] = useState<string | null>(null)
  const [selecting, setSelecting] = useState<string | null>(null)

  useEffect(() => {
    init()
  }, [])

  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      router.replace("/login")
      return
    }

    setUserName(session.user.user_metadata?.full_name ?? session.user.email?.split("@")[0] ?? null)

    const all = await getAllUserBusinesses(supabase, session.user.id)
    if (all.length === 0) {
      // No businesses — go to service dashboard (handles new user flow)
      setTabIndustryMode("service")
      router.replace("/service/dashboard")
      return
    }
    if (all.length === 1) {
      // Only one workspace — select it automatically
      await selectWorkspace(all[0])
      return
    }

    setBusinesses(all as WorkspaceBusiness[])
    setLoading(false)
  }

  const selectWorkspace = async (biz: WorkspaceBusiness) => {
    setSelecting(biz.id)
    setSelectedBusinessId(biz.id)
    setTabIndustryMode(biz.industry ?? "service")

    const dashboard = biz.industry === "retail" ? "/retail/dashboard" : "/service/dashboard"
    router.replace(dashboard)
  }

  const handleLogout = async () => {
    clearTabIndustryMode()
    clearSelectedBusinessId()
    await supabase.auth.signOut()
    router.push("/login")
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-slate-700 mx-auto" />
          <p className="mt-3 text-slate-500 text-sm">Loading workspaces…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">

      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto w-full">
        <span className="text-xl font-bold text-slate-800 tracking-tight">FINZA</span>
        <button
          onClick={handleLogout}
          className="text-sm text-slate-400 hover:text-slate-600 flex items-center gap-1.5 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign out
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl">

          {/* Greeting */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-800 text-white text-2xl font-bold mb-4">
              {userName ? userName.charAt(0).toUpperCase() : "F"}
            </div>
            <h1 className="text-2xl font-bold text-slate-800">
              {userName ? `Welcome back, ${userName}` : "Welcome back"}
            </h1>
            <p className="text-slate-500 mt-1.5 text-sm">
              {businesses.length} workspace{businesses.length !== 1 ? "s" : ""} available — choose one to continue
            </p>
          </div>

          {/* Workspace cards */}
          <div className="grid gap-3 sm:grid-cols-2">
            {businesses.map((biz) => {
              const industry = biz.industry ?? "service"
              const cfg = INDUSTRY_CONFIG[industry] ?? INDUSTRY_CONFIG.service
              const displayName = biz.trading_name ?? biz.name ?? biz.legal_name ?? "Business"
              const location = [biz.address_city, biz.address_region].filter(Boolean).join(", ")
              const isSelecting = selecting === biz.id

              return (
                <button
                  key={biz.id}
                  onClick={() => selectWorkspace(biz)}
                  disabled={!!selecting}
                  className="group relative bg-white rounded-2xl border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all duration-150 p-5 text-left disabled:opacity-60 disabled:cursor-wait"
                >
                  {isSelecting && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-2xl">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-700" />
                    </div>
                  )}

                  <div className="flex items-start gap-4">
                    {/* Logo or industry icon */}
                    <div className={`w-12 h-12 rounded-xl ${cfg.bg} ${cfg.border} border flex items-center justify-center shrink-0 ${cfg.color}`}>
                      {biz.logo_url ? (
                        <BusinessLogoDisplay
                          logoUrl={biz.logo_url}
                          businessName={displayName}
                          variant="workspace"
                          rounded="lg"
                          brandingResolved
                        />
                      ) : (
                        cfg.icon
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h2 className="font-bold text-slate-800 truncate">{displayName}</h2>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                          {cfg.label}
                        </span>
                        <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">
                          {ROLE_LABELS[biz._role] ?? biz._role}
                        </span>
                      </div>
                      {location && (
                        <p className="text-xs text-slate-400 mt-1.5 truncate">{location}</p>
                      )}
                    </div>

                    <div className="shrink-0 text-slate-300 group-hover:text-slate-500 transition-colors mt-0.5">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Add workspace hint */}
          <p className="text-center text-xs text-slate-400 mt-8">
            To add a new workspace, contact support or complete onboarding.
          </p>
        </div>
      </main>
    </div>
  )
}
