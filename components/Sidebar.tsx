"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getTabIndustryMode, clearTabIndustryMode } from "@/lib/industryMode"
import { getCurrentBusiness, getSelectedBusinessId } from "@/lib/business"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { buildServiceRoute, buildServiceSubscriptionSettingsRoute } from "@/lib/service/routes"
import {
  computeWinningSidebarNavPathBases,
  isServiceSidebarNavItemActive,
  pathOnlyFromSidebarRoute,
} from "@/lib/service/sidebarNavActive"
import { retailPaths } from "@/lib/retail/routes"
import { clearSelectedBusinessId } from "@/lib/business"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import { upgradeLabel } from "@/lib/serviceWorkspace/subscriptionTiers"
import { useServiceSubscription } from "@/components/service/ServiceSubscriptionContext"
import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"
import {
  BUSINESS_BRANDING_UPDATED_EVENT,
  type BusinessBrandingUpdatedDetail,
} from "@/lib/business/businessBrandingEvents"
import { getUserRole } from "@/lib/userRoles"
import type { CustomPermissions } from "@/lib/permissions"
import { filterServiceNavSections } from "@/lib/nav/filterServiceNavSections"
import {
  getServiceSidebarNavIcon,
  ServiceSidebarCediMark,
} from "@/lib/service/serviceSidebarNavIcons"
import { ChevronDown, Lock } from "lucide-react"

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
  const [businessDisplay, setBusinessDisplay] = useState<{ name: string | null; logo_url: string | null }>({
    name: null,
    logo_url: null,
  })
  /** False until sidebar branding fetch finishes — avoids initials flash while `logo_url` is still unknown. */
  const [sidebarBrandingResolved, setSidebarBrandingResolved] = useState(false)

  const commitSidebarBranding = useCallback((next: { name: string | null; logo_url: string | null }) => {
    setBusinessDisplay(next)
    setSidebarBrandingResolved(true)
  }, [])
  const [navRole, setNavRole] = useState<string | null>(null)
  const [navCustomPermissions, setNavCustomPermissions] = useState<CustomPermissions | null>(null)
  const [navPermsResolved, setNavPermsResolved] = useState(false)
  const isAccountingPath = pathname?.startsWith("/accounting") ?? false
  const { canAccessTier } = useServiceSubscription()

  // Business ID for canonical accounting links: URL first, then (service owner only, when NOT on accounting) current business.
  // Sidebar may call getCurrentBusiness() ONLY when not on /accounting/* (Wave 11).
  const sidebarBusinessId = urlBusinessId ?? (isAccountantFirmUser ? null : serviceBusinessId)

  useEffect(() => {
    setSidebarBrandingResolved(false)
  }, [pathname, urlBusinessId])

  useEffect(() => {
    loadIndustry(urlBusinessId, pathname ?? "")
    checkAccountantFirmUser()
  }, [pathname, urlBusinessId])

  /** Firm users on `/service/*` without `business_id` never hit `getCurrentBusiness` branding — unblock resolved state. */
  useEffect(() => {
    if (!isAccountantFirmUser) return
    if (!pathname?.startsWith("/service/")) return
    if (urlBusinessId) return
    setSidebarBrandingResolved(true)
  }, [isAccountantFirmUser, pathname, urlBusinessId])

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
          commitSidebarBranding(
            business
              ? {
                  name: sidebarBusinessLabel(business as any),
                  logo_url: (business as any).logo_url ?? null,
                }
              : { name: null, logo_url: null }
          )
        }
      } catch {
        if (!cancelled) {
          setServiceBusinessId(null)
          setSidebarBrandingResolved(true)
        }
      }
    })()
    return () => { cancelled = true }
  }, [urlBusinessId, isAccountingPath, businessIndustry, isAccountantFirmUser, commitSidebarBranding])

  // Logo upload/remove on Business Profile: refresh sidebar branding without full page reload.
  useEffect(() => {
    const onBrandingUpdated = async (ev: Event) => {
      const detail = (ev as CustomEvent<BusinessBrandingUpdatedDetail>).detail
      if (!detail?.businessId) return

      let apply = false
      if (urlBusinessId && detail.businessId === urlBusinessId) apply = true
      else if (getSelectedBusinessId() && detail.businessId === getSelectedBusinessId()) apply = true
      else if (!urlBusinessId && serviceBusinessId && detail.businessId === serviceBusinessId) apply = true
      else {
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser()
          if (user) {
            const b = await getCurrentBusiness(supabase, user.id)
            if (b?.id === detail.businessId) apply = true
          }
        } catch {
          /* noop */
        }
      }

      if (!apply) return

      const { data: row } = await supabase
        .from("businesses")
        .select("trading_name, legal_name, name, logo_url")
        .eq("id", detail.businessId)
        .is("archived_at", null)
        .maybeSingle()

      if (row) {
        commitSidebarBranding({
          name: sidebarBusinessLabel(row),
          logo_url: row.logo_url ?? null,
        })
      }
    }

    window.addEventListener(BUSINESS_BRANDING_UPDATED_EVENT, onBrandingUpdated)
    return () => window.removeEventListener(BUSINESS_BRANDING_UPDATED_EVENT, onBrandingUpdated)
  }, [urlBusinessId, serviceBusinessId, commitSidebarBranding])

  // Auto-close mobile menu when route changes
  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  const loadIndustry = async (accountingBusinessId: string | null, path: string) => {
    try {
      const { isCashierAuthenticated } = await import("@/lib/cashierSession")
      if (isCashierAuthenticated()) {
        setSidebarBrandingResolved(true)
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
          commitSidebarBranding({
            name: sidebarBusinessLabel(business),
            logo_url: business.logo_url ?? null,
          })
          return
        }
        if (error) console.error("Error loading business for sidebar:", error)
        setBusinessIndustry(null)
        commitSidebarBranding({ name: null, logo_url: null })
        return
      }

      // No workspace hint: use industry from sessionStorage only (set by dashboard/layout).
      setBusinessIndustry(getTabIndustryMode())
      commitSidebarBranding({ name: null, logo_url: null })
    } catch (err) {
      console.error("Error loading industry:", err)
      setBusinessIndustry(null)
      commitSidebarBranding({ name: null, logo_url: null })
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

  const effectiveServiceBusinessId =
    effectiveIndustry === "service" ? urlBusinessId ?? serviceBusinessId ?? null : null

  const getMenuSections = (): MenuSection[] => {
    // If industry is not loaded yet and we don't have service deep-link context, return empty array (no menu)
    if (!effectiveIndustry) {
      return []
    }

    if (effectiveIndustry === "service") {
      const sections: MenuSection[] = [
        {
          title: "Operations",
          items: [
            { label: "Dashboard", route: "/service/dashboard", minTier: "starter" },
            { label: "Customers", route: "/service/customers", minTier: "starter" },
            {
              label: "Quotes",
              route: buildServiceRoute("/service/quotes", effectiveServiceBusinessId ?? undefined),
              minTier: "starter",
            },
            { label: "Proposals", route: "/service/proposals", minTier: "starter" },
            { label: "Jobs & Projects", route: "/service/jobs", minTier: "professional" },
          ],
        },
        {
          title: "Catalog",
          items: [
            { label: "Services", route: "/service/services", minTier: "starter" },
            { label: "Materials", route: "/service/materials", minTier: "professional" },
          ],
        },
        {
          title: "Billing",
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
          title: "Payroll",
          items: [
            { label: "Payroll", route: "/service/payroll", minTier: "professional" },
            { label: "Employees", route: "/service/settings/staff", minTier: "professional" },
            { label: "Salary Advances", route: "/service/payroll/advances", minTier: "professional" },
          ],
        },
      ]
      if (!isAccountantFirmUser) {
        sections.push({
          title: "Reports",
          items: [
            { label: "Profit & Loss", route: buildServiceRoute("/service/reports/profit-and-loss", effectiveServiceBusinessId ?? undefined), minTier: "starter" },
            { label: "Balance Sheet", route: buildServiceRoute("/service/reports/balance-sheet", effectiveServiceBusinessId ?? undefined), minTier: "starter" },
            { label: "Cash Flow", route: buildServiceRoute("/service/reports/cash-flow", effectiveServiceBusinessId ?? undefined), minTier: "professional" },
            { label: "Changes in Equity", route: buildServiceRoute("/service/reports/equity-changes", effectiveServiceBusinessId ?? undefined), minTier: "professional" },
            { label: "Fixed Assets", route: "/service/assets", minTier: "professional" },
          ],
        })
        sections.push({
          title: "Tax & compliance",
          items: [
            { label: "VAT Report", route: buildServiceRoute("/reports/vat", effectiveServiceBusinessId ?? undefined), minTier: "starter" },
            { label: "VAT Filings", route: buildServiceRoute("/vat-returns", effectiveServiceBusinessId ?? undefined), minTier: "professional" },
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
                {
                  label: "Loans & Equity",
                  route: buildServiceRoute("/service/accounting/loan", accountingBusinessId ?? undefined),
                  minTier: "business" as const,
                },
                { label: "Accounting Audit Log", route: buildServiceRoute("/service/accounting/audit", accountingBusinessId ?? undefined), minTier: "professional" as const },
              ] satisfies Array<{ label: string; route: string; minTier?: ServiceSubscriptionTier }>)),
        ]
        sections.push({
          title: "Advanced accounting",
          items: accountingItems,
        })
      }
      if (!isAccountantFirmUser) {
        sections.push({
          title: "Organization",
          items: [
            { label: "Team members", route: buildServiceRoute("/service/settings/team", effectiveServiceBusinessId ?? undefined), minTier: "professional" },
            { label: "Accountant requests", route: buildServiceRoute("/service/invitations", effectiveServiceBusinessId ?? undefined), minTier: "professional" },
          ],
        })
      }
      sections.push({
          title: "Settings",
          items: [
            { label: "All settings",        route: "/service/settings",              minTier: "starter" },
            { label: "Subscription & plan", route: "/service/settings/subscription", minTier: "starter" },
          ],
        })
      if (!isAccountantFirmUser) {
        sections.push({
          title: "Admin",
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
    effectiveServiceBusinessId,
  ])

  // Keep the section that contains the current route expanded so the active item is visible.
  useEffect(() => {
    if (!effectiveIndustry) return
    setExpandedSections((prev) => {
      let changed = false
      const next = { ...prev }
      for (const section of menuSections) {
        const hasActive = section.items.some(
          (item) =>
            !item.skipActiveHighlight &&
            isServiceSidebarNavItemActive(pathname ?? "", item.route)
        )
        if (hasActive && next[section.title] !== true) {
          next[section.title] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [pathname, effectiveIndustry, menuSections])

  const winningNavPathBases = useMemo(
    () => computeWinningSidebarNavPathBases(pathname, menuSections),
    [pathname, menuSections]
  )

  /** Service workspace: sidebar chrome is Finza platform branding; business identity lives on the dashboard. */
  const isServiceWorkspaceRoute = (pathname ?? "").startsWith("/service/")
  const [finzaSidebarSvgFailed, setFinzaSidebarSvgFailed] = useState(false)

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700"
        aria-label="Toggle menu"
      >
        <svg className="w-6 h-6 text-slate-600 dark:text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
          fixed top-0 left-0 h-full w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 z-40
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0
        `}
      >
        <div className="flex flex-col h-full">
          {/* Sidebar header: Finza platform (service) vs workspace business (retail / legacy routes) */}
          <div
            className={`border-b border-slate-200 dark:border-slate-800 ${
              isServiceWorkspaceRoute
                ? "box-border flex h-16 items-center pl-6 pr-4"
                : "px-3 py-2"
            }`}
          >
            {isServiceWorkspaceRoute ? (
              <button
                type="button"
                onClick={() => router.push("/service/dashboard")}
                className="flex min-h-0 w-full min-w-0 items-center justify-start rounded-lg text-left outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-slate-400"
                aria-label="Finza — Service dashboard"
              >
                {!finzaSidebarSvgFailed ? (
                  <img
                    src="/brand/finza-logo-colored-solid.svg"
                    alt="Finza"
                    width={220}
                    height={56}
                    decoding="async"
                    loading="eager"
                    className="block h-[34px] w-auto max-h-[40px] max-w-[200px] object-contain object-left dark:brightness-[1.06]"
                    onError={() => setFinzaSidebarSvgFailed(true)}
                  />
                ) : (
                  <>
                    <span
                      className="mr-3 h-[10px] w-[10px] shrink-0 rounded-[3px] bg-blue-600 dark:bg-blue-500"
                      aria-hidden
                    />
                    <span className="text-[30px] font-extrabold leading-none tracking-[-0.03em] text-slate-900 dark:text-white">
                      Finza
                    </span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => router.push(businessIndustry === "retail" ? "/retail/dashboard" : "/service/dashboard")}
                className="w-full min-w-0 rounded-lg text-left outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <BusinessLogoDisplay
                    logoUrl={businessDisplay.logo_url}
                    businessName={businessDisplay.name?.trim() || "Workspace"}
                    variant="sidebar"
                    rounded="lg"
                    brandingResolved={sidebarBrandingResolved}
                    className="shrink-0"
                  />
                  {businessDisplay.name ? (
                    <p
                      className="min-w-0 flex-1 text-sm font-semibold leading-tight text-slate-900 line-clamp-1 dark:text-white"
                      title={businessDisplay.name}
                    >
                      {businessDisplay.name}
                    </p>
                  ) : (
                    <p className="min-w-0 flex-1 text-sm font-semibold leading-tight text-slate-500 dark:text-slate-400">
                      Dashboard
                    </p>
                  )}
                </div>
              </button>
            )}
          </div>

          {/* Navigation */}
          <nav
            className="flex-1 overflow-y-auto p-3 sm:p-4 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.35)_transparent] dark:[scrollbar-color:rgba(100,116,139,0.3)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/30 dark:[&::-webkit-scrollbar-thumb]:bg-slate-500/25"
          >
            {/* Menu Sections */}
            <div className="space-y-1">
              {effectiveIndustry ? (
                menuSections.map((section, sectionIdx) => {
                  const isServiceMenu = effectiveIndustry === "service"
                  const defaultExpanded =
                    section.title === "Operations" ||
                    section.title === "Billing" ||
                    section.title === "OPERATIONS" ||
                    section.title === "BILLING" ||
                    section.title === "RETAIL OPERATIONS"
                  const isExpanded = expandedSections[section.title] ?? defaultExpanded

                  return (
                    <div key={sectionIdx} className={isServiceMenu ? "mb-3" : "mb-2"}>
                      {sectionIdx > 0 && (
                        <div
                          className={`h-px bg-slate-100 dark:bg-slate-800 ${isServiceMenu ? "my-3 mx-2" : "my-2 mx-3"}`}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => toggleSection(section.title)}
                        className={
                          isServiceMenu
                            ? "w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 tracking-wide hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors duration-150"
                            : "w-full text-left px-3 py-2 rounded-lg flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all duration-150"
                        }
                      >
                        <span>{section.title}</span>
                        <ChevronDown
                          className={`w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                          aria-hidden="true"
                          strokeWidth={2}
                        />
                      </button>
                      {isExpanded && (
                        <div className="mt-1 space-y-0.5">
                          {section.items.map((item, itemIdx) => {
                            const active =
                              !item.skipActiveHighlight &&
                              winningNavPathBases.has(
                                pathOnlyFromSidebarRoute(item.route)
                              )
                            const isAccountingClientRoute =
                              item.route.startsWith("/accounting") &&
                              !item.route.includes("control-tower")
                            const isServiceClientRoute =
                              item.route.startsWith("/service/ledger") ||
                              item.route.startsWith("/service/accounting") ||
                              item.route.startsWith("/service/reports")
                            const tierBlocked =
                              effectiveIndustry === "service" &&
                              !isAccountantFirmUser &&
                              item.minTier != null &&
                              !canAccessTier(item.minTier)
                            const contextBlocked =
                              (isAccountingClientRoute || isServiceClientRoute) &&
                              !sidebarBusinessId
                            const navLocked = contextBlocked || tierBlocked
                            const target = item.route
                            const tierUpgradeAriaLabel = tierBlocked
                              ? `${upgradeLabel(item.minTier!)}. Opens subscription page.`
                              : undefined

                            const iconRes = isServiceMenu
                              ? getServiceSidebarNavIcon(item.label)
                              : null
                            const IconComponent =
                              iconRes && iconRes !== "cedi" ? iconRes : null
                            let iconClass =
                              "h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300"
                            if (active) {
                              iconClass =
                                "h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400"
                            } else if (tierBlocked) {
                              iconClass =
                                "h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
                            } else if (contextBlocked) {
                              iconClass =
                                "h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500"
                            }

                            let rowClass =
                              "flex w-full items-center gap-2.5 rounded-md border-l-2 py-2 pl-2 pr-2 text-left text-sm transition-colors duration-150 "
                            if (active) {
                              rowClass +=
                                "border-blue-600 bg-blue-50/90 dark:bg-blue-950/35 dark:border-blue-500 font-semibold text-slate-900 dark:text-slate-100 "
                              if (tierBlocked) {
                                rowClass +=
                                  "cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/50 "
                              }
                            } else if (navLocked) {
                              rowClass += "border-transparent "
                              if (tierBlocked) {
                                rowClass +=
                                  "text-slate-600 dark:text-slate-300 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 "
                              } else {
                                rowClass +=
                                  "text-slate-500 dark:text-slate-400 cursor-not-allowed opacity-90 "
                              }
                            } else {
                              rowClass +=
                                "border-transparent text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 "
                            }

                            return (
                              <button
                                key={itemIdx}
                                type="button"
                                aria-label={tierUpgradeAriaLabel}
                                title={
                                  tierBlocked
                                    ? upgradeLabel(item.minTier!)
                                    : contextBlocked
                                      ? "Select a business to open this page"
                                      : undefined
                                }
                                onClick={() => {
                                  if (tierBlocked) {
                                    router.push(
                                      buildServiceSubscriptionSettingsRoute(
                                        effectiveServiceBusinessId
                                      )
                                    )
                                    setIsOpen(false)
                                    return
                                  }
                                  if (contextBlocked) return
                                  router.push(target)
                                  setIsOpen(false)
                                }}
                                aria-disabled={
                                  contextBlocked && !tierBlocked ? true : undefined
                                }
                                className={rowClass}
                              >
                                {iconRes === "cedi" ? (
                                  <ServiceSidebarCediMark className={iconClass} />
                                ) : IconComponent ? (
                                  <IconComponent className={iconClass} aria-hidden="true" />
                                ) : isServiceMenu ? (
                                  <span className="w-4 shrink-0" aria-hidden />
                                ) : null}
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                {tierBlocked && (
                                  <span className="inline-flex items-center gap-1 shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                                    <Lock className="h-3 w-3 opacity-90" aria-hidden="true" />
                                    Upgrade
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">
                  Loading menu...
                </div>
              )}
            </div>
          </nav>

          {/* Sidebar Footer */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-1">
            <button
              onClick={async () => {
                clearTabIndustryMode()
                clearSelectedBusinessId()
                await supabase.auth.signOut()
                router.push("/login")
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-slate-600 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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

