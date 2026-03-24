/**
 * Centralized Access Control System
 * 
 * SINGLE SOURCE OF TRUTH: All access decisions are made here.
 * This ensures consistent behavior and prevents duplicate checks/redirects.
 * 
 * RULES:
 * 1. Access decisions made ONCE per navigation
 * 2. Redirects happen in ONE place only (ProtectedLayout)
 * 3. accountant_readonly applies ONLY when workspace === "accounting"
 * 4. POS/Retail NEVER affected by accounting restrictions
 * 5. Store context applies ONLY to retail/inventory/reports
 * 6. Accounting workspace never requires store context
 */

import { SupabaseClient } from "@supabase/supabase-js"
import { getUserRole } from "./userRoles"
import { isUserAccountantReadonly } from "./userRoles"
import { getActiveStoreId } from "./storeSession"
import { isCashierAuthenticated } from "./cashierSession"
import { getCurrentBusiness } from "./business"
import { logAccessDeniedAttempt } from "./firmActivityLog"
import { hasPermission, type CustomPermissions } from "./permissions"

export type Workspace = "retail" | "service" | "accounting"

export type UserRole = "owner" | "admin" | "manager" | "cashier" | null

export interface AccessDecision {
  allowed: boolean
  redirectTo?: string
  reason?: string
}

/**
 * Determine workspace from route pathname
 * Workspace determines which access rules apply
 */
export function getWorkspaceFromPath(pathname: string): Workspace {
  const path = pathname.split("?")[0] // Remove query params
  const normalizedPath = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path

  // Accounting workspace: /accounting/* and /admin/accounting/* (e.g. forensic monitoring)
  if (normalizedPath.startsWith("/accounting") || normalizedPath.startsWith("/admin/accounting")) {
    return "accounting"
  }

  // Retail workspace: POS, inventory, sales, retail dashboard
  // /reports excluded: shared Financial Reports hub used by both service and retail
  if (
    normalizedPath.startsWith("/pos") ||
    normalizedPath.startsWith("/inventory") ||
    normalizedPath.startsWith("/sales") ||
    normalizedPath.startsWith("/onboarding/retail") ||
    normalizedPath.startsWith("/retail") ||
    normalizedPath.startsWith("/retail/admin")
  ) {
    return "retail"
  }

  // Service workspace: clients, invoices, estimates (default for service industry)
  // For now, default to "service" for non-accounting, non-retail routes
  return "service"
}

/**
 * Check if route requires store context
 * Store context required ONLY for retail workspace routes
 */
function requiresStoreContext(workspace: Workspace, pathname: string): boolean {
  if (workspace !== "retail") {
    return false // Accounting and service workspaces never require store
  }

  // Retail routes that require store context (/reports is shared, not retail-only)
  const storeRequiredRoutes = [
    "/pos",
    "/inventory",
    "/retail/admin/inventory-dashboard",
    "/retail/admin/analytics",
  ]

  const path = pathname.split("?")[0]
  const normalizedPath = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path

  return storeRequiredRoutes.some(
    (route) => normalizedPath === route || normalizedPath.startsWith(route + "/")
  )
}

/**
 * Routes that are only accessible to accounting firm users (accounting_firm_users).
 * Service users (business but not firm) must be redirected to access-denied.
 */
function isFirmOnlyRoute(pathname: string): boolean {
  const path = (pathname || "").split("?")[0]
  const normalized = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path
  return (
    normalized.startsWith("/accounting/control-tower") ||
    normalized.startsWith("/accounting/firm") ||
    normalized.startsWith("/admin/accounting")
  )
}

/**
 * SINGLE ACCESS RESOLUTION FUNCTION
 * 
 * Evaluates ALL conditions (auth, role, workspace, route, store) in ONE place.
 * Returns ALLOW or a specific redirect path.
 * 
 * This function is the ONLY place where access decisions are made.
 * All other guards should call this function or return booleans only.
 */
