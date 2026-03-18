"use client"

import { useState, useEffect } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getTabIndustryMode, clearTabIndustryMode } from "@/lib/industryMode"
import { getCurrentBusiness } from "@/lib/business"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { buildServiceRoute } from "@/lib/service/routes"

type MenuSection = {
  title: string
  items: Array<{ label: string; route: string }>
}

export default function Sidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlBusinessId = searchParams.get("business_id")?.trim() ?? null
  const [isOpen, setIsOpen] = useState(false)
  // Initialize from sessionStorage immediately to prevent flash
  const [businessIndustry, setBusinessIndustry] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return getTabIndustryMode()
    }
    return null
  })
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [isAccountantFirmUser, setIsAccountantFirmUser] = useState<boolean>(false)
  const [serviceBusinessId, setServiceBusinessId] = useState<string | null>(null)
  const [businessDisplay, setBusinessDisplay] = useState<{ name: string | null; logo_url: string | null }>({ name: null, logo_url: null })
  const isAccountingPath = pathname?.startsWith("/accounting") ?? false

  // Business ID for canonical accounting links: URL first, then (service owner only, when NOT on accounting) current business.
  // Sidebar may call getCurrentBusiness() ONLY when not on /accounting/* (Wave 11).
  const sidebarBusinessId = urlBusinessId ?? (isAccountantFirmUser ? null : serviceBusinessId)

  useEffect(() => {
    loadIndustry(urlBusinessId, pathname ?? "")
    checkAccountantFirmUser()
  }, [pathname, urlBusinessId])

  // Resolve current service business only when URL has no business_id and not on accounting route.
  // Do NOT run getCurrentBusiness when urlBusinessId exists (e.g. direct /service/* deep link).
  useEffect(() => {
    if (urlBusinessId || isAccountingPath || businessIndustry !== "service" || isAccountantFirmUser) {
      if (urlBusinessId) setServiceBusinessId(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return
        const business = await getCurrentBusiness(supabase, user.id)
        if (!cancelled) {
          setServiceBusinessId(business?.id ?? null)
          setBusinessDisplay(business ? {
            name: business.name ?? (business as any).trading_name ?? null,
            logo_url: (business as any).logo_url ?? null,
          } : { name: null, logo_url: null })
        }
      } catch {
        if (!cancelled) setServiceBusinessId(null)
      }
    })()
    return () => { cancelled = true }
  }, [urlBusinessId, isAccountingPath, businessIndustry, isAccountantFirmUser])

  // Auto-close mobile menu when route changes
  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  const loadIndustry = async (accountingBusinessId: string | null, path: string) => {
    try {
      const { isCashierAuthenticated } = await import("@/lib/cashierSession")
      if (isCashierAuthenticated()) {
        return
      }

      const isServicePath = path.startsWith("/service/")

      // Accounting or service path with business_id in URL: resolve industry from that business so menu renders immediately.
      if ((isAccountingPath || isServicePath) && accountingBusinessId) {
        const { data: business, error } = await supabase
          .from("businesses")
          .select("industry, name, logo_url, trading_name")
          .eq("id", accountingBusinessId)
          .is("archived_at", null)
          .maybeSingle()
        if (business) {
          setBusinessIndustry(business.industry ?? null)
          setBusinessDisplay({
            name: business.name ?? business.trading_name ?? null,
            logo_url: business.logo_url ?? null,
          })
          return
        }
        if (error) console.error("Error loading business for sidebar:", error)
        setBusinessIndustry(null)
        setBusinessDisplay({ name: null, logo_url: null })
        return
      }

      // Non-accounting, non-service path: use industry from sessionStorage only (set by dashboard/layout).
      setBusinessIndustry(getTabIndustryMode())
      setBusinessDisplay({ name: null, logo_url: null })
    } catch (err) {
      console.error("Error loading industry:", err)
      setBusinessIndustry(null)
    }
  }

  const checkAccountantFirmUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setIsAccountantFirmUser(false)
        return
      }

      const { data: firmUsers } = await supabase
        .from("accounting_firm_users")
        .select("firm_id")
        .eq("user_id", user.id)
        .limit(1)

      setIsAccountantFirmUser(!!(firmUsers && firmUsers.length > 0))
    } catch (err) {
      console.error("Error checking accountant firm user:", err)
      setIsAccountantFirmUser(false)
    }
  }

  const toggleSection = (sectionTitle: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionTitle]: !prev[sectionTitle]
    }))
  }

  // Do not block menu when URL has business_id on /service/* (direct deep link).
  const effectiveIndustry = businessIndustry ?? (pathname?.startsWith("/service/") && urlBusinessId ? "service" : null)

  const getMenuSections = (): MenuSection[] => {
    // If industry is not loaded yet and we don't have service deep-link context, return empty array (no menu)
    if (!effectiveIndustry) {
      return []
    }

    if (effectiveIndustry === "service") {
      // Resolve business for service-scoped links (FINANCE & REPORTING and Accounting).
      const effectiveServiceBusinessId = urlBusinessId ?? serviceBusinessId ?? null
      const sections: MenuSection[] = [
        {
          title: "JOB MANAGEMENT",
          items: [
            { label: "Dashboard", route: "/service/dashboard" },
            { label: "Customers", route: "/service/customers" },
            { label: "Quotes", route: "/service/estimates" },
            { label: "Proforma Invoices", route: "/service/proforma" },
            { label: "Jobs", route: "/service/jobs" },
            { label: "Services", route: "/service/services" },
            { label: "Materials", route: "/service/materials" },
            { label: "Inventory", route: "/service/inventory" },
          ],
        },
        {
          title: "BILLING & PAYMENTS",
          items: [
            { label: "Invoices", route: "/service/invoices" },
            { label: "Credit Notes", route: "/credit-notes" },
            { label: "Recurring Invoices", route: "/recurring" },
            { label: "Payments", route: "/service/payments" },
          ],
        },
        {
          title: "COSTS",
          items: [
            { label: "Expenses", route: "/service/expenses" },
            { label: "Supplier Bills", route: "/bills" },
          ],
        },
      ]
      if (!isAccountantFirmUser) {
        const financeItems: Array<{ label: string; route: string }> = [
          { label: "Profit & Loss", route: buildServiceRoute("/service/reports/profit-and-loss", effectiveServiceBusinessId ?? undefined) },
          { label: "Balance Sheet", route: buildServiceRoute("/service/reports/balance-sheet", effectiveServiceBusinessId ?? undefined) },
          { label: "Cash Flow", route: buildServiceRoute("/service/reports/cash-flow", effectiveServiceBusinessId ?? undefined) },
          { label: "Changes in Equity", route: buildServiceRoute("/service/reports/equity-changes", effectiveServiceBusinessId ?? undefined) },
          { label: "VAT Report", route: buildServiceRoute("/reports/vat", effectiveServiceBusinessId ?? undefined) },
          { label: "VAT Returns", route: buildServiceRoute("/vat-returns", effectiveServiceBusinessId ?? undefined) },
          { label: "Assets", route: "/assets" },
          { label: "Payroll", route: "/payroll" },
        ]
        sections.push({
          title: "FINANCE & REPORTING",
          items: financeItems,
        })
      }
      // Service users: use URL business_id first so direct /service/* deep links render without waiting for getCurrentBusiness().
      const accountingBusinessId = isAccountantFirmUser ? sidebarBusinessId : effectiveServiceBusinessId
      const showAccountingSection = isAccountantFirmUser || accountingBusinessId != null
      if (showAccountingSection) {
        const useServiceRoutes = effectiveIndustry === "service" && !isAccountantFirmUser
        const ledgerRoute = useServiceRoutes ? buildServiceRoute("/service/ledger", accountingBusinessId ?? undefined) : buildAccountingRoute("/accounting/ledger", accountingBusinessId ?? undefined)
        const coaRoute = useServiceRoutes ? buildServiceRoute("/service/accounting/chart-of-accounts", accountingBusinessId ?? undefined) : buildAccountingRoute("/accounting/chart-of-accounts", accountingBusinessId ?? undefined)
        const trialBalanceRoute = useServiceRoutes ? buildServiceRoute("/service/reports/trial-balance", accountingBusinessId ?? undefined) : buildAccountingRoute("/accounting/reports/trial-balance", accountingBusinessId ?? undefined)
        const reconciliationRoute = useServiceRoutes ? buildServiceRoute("/service/accounting/reconciliation", accountingBusinessId ?? undefined) : buildAccountingRoute("/accounting/reconciliation", accountingBusinessId ?? undefined)
        const periodsRoute = useServiceRoutes ? buildServiceRoute("/service/accounting/periods", accountingBusinessId ?? undefined) : buildAccountingRoute("/accounting/periods", accountingBusinessId ?? undefined)

        const accountingItems: Array<{ label: string; route: string }> = [
          ...(effectiveIndustry === "service" && !isAccountantFirmUser
            ? [
                { label: "Accounting Portal", route: "/portal/accounting" },
                { label: "Service Accounting", route: "/service/accounting" },
              ]
            : []),
          { label: "General Ledger", route: ledgerRoute },
          { label: "Chart of Accounts", route: coaRoute },
          { label: "Trial Balance", route: trialBalanceRoute },
          { label: "Reconciliation", route: reconciliationRoute },
          { label: "Accounting Periods", route: periodsRoute },
          ...(isAccountantFirmUser === true
            ? [
                { label: "Health", route: buildAccountingRoute("/accounting/health", accountingBusinessId ?? undefined) },
                { label: "Control Tower", route: buildAccountingRoute("/accounting/control-tower") },
                { label: "Forensic Runs", route: "/admin/accounting/forensic-runs" },
                { label: "Tenants", route: "/admin/accounting/tenants" },
              ]
            : []),
        ]
        sections.push({
          title: "Accounting",
          items: accountingItems,
        })
      }
      const settingsAuditRoute = effectiveServiceBusinessId
        ? buildServiceRoute("/service/accounting/audit", effectiveServiceBusinessId)
        : "/service/accounting/audit"
      sections.push({
          title: "SETTINGS",
          items: [
            { label: "Business Profile", route: "/service/settings/business-profile" },
            { label: "Invoice Settings", route: "/service/settings/invoice-settings" },
            { label: "Payment Settings", route: "/service/settings/payments" },
            { label: "WhatsApp Integration", route: "/service/settings/integrations/whatsapp" },
            { label: "Automations", route: "/service/settings/automations" },
            { label: "Staff Management", route: "/service/settings/staff" },
            { label: "Accountant Requests", route: "/service/invitations" },
            { label: "Accounting Activity", route: settingsAuditRoute },
            { label: "System Activity", route: "/audit-log" },
          ],
        })
      return sections
    }

    // Only show retail menu if industry is explicitly "retail"
    if (effectiveIndustry === "retail") {
      return [
        {
          title: "Retail Operations",
          items: [
            { label: "Dashboard", route: "/retail/dashboard" },
            { label: "POS Terminal", route: "/pos" },
            { label: "Open Register Session", route: "/sales/open-session" },
            { label: "Close Register Session", route: "/sales/close-session" },
          ],
        },
        {
          title: "Product & Inventory",
          items: [
            { label: "Products", route: "/inventory" },
            { label: "Categories", route: "/admin/retail/inventory-dashboard" },
            { label: "Inventory", route: "/inventory" },
            { label: "Bulk Import", route: "/admin/retail/bulk-import" },
            { label: "Low Stock Report", route: "/admin/retail/low-stock" },
            { label: "Inventory Dashboard", route: "/admin/retail/inventory-dashboard" },
          ],
        },
        {
          title: "Sales & Reports",
          items: [
            { label: "Analytics Dashboard", route: "/admin/retail/analytics" },
            { label: "Sales History", route: "/sales-history" },
            { label: "View Profit & Loss", route: "/admin/retail/analytics" },
            { label: "View Balance Sheet", route: "/admin/retail/analytics" },
            { label: "Register Reports", route: "/sales-history" },
            { label: "VAT Report", route: "/reports/vat" },
          ],
        },
        {
          title: "Customers & Suppliers",
          items: [
            { label: "Customers", route: "/retail/customers" },
            { label: "Suppliers", route: "/admin/retail/suppliers" },
            { label: "Purchase Orders", route: "/admin/retail/purchase-orders" },
          ],
        },
        {
          title: "Settings",
          items: [
            { label: "Business Profile", route: "/retail/settings/business-profile" },
            { label: "Stores", route: "/retail/admin/stores" },
            { label: "Receipt Settings", route: "/retail/admin/receipt-settings" },
            { label: "Manage Registers", route: "/retail/admin/registers" },
            { label: "Payment Settings", route: "/retail/admin/payment-settings" },
            { label: "Staff Management", route: "/retail/admin/staff" },
          ],
        },
      ]
    }

    // Logistics menu (if needed)
    if (businessIndustry === "logistics") {
      return [
        {
          title: "Rider Management",
          items: [
            { label: "Rider Dashboard", route: "/rider/dashboard" },
            { label: "Riders", route: "/rider/riders" },
            { label: "Deliveries", route: "/rider/deliveries" },
          ],
        },
        {
          title: "Settings",
          items: [
            { label: "Business Profile", route: "/settings/business-profile" },
          ],
        },
      ]
    }

    // Default: return empty array if industry doesn't match any known type
    return []
  }

  const menuSections = getMenuSections()

  const isActive = (route: string) => {
    const pathOnly = route.split("?")[0]
    if (pathOnly === "/dashboard" || pathOnly === "/retail/dashboard") {
      return pathname === "/dashboard" || pathname === "/retail/dashboard"
    }
    return pathname === pathOnly || (pathOnly !== "/" && pathname?.startsWith(pathOnly + "/"))
  }

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
        aria-label="Toggle menu"
      >
        <svg className="w-6 h-6 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 z-40
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0
        `}
      >
        <div className="flex flex-col h-full">
          {/* Sidebar Header: FINZA (primary) + Company (secondary) */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-2">
            <button
              onClick={() => router.push(businessIndustry === "retail" ? "/retail/dashboard" : "/service/dashboard")}
              className="text-xl font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            >
              FINZA
            </button>
            {businessDisplay.name != null && (
              <button
                onClick={() => {
                  const settingsPath =
                    businessIndustry === "retail"
                      ? "/retail/settings/business-profile"
                      : "/service/settings/business-profile"
                  router.push(settingsPath)
                }}
                className="w-full flex items-center gap-2 text-left rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors py-1 -mx-1 px-1"
              >
                {businessDisplay.logo_url ? (
                  <img
                    src={businessDisplay.logo_url}
                    alt=""
                    className="h-5 w-5 rounded object-cover shrink-0"
                  />
                ) : null}
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                  {businessDisplay.name}
                </span>
              </button>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4">
            {/* Menu Sections */}
            <div className="space-y-1">
              {effectiveIndustry ? (
                menuSections.map((section, sectionIdx) => {
                  // JOB MANAGEMENT and BILLING & PAYMENTS expanded by default, others collapsed
                  const defaultExpanded = section.title === "JOB MANAGEMENT" || section.title === "BILLING & PAYMENTS"
                  const isExpanded = expandedSections[section.title] ?? defaultExpanded
                  
                  return (
                    <div key={sectionIdx} className="mb-2">
                      {/* Section Header with Divider */}
                      {sectionIdx > 0 && (
                        <div className="h-px bg-gray-200 dark:bg-gray-700 my-2 mx-3"></div>
                      )}
                      <button
                        onClick={() => toggleSection(section.title)}
                        className="w-full text-left px-3 py-2 rounded-lg flex items-center justify-between text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-all duration-150"
                      >
                        <span>{section.title}</span>
                        <svg
                          className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isExpanded && (
                        <div className="mt-1 space-y-0.5">
                          {section.items.map((item, itemIdx) => {
                            const active = isActive(item.route)
                            // Client-scoped accounting links (not Control Tower) require sidebarBusinessId (Wave 11).
                            const isAccountingClientRoute =
                              item.route.startsWith("/accounting") && !item.route.includes("control-tower")
                            const isServiceClientRoute =
                              item.route.startsWith("/service/ledger") || item.route.startsWith("/service/accounting") || item.route.startsWith("/service/reports")
                            const disabled = (isAccountingClientRoute || isServiceClientRoute) && !sidebarBusinessId
                            const target = item.route
                            return (
                              <button
                                key={itemIdx}
                                onClick={() => {
                                  if (!disabled) {
                                    router.push(target)
                                    setIsOpen(false)
                                  }
                                }}
                                disabled={disabled}
                                className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-all duration-150 relative ${
                                  disabled
                                    ? "text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-60"
                                    : active
                                    ? "bg-white/5 dark:bg-gray-800 text-blue-600 dark:text-blue-400 font-medium border-l-2 border-blue-500"
                                    : "text-gray-600 dark:text-gray-400 hover:bg-white/5 dark:hover:bg-gray-700/50"
                                }`}
                              >
                                {item.label}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  Loading menu...
                </div>
              )}
            </div>
          </nav>

          {/* Sidebar Footer */}
          <div className="p-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
            <button
              onClick={async () => {
                clearTabIndustryMode()
                await supabase.auth.signOut()
                router.push("/login")
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Logout
            </button>
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
              Powered by Finza
            </p>
          </div>
        </div>
      </aside>
    </>
  )
}

