"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getTabIndustryMode, clearTabIndustryMode } from "@/lib/industryMode"
import { getCurrentBusiness, getSelectedBusinessId } from "@/lib/business"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { buildServiceRoute } from "@/lib/service/routes"
import { retailPaths } from "@/lib/retail/routes"
import { clearSelectedBusinessId } from "@/lib/business"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import { upgradeLabel } from "@/lib/serviceWorkspace/subscriptionTiers"
import { useServiceSubscription } from "@/components/service/ServiceSubscriptionContext"
import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"
import { getUserRole } from "@/lib/userRoles"
import type { CustomPermissions } from "@/lib/permissions"
import { filterServiceNavSections } from "@/lib/nav/filterServiceNavSections"

/** Match service dashboard + public documents — not `name` first (legal entity vs trading name). */
function sidebarBusinessLabel(row: {
  trading_name?: string | null
  legal_name?: string | null
  name?: string | null
}): string | null {
  return row.trading_name?.trim() || row.legal_name?.trim() || row.name?.trim() || null
}

type MenuSection = {
  title: string
  items: Array<{
    label: string
    route: string
    minTier?: ServiceSubscriptionTier
    /** Same URL as another item — do not show selected state (avoids multiple highlights). */
    skipActiveHighlight?: boolean
  }>
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
  const [navRole, setNavRole] = useState<string | null>(null)
  const [navCustomPermissions, setNavCustomPermissions] = useState<CustomPermissions | null>(null)
  const [navPermsResolved, setNavPermsResolved] = useState(false)
  const isAccountingPath = pathname?.startsWith("/accounting") ?? false
  const { canAccessTier } = useServiceSubscription()

  // Business ID for canonical accounting links: URL first, then (service owner only, when NOT on accounting) current business.
  // Sidebar may call getCurrentBusiness() ONLY when not on /accounting/* (Wave 11).
  const sidebarBusinessId = urlBusinessId ?? (isAccountantFirmUser ? null : serviceBusinessId)

  useEffect(() => {
    loadIndustry(urlBusinessId, pathname ?? "")
    checkAccountantFirmUser()
  }, [pathname, urlBusinessId])

  // Phase B: role + custom_permissions for service nav (firm users: no filter)
  useEffect(() => {
    let cancelled = false
    const resolvedIndustry =
      businessIndustry ?? (pathname?.startsWith("/service/") && urlBusinessId ? "service" : null)

    if (resolvedIndustry !== "service" && resolvedIndustry !== "retail") {
      setNavPermsResolved(true)
      setNavRole(null)
      setNavCustomPermissions(null)
      return
    }
    if (isAccountantFirmUser) {
      setNavPermsResolved(true)
      setNavRole(null)
      setNavCustomPermissions(null)
      return
    }

    let bid =
      resolvedIndustry === "service" ? urlBusinessId ?? serviceBusinessId : urlBusinessId ?? getSelectedBusinessId()
    if (resolvedIndustry === "retail" && !bid) {
      setNavPermsResolved(false)
      ;(async () => {
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser()
          if (!user || cancelled) {
            if (!cancelled) {
              setNavRole(null)
              setNavCustomPermissions(null)
              setNavPermsResolved(true)
            }
            return
          }
          const business = await getCurrentBusiness(supabase, user.id)
          bid = business?.id ?? null
          if (!bid || cancelled) {
            if (!cancelled) {
              setNavRole(null)
              setNavCustomPermissions(null)
              setNavPermsResolved(true)
            }
            return
          }
          const role = await getUserRole(supabase, user.id, bid)
          const { data: buRow } = await supabase
            .from("business_users")
            .select("custom_permissions")
            .eq("business_id", bid)
            .eq("user_id", user.id)
            .maybeSingle()
          if (cancelled) return
          setNavRole(role)
          setNavCustomPermissions((buRow?.custom_permissions as CustomPermissions) ?? null)
        } catch {
          if (!cancelled) {
            setNavRole(null)
            setNavCustomPermissions(null)
          }
        } finally {
          if (!cancelled) setNavPermsResolved(true)
        }
      })()
      return () => {
        cancelled = true
      }
    }

    if (resolvedIndustry === "service" && !bid) {
      setNavPermsResolved(true)
      setNavRole(null)
      setNavCustomPermissions(null)
      return
    }

    setNavPermsResolved(false)
    ;(async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || cancelled) {
          if (!cancelled) setNavPermsResolved(true)
          return
        }
        const role = await getUserRole(supabase, user.id, bid as string)
        const { data: buRow } = await supabase
          .from("business_users")
          .select("custom_permissions")
          .eq("business_id", bid as string)
          .eq("user_id", user.id)
          .maybeSingle()
        if (cancelled) return
        setNavRole(role)
        setNavCustomPermissions((buRow?.custom_permissions as CustomPermissions) ?? null)
      } catch {
        if (!cancelled) {
          setNavRole(null)
          setNavCustomPermissions(null)
        }
      } finally {
        if (!cancelled) setNavPermsResolved(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [businessIndustry, pathname, urlBusinessId, serviceBusinessId, isAccountantFirmUser])

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
          setBusinessDisplay(
            business
              ? {
                  name: sidebarBusinessLabel(business as any),
                  logo_url: (business as any).logo_url ?? null,
                }
              : { name: null, logo_url: null }
          )
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
      const isReportishPath =
        path.startsWith("/vat-returns") || path.startsWith("/reports/")
      const billingScopedPath =
        path.startsWith("/invoices") ||
        path.startsWith("/estimates") ||
        path.startsWith("/credit-notes") ||
        path.startsWith("/payments") ||
        path.startsWith("/customers") ||
        path.startsWith("/projects")
      const isRetailPath = path.startsWith("/retail/")
      let resolvedBusinessIdForBranding =
        accountingBusinessId ||
        (isReportishPath ? getSelectedBusinessId() : null) ||
        (billingScopedPath ? getSelectedBusinessId() : null) ||
        (isRetailPath ? getSelectedBusinessId() : null)

      // Retail deep links often omit ?business_id= — resolve current workspace so logo/name never fall back to "Dashboard".
      if (isRetailPath && !resolvedBusinessIdForBranding) {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (user) {
          const business = await getCurrentBusiness(supabase, user.id)
          resolvedBusinessIdForBranding = business?.id ?? null
        }
      }

      // Service routes without business_id: keep sidebar branding — filled by getCurrentBusiness effect (avoid logo/name flash on refresh).
      if (isServicePath && !accountingBusinessId) {
        setBusinessIndustry(getTabIndustryMode())
        return
      }

      // Any path with an explicit workspace id (URL, reports picker, or billing pages + selected business): load sidebar name/logo.
      // Without this, /invoices/...?business_id= cleared branding and showed generic "Dashboard" / "Workspace".
      if (resolvedBusinessIdForBranding) {
        const { data: business, error } = await supabase
          .from("businesses")
          .select("industry, name, logo_url, trading_name, legal_name")
          .eq("id", resolvedBusinessIdForBranding)
          .is("archived_at", null)
          .maybeSingle()
        if (business) {
          setBusinessIndustry(business.industry ?? null)
          setBusinessDisplay({
            name: sidebarBusinessLabel(business),
            logo_url: business.logo_url ?? null,
          })
          return
        }
        if (error) console.error("Error loading business for sidebar:", error)
        setBusinessIndustry(null)
        setBusinessDisplay({ name: null, logo_url: null })
        return
      }

      // No workspace hint: use industry from sessionStorage only (set by dashboard/layout).
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
      // Resolve business for service-scoped links (REPORTS and Accounting).
      const effectiveServiceBusinessId = urlBusinessId ?? serviceBusinessId ?? null
      const sections: MenuSection[] = [
        {
          title: "OPERATIONS",
          items: [
            { label: "Dashboard", route: "/service/dashboard", minTier: "starter" },
            { label: "Customers", route: "/service/customers", minTier: "starter" },
            {
              label: "Quotes",
              route: buildServiceRoute("/service/quotes", effectiveServiceBusinessId ?? undefined),
              minTier: "starter",
            },
            { label: "Proposals", route: "/service/proposals", minTier: "starter" },
            { label: "Projects", route: "/service/jobs", minTier: "professional" },
          ],
        },
        {
          title: "CATALOG",
          items: [
            { label: "Services", route: "/service/services", minTier: "starter" },
            { label: "Materials", route: "/service/materials", minTier: "professional" },
          ],
        },
        {
          title: "BILLING",
          items: [
            { label: "Proforma Invoices", route: "/service/proforma", minTier: "starter" },
            { label: "Invoices", route: "/service/invoices", minTier: "starter" },
            {
              label: "Recurring invoices",
              route: buildServiceRoute("/service/recurring", effectiveServiceBusinessId ?? undefined),
              minTier: "starter",
            },
            { label: "Payments", route: "/service/payments", minTier: "starter" },
            { label: "Credit Notes", route: "/service/credit-notes", minTier: "starter" },
            { label: "Expenses", route: "/service/expenses", minTier: "starter" },
            { label: "Supplier Bills", route: "/service/bills", minTier: "professional" },
            {
              label: "Incoming documents",
              route: buildServiceRoute("/service/incoming-documents", effectiveServiceBusinessId ?? undefined),
              minTier: "starter",
            },
          ],
        },
        {
          title: "PAYROLL",
          items: [
            { label: "Payroll", route: "/service/payroll", minTier: "professional" },
            { label: "Employees", route: "/service/settings/staff", minTier: "professional" },
            { label: "Salary Advances", route: "/service/payroll/advances", minTier: "professional" },
          ],
        },
      ]
      if (!isAccountantFirmUser) {
        sections.push({
          title: "REPORTS",
          items: [
            { label: "Profit & Loss", route: buildServiceRoute("/service/reports/profit-and-loss", effectiveServiceBusinessId ?? undefined), minTier: "starter" },
            { label: "Balance Sheet", route: buildServiceRoute("/service/reports/balance-sheet", effectiveServiceBusinessId ?? undefined), minTier: "starter" },
            { label: "Cash Flow", route: buildServiceRoute("/service/reports/cash-flow", effectiveServiceBusinessId ?? undefined), minTier: "professional" },
            { label: "Changes in Equity", route: buildServiceRoute("/service/reports/equity-changes", effectiveServiceBusinessId ?? undefined), minTier: "professional" },
            { label: "Assets", route: "/service/assets", minTier: "professional" },
          ],
        })
        sections.push({
          title: "TAX & COMPLIANCE",
          items: [
            { label: "VAT Report", route: buildServiceRoute("/reports/vat", effectiveServiceBusinessId ?? undefined), minTier: "starter" },
            { label: "VAT Returns", route: buildServiceRoute("/vat-returns", effectiveServiceBusinessId ?? undefined), minTier: "professional" },
            {
              label: "Withholding Tax",
              route: buildServiceRoute("/service/accounting/wht", effectiveServiceBusinessId ?? undefined),
              minTier: "professional",
            },
            {
              label: "CIT Provisions",
              route: buildServiceRoute("/service/accounting/cit", effectiveServiceBusinessId ?? undefined),
              minTier: "business",
            },
          ],
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
        const bankReconciliationRoute = useServiceRoutes ? buildServiceRoute("/service/accounting/bank-reconciliation", accountingBusinessId ?? undefined) : buildAccountingRoute("/accounting/bank-reconciliation", accountingBusinessId ?? undefined)
        const periodsRoute = useServiceRoutes ? buildServiceRoute("/service/accounting/periods", accountingBusinessId ?? undefined) : buildAccountingRoute("/accounting/periods", accountingBusinessId ?? undefined)

        const accountingItems: Array<{ label: string; route: string; minTier?: ServiceSubscriptionTier }> = [
          { label: "General Ledger", route: ledgerRoute, minTier: "business" },
          { label: "Chart of Accounts", route: coaRoute, minTier: "business" },
          { label: "Trial Balance", route: trialBalanceRoute, minTier: "business" },
          { label: "Reconciliation", route: reconciliationRoute, minTier: "business" },
          { label: "Bank Reconciliation", route: bankReconciliationRoute, minTier: "business" },
          { label: "Accounting Periods", route: periodsRoute, minTier: "business" },
          ...(isAccountantFirmUser === true
            ? ([
                { label: "Health", route: buildAccountingRoute("/accounting/health", accountingBusinessId ?? undefined) },
                { label: "Control Tower", route: buildAccountingRoute("/accounting/control-tower") },
                { label: "Forensic Runs", route: "/admin/accounting/forensic-runs" },
                { label: "Tenants", route: "/admin/accounting/tenants" },
              ] satisfies Array<{ label: string; route: string; minTier?: ServiceSubscriptionTier }>)
            : ([
                { label: "Loans & Equity", route: "/service/accounting/loan", minTier: "business" as const },
                { label: "Journal Entry Activity", route: buildServiceRoute("/service/accounting/audit", accountingBusinessId ?? undefined), minTier: "professional" as const },
              ] satisfies Array<{ label: string; route: string; minTier?: ServiceSubscriptionTier }>)),
        ]
        sections.push({
          title: "ACCOUNTING",
          items: accountingItems,
        })
      }
      if (!isAccountantFirmUser) {
        sections.push({
          title: "ORGANIZATION",
          items: [
            { label: "Team members", route: buildServiceRoute("/service/settings/team", effectiveServiceBusinessId ?? undefined), minTier: "professional" },
            { label: "Staff management", route: buildServiceRoute("/service/settings/staff", effectiveServiceBusinessId ?? undefined), minTier: "professional" },
            { label: "Accountant requests", route: buildServiceRoute("/service/invitations", effectiveServiceBusinessId ?? undefined), minTier: "professional" },
          ],
        })
      }
      sections.push({
          title: "SETTINGS",
          items: [
            { label: "All settings",        route: "/service/settings",              minTier: "starter" },
            { label: "Subscription & plan", route: "/service/settings/subscription", minTier: "starter" },
          ],
        })
      if (!isAccountantFirmUser) {
        sections.push({
          title: "ADMIN",
          items: [
            { label: "Full Audit Log", route: buildServiceRoute("/audit-log", effectiveServiceBusinessId ?? undefined), minTier: "business" },
          ],
        })
      }
      return sections
    }

    // Only show retail menu if industry is explicitly "retail"
    if (effectiveIndustry === "retail") {
      return [
        {
          title: "RETAIL OPERATIONS",
          items: [
            { label: "Dashboard", route: "/retail/dashboard" },
            { label: "POS Terminal", route: "/retail/pos" },
            { label: "Open Register Session", route: "/retail/sales/open-session" },
            { label: "Close Register Session", route: "/retail/sales/close-session" },
          ],
        },
        {
          title: "PRODUCT & INVENTORY",
          items: [
            { label: "Products", route: "/retail/products" },
            { label: "Categories", route: "/retail/categories" },
            { label: "Inventory", route: "/retail/inventory" },
            { label: "Bulk Import", route: "/retail/admin/bulk-import" },
            { label: "Low Stock Report", route: "/retail/admin/low-stock" },
            { label: "Inventory Dashboard", route: "/retail/admin/inventory-dashboard" },
          ],
        },
        {
          title: "SALES & REPORTS",
          items: [
            { label: "Analytics Dashboard", route: retailPaths.adminAnalytics },
            { label: "Sales History", route: "/retail/sales-history" },
            { label: "Store expenses", route: retailPaths.expenses },
            { label: "Profit & Loss", route: retailPaths.reportsProfitAndLoss },
            { label: "Balance Sheet", route: retailPaths.reportsBalanceSheet },
            { label: "Register Reports", route: retailPaths.reportsRegisterSessions },
            { label: "VAT Report", route: retailPaths.reportsVat },
          ],
        },
        {
          title: "CUSTOMERS & SUPPLIERS",
          items: [
            { label: "Customers", route: "/retail/customers" },
            { label: "Suppliers", route: "/retail/admin/suppliers" },
            { label: "Purchase Orders", route: "/retail/admin/purchase-orders" },
          ],
        },
        {
          title: "SETTINGS",
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
          title: "RIDER MANAGEMENT",
          items: [
            { label: "Rider Dashboard", route: "/rider/dashboard" },
            { label: "Riders", route: "/rider/riders" },
            { label: "Deliveries", route: "/rider/deliveries" },
          ],
        },
        {
          title: "SETTINGS",
          items: [
            { label: "Business Profile", route: "/settings/business-profile" },
          ],
        },
      ]
    }

    // Default: return empty array if industry doesn't match any known type
    return []
  }

  const menuSections = useMemo(() => {
    const raw = getMenuSections()
    const resolvedIndustry =
      businessIndustry ?? (pathname?.startsWith("/service/") && urlBusinessId ? "service" : null)

    if (effectiveIndustry === "retail" && navPermsResolved && navRole === "cashier") {
      return [
        {
          title: "RETAIL OPERATIONS",
          items: [{ label: "POS Terminal", route: "/retail/pos" }],
        },
        {
          title: "SETTINGS",
          items: [{ label: "Staff Management", route: "/retail/admin/staff" }],
        },
      ]
    }

    if (
      resolvedIndustry !== "service" ||
      isAccountantFirmUser ||
      !navPermsResolved ||
      !navRole ||
      navRole === "owner"
    ) {
      return raw
    }
    return filterServiceNavSections(raw as Parameters<typeof filterServiceNavSections>[0], {
      role: navRole,
      customPermissions: navCustomPermissions,
    })
  }, [
    businessIndustry,
    pathname,
    urlBusinessId,
    serviceBusinessId,
    isAccountantFirmUser,
    navPermsResolved,
    navRole,
    navCustomPermissions,
    effectiveIndustry,
    sidebarBusinessId,
  ])

  const isActive = (route: string) => {
    const pathOnly = route.split("?")[0]
    if (pathOnly === "/dashboard" || pathOnly === "/retail/dashboard") {
      return pathname === "/dashboard" || pathname === "/retail/dashboard"
    }
    // Quotes nav uses /service/quotes (alias); estimates are the internal model for quotes.
    if (pathOnly === "/service/quotes") {
      return (
        pathname === "/service/quotes" ||
        pathname === "/service/estimates" ||
        pathname?.startsWith("/service/estimates/")
      )
    }
    return pathname === pathOnly || (pathOnly !== "/" && pathname?.startsWith(pathOnly + "/"))
  }

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-lg border border-slate-200"
        aria-label="Toggle menu"
      >
        <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          className="lg:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-64 bg-white border-r border-slate-200 z-40
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0
        `}
      >
        <div className="flex flex-col h-full">
          {/* Sidebar Header — business identity only */}
          <div className="p-4 border-b border-slate-200">
            <button
              type="button"
              onClick={() => router.push(businessIndustry === "retail" ? "/retail/dashboard" : "/service/dashboard")}
              className="text-left w-full min-w-0 rounded-lg outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              <div className="flex items-center gap-3 min-w-0">
                <BusinessLogoDisplay
                  logoUrl={businessDisplay.logo_url}
                  businessName={businessDisplay.name?.trim() || "Workspace"}
                  size="lg"
                  rounded="lg"
                  className="border border-slate-200/80 bg-white dark:border-slate-600 dark:bg-slate-800"
                />
                {businessDisplay.name ? (
                  <p className="min-w-0 flex-1 text-sm font-bold leading-snug text-slate-900 line-clamp-2 dark:text-white">
                    {businessDisplay.name}
                  </p>
                ) : (
                  <p className="min-w-0 flex-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                    Dashboard
                  </p>
                )}
              </div>
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4">
            {/* Menu Sections */}
            <div className="space-y-1">
              {effectiveIndustry ? (
                menuSections.map((section, sectionIdx) => {
                  // OPERATIONS and BILLING expanded by default, others collapsed
                  const defaultExpanded = section.title === "OPERATIONS" || section.title === "BILLING"
                  const isExpanded = expandedSections[section.title] ?? defaultExpanded
                  
                  return (
                    <div key={sectionIdx} className="mb-2">
                      {/* Section Header with Divider */}
                      {sectionIdx > 0 && (
                        <div className="h-px bg-slate-100 my-2 mx-3"></div>
                      )}
                      <button
                        onClick={() => toggleSection(section.title)}
                        className="w-full text-left px-3 py-2 rounded-lg flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 hover:bg-slate-50 transition-all duration-150"
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
                            const active =
                              !item.skipActiveHighlight && isActive(item.route)
                            // Client-scoped accounting links (not Control Tower) require sidebarBusinessId (Wave 11).
                            const isAccountingClientRoute =
                              item.route.startsWith("/accounting") && !item.route.includes("control-tower")
                            const isServiceClientRoute =
                              item.route.startsWith("/service/ledger") || item.route.startsWith("/service/accounting") || item.route.startsWith("/service/reports")
                            const tierBlocked =
                              effectiveIndustry === "service" &&
                              !isAccountantFirmUser &&
                              item.minTier != null &&
                              !canAccessTier(item.minTier)
                            const disabled =
                              ((isAccountingClientRoute || isServiceClientRoute) && !sidebarBusinessId) || tierBlocked
                            const target = item.route
                            return (
                              <button
                                key={itemIdx}
                                title={tierBlocked ? upgradeLabel(item.minTier!) : undefined}
                                onClick={() => {
                                  if (!disabled) {
                                    router.push(target)
                                    setIsOpen(false)
                                  }
                                }}
                                disabled={disabled}
                                className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-all duration-150 relative ${
                                  disabled
                                    ? "text-slate-300 cursor-not-allowed opacity-60"
                                    : active
                                    ? "bg-slate-100 text-slate-900 font-semibold"
                                    : "text-slate-600 hover:bg-slate-50"
                                }`}
                              >
                                <span className="flex items-center justify-between gap-2">
                                  <span>{item.label}</span>
                                  {tierBlocked && (
                                    <span
                                      role="link"
                                      onClick={(e) => { e.stopPropagation(); router.push("/service/settings/subscription") }}
                                      className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 shrink-0 cursor-pointer hover:text-amber-700"
                                    >
                                      Upgrade
                                    </span>
                                  )}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="px-3 py-2 text-sm text-slate-400">
                  Loading menu...
                </div>
              )}
            </div>
          </nav>

          {/* Sidebar Footer */}
          <div className="p-3 border-t border-slate-200 space-y-1">
            <button
              onClick={async () => {
                clearTabIndustryMode()
                clearSelectedBusinessId()
                await supabase.auth.signOut()
                router.push("/login")
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