export async function resolveAccess(
  supabase: SupabaseClient,
  userId: string | null,
  pathname: string
): Promise<AccessDecision> {
  const workspace = getWorkspaceFromPath(pathname || "")
  let business: { id: string; industry: string | null } | null = null
  const debugDecision = (decision: AccessDecision): AccessDecision => {
    if (pathname === "/service/dashboard") {
      console.log("[resolveAccess][service-dashboard]", {
        pathname,
        workspace,
        "business?.industry": business?.industry,
        "decision.allowed": decision.allowed,
        "decision.redirectTo": decision.redirectTo,
      })
    }
    return decision
  }

  // STEP 1: Check authentication
  const cashierAuth = isCashierAuthenticated()
  
  if (!userId) {
    // No Supabase session - check for cashier PIN session for POS routes
    if (pathname?.startsWith("/pos")) {
      if (cashierAuth) {
        // Cashier PIN session exists - allow POS routes only
        return debugDecision({ allowed: true })
      } else {
        return debugDecision({ allowed: false, redirectTo: "/pos/pin", reason: "No cashier PIN session" })
      }
    } else {
      return debugDecision({ allowed: false, redirectTo: "/login", reason: "Not authenticated" })
    }
  }

  // STEP 2: Get user metadata (for signup intent check)
  let signupIntent: "business_owner" | "accounting_firm" = "business_owner"
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser?.user_metadata?.signup_intent) {
      signupIntent = authUser.user_metadata.signup_intent
    }
  } catch (error) {
    // Ignore - will default to business_owner
  }

  // STEP 4: STRICT WORKSPACE BOUNDARY - Accounting workspace is accountant-firm ONLY
  // This enforces that /accounting/* routes are ONLY accessible to accountant firm users
  // Business owners (retail/service) are explicitly blocked
  if (workspace === "accounting") {
    const path = (pathname || "").split("?")[0]
    const normalizedPath = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path
    // Allow explicit access-denied page so denied users see a clear screen instead of silent redirect
    if (normalizedPath === "/accounting/access-denied") {
      return debugDecision({ allowed: true })
    }

    // Check if user belongs to an accounting firm
    const { data: firmUsers } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("user_id", userId)
      .limit(1)

    if (firmUsers && firmUsers.length > 0) {
      // User belongs to a firm - allow access to accounting workspace without business
      // Role and accountant_readonly will be resolved from firm context
      return debugDecision({ allowed: true })
    }

    // Firm-only routes: only accounting_firm_users may access; service users get access-denied
    if (isFirmOnlyRoute(pathname || "")) {
      logAccessDeniedAttempt(userId, pathname || "", workspace)
      return debugDecision({
        allowed: false,
        redirectTo: "/accounting/access-denied",
        reason: "Firm-only route requires accounting firm membership",
      })
    }

    // User does NOT belong to an accounting firm - BLOCK access to accounting workspace
    // This prevents business owners (retail/service) from accessing accountant-only routes
    // Determine appropriate redirect based on user's business context
    let business: { id: string; industry: string | null } | null = null
    try {
      business = await getCurrentBusiness(supabase, userId)
    } catch (error) {
      // Ignore - business will be null
    }

    if (business) {
      // Owner or employee with a business: allow access to /accounting/* for their own business.
      // Client-scoped pages show EmptyState when business_id is missing; no redirect here.
      return debugDecision({ allowed: true })
    } else {
      // No business, no firm - redirect to appropriate setup
      if (signupIntent === "accounting_firm") {
        return debugDecision({ 
          allowed: false, 
          redirectTo: "/accounting/firm/setup", 
          reason: "Accounting workspace requires accountant firm membership" 
        })
      } else {
        return debugDecision({ 
          allowed: false, 
          redirectTo: "/business-setup", 
          reason: "Accounting workspace requires accountant firm access" 
        })
      }
    }
  }

  // STEP 5: Get business and role (we have userId from Supabase session)
  let businessId: string | null = null
  let role: UserRole = null
  let accountantReadonly = false
  let customPermissions: CustomPermissions | null = null

  try {
    business = await getCurrentBusiness(supabase, userId)
    if (!business) {
      // Step 9.3 Fix: Don't redirect accounting firm users to business-setup
      if (signupIntent === "accounting_firm") {
        // Check if user already belongs to a firm (shouldn't reach here for accounting routes, but just in case)
        const { data: firmUsers } = await supabase
          .from("accounting_firm_users")
          .select("firm_id")
          .eq("user_id", userId)
          .limit(1)

        if (firmUsers && firmUsers.length > 0) {
          // User belongs to firm but no business - allow access to accounting workspace
          return debugDecision({ allowed: true })
        } else {
          // No firm, no business - redirect to firm setup
          return debugDecision({ allowed: false, redirectTo: "/accounting/firm/setup", reason: "No business or firm found - redirect to firm setup" })
        }
      }
      // Allow setup/onboarding routes when user has no business so they can create one
      const path = (pathname || "").split("?")[0]
      const normalizedPath = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path
      const setupPaths = ["/business-setup", "/onboarding", "/settings/business-profile"]
      const isSetupRoute = setupPaths.some((p) => normalizedPath === p || normalizedPath.startsWith(p + "/"))
      if (isSetupRoute) {
        return debugDecision({ allowed: true })
      }
      // Default: business owner needs a business
      return debugDecision({ allowed: false, redirectTo: "/business-setup", reason: "No business found" })
    }
    businessId = business.id

    role = (await getUserRole(supabase, userId, business.id)) as UserRole
    accountantReadonly = await isUserAccountantReadonly(supabase, userId, business.id)
  } catch (error) {
    console.error("Error resolving access:", error)
    return debugDecision({ allowed: false, redirectTo: "/login", reason: "Error checking user permissions" })
  }

  // STEP 5.5: INVARIANT 5 - Enforce workspace-industry matching
  // Service & Finance must NOT access retail routes
  const businessIndustry = business?.industry || "service"
  const landing =
    business?.industry === "retail"
      ? "/retail/dashboard"
      : "/service/dashboard"
  
  if (workspace === "retail" && businessIndustry !== "retail") {
    // Service/Finance user trying to access retail workspace - block
    return debugDecision({
      allowed: false,
      redirectTo: landing,
      reason: "Retail workspace routes are not available for service/finance businesses",
    })
  }
  
  if (workspace === "service" && businessIndustry === "retail") {
    // Retail user trying to access service workspace - redirect to retail
    return debugDecision({
      allowed: false,
      redirectTo: "/retail/dashboard",
      reason: "Service workspace routes are not available for retail businesses",
    })
  }

  // STEP 6: Apply workspace-specific access rules

  // ACCOUNTING WORKSPACE: accountant_readonly applies HERE only
  // (workspace may be narrowed to retail|service after STEP 4 returns for accounting; cast to allow this branch for callers that reach STEP 6 with accounting)
  if ((workspace as Workspace) === "accounting") {
    if (accountantReadonly) {
      // Accountant readonly users can ONLY access accounting routes
      const allowedRoutes = [
        "/accounting",
        "/accounting/ledger",
        "/accounting/trial-balance",
        "/accounting/periods",
        "/accounting/exceptions",
        "/accounting/adjustments",
        "/accounting/adjustments/review",
        "/accounting/afs",
      ]

      const path = (pathname || "").split("?")[0]
      const normalizedPath = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path

      const isAllowed = allowedRoutes.some(
        (route) => normalizedPath === route || normalizedPath.startsWith(route + "/")
      )

      if (!isAllowed) {
        return debugDecision({ allowed: false, redirectTo: "/accounting", reason: "Accountant readonly: restricted route" })
      }
    }

    // Accounting workspace never requires store context
    // Continue to role-based checks
  }

  // RETAIL/SERVICE WORKSPACES: accountant_readonly is IGNORED
  // These workspaces operate independently from accounting restrictions

  // STEP 7: Check role-based access
  // Exception: Accounting firm users without business (but with firm membership) 
  // can access accounting routes - role will be resolved from firm context in route handlers.
  // For non-accounting routes, accounting firm users with firm membership but no business
  // should be redirected to accounting workspace (handled above in STEP 5).
  // If we reach here without role and it's not accounting workspace, user needs a role.
  if (!role) {
    // If accounting workspace, user should have been handled in STEP 4 (firm membership)
    // or STEP 5 (redirect to firm setup). Reaching here means unexpected state.
    // For safety, allow accounting workspace even without role (will be resolved in handlers).
    if ((workspace as Workspace) === "accounting") {
      return debugDecision({ allowed: true })
    }
    // For other workspaces, role is required
    return debugDecision({ allowed: false, redirectTo: "/login", reason: "No user role" })
  }

  // Cashier rules: Only POS routes
  if ((role as UserRole) === "cashier") {
    if (pathname?.startsWith("/pos")) {
      return debugDecision({ allowed: true })
    }
    return debugDecision({ allowed: false, redirectTo: "/pos", reason: "Cashiers can only access POS" })
  }

  // Fetch custom_permissions now (after cashier early-return to avoid wasted DB query)
  if (role && role !== "owner" && business) {
    try {
      const { data: buRow } = await supabase
        .from("business_users")
        .select("custom_permissions")
        .eq("business_id", business.id)
        .eq("user_id", userId)
        .maybeSingle()
      customPermissions = (buRow?.custom_permissions as CustomPermissions) ?? null
    } catch (_) {
      // Non-fatal — fall back to role defaults only
    }
  }

  // Permission-based route guards (applies to all non-owner roles using effective permissions)
  // Effective permissions = ROLE_DEFAULTS[role] + custom_permissions.granted − custom_permissions.revoked
  if (role && role !== "owner") {
    const path = (pathname || "").split("?")[0]
    const normalizedPath = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path
    const landing = businessIndustry === "retail" ? "/retail/dashboard" : "/service/dashboard"

    // Map route prefixes to the permission required to access them
    // IMPORTANT: more-specific prefixes MUST come before general ones.
    // The loop breaks on the first match, so /service/settings/team must appear
    // before /service/settings, otherwise the general entry would swallow it.
    const routePermissionMap: Array<{ prefix: string; permission: Parameters<typeof hasPermission>[2] }> = [
      { prefix: "/payroll",                       permission: "payroll.view" },
      // Settings — specific first, general last
      { prefix: "/service/settings/team",         permission: "team.manage" },
      { prefix: "/service/settings/staff",        permission: "staff.manage" },
      { prefix: "/settings/staff",                permission: "staff.manage" },
      { prefix: "/service/settings",              permission: "settings.view" }, // catch-all for other settings pages
      { prefix: "/admin",                         permission: "settings.edit" },
      { prefix: "/retail/admin",                  permission: "settings.edit" },
      { prefix: "/bills",                         permission: "bills.view" },
      { prefix: "/accounting",                    permission: "accounting.view" },
      { prefix: "/service/accounting",            permission: "accounting.view" },
      { prefix: "/reports/vat",                   permission: "reports.view" },
      { prefix: "/vat-returns",                   permission: "reports.view" },
      { prefix: "/assets",                        permission: "reports.view" },
    ]

    for (const { prefix, permission } of routePermissionMap) {
      if (normalizedPath === prefix || normalizedPath.startsWith(prefix + "/")) {
        if (!hasPermission(role, customPermissions, permission)) {
          return debugDecision({
            allowed: false,
            redirectTo: landing,
            reason: `Permission denied: ${permission}`,
          })
        }
        break
      }
    }
  }

  // Admin/Owner: Allow all routes (except accounting readonly restrictions, handled above)

  // STEP 8: Check store context (ONLY for retail workspace routes that require it)
  if (workspace === "retail" && requiresStoreContext(workspace, pathname || "")) {
    // Cashiers have implicit store from session (skip check)
    if (role !== "cashier") {
      // Get user's assigned store_id (for managers)
      let assignedStoreId: string | null = null
      if (userId && businessId) {
        try {
          const { data: userData } = await supabase
            .from("users")
            .select("store_id")
            .eq("id", userId)
            .maybeSingle()
          assignedStoreId = userData?.store_id || null
        } catch (error) {
          console.error("Error checking store assignment:", error)
        }
      }

      const activeStoreId = getActiveStoreId()

      // Manager: Must have assigned store_id OR selected store
      if (role === "manager") {
        const storeId = activeStoreId || assignedStoreId
        if (!storeId || storeId === "all") {
          return debugDecision({
            allowed: false,
            redirectTo: `/retail/select-store?return=${encodeURIComponent(pathname || "/retail/dashboard")}`,
            reason: "Manager: store context required",
          })
        }
      }

      // Admin/Owner: Must have selected store for store-specific routes
      if (role === "admin" || role === "owner") {
        if (!activeStoreId || activeStoreId === "all") {
          return debugDecision({
            allowed: false,
            redirectTo: `/retail/select-store?return=${encodeURIComponent(pathname || "/retail/dashboard")}`,
            reason: "Admin/Owner: store context required for retail route",
          })
        }
      }
    }
  }

  // STEP 9: Access granted
  return debugDecision({ allowed: true })
}

/**
 * Get the default home route for a role and workspace
 * Used when access is denied and no specific redirect is provided
 */
export function getHomeRouteForRole(role: UserRole, workspace: Workspace = "retail"): string {
  const landing =
    (workspace as string) === "retail"
      ? "/retail/dashboard"
      : "/service/dashboard"

  if (!role) {
    return "/login"
  }

  switch (role) {
    case "cashier":
      return "/pos"
    case "manager":
      return workspace === "accounting" ? "/accounting" : "/retail/dashboard"
    case "admin":
    case "owner":
      return workspace === "accounting" ? "/accounting" : "/retail/dashboard"
    default:
      return landing
  }
}

