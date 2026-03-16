/**
 * Role-Based Route Guards
 * Enforces access control based on user roles
 */

export type UserRole = "owner" | "admin" | "manager" | "cashier"

export interface RouteGuardResult {
  allowed: boolean
  redirectTo?: string
}

/**
 * Check if a route is allowed for a given role
 * @param role - User role
 * @param pathname - Route pathname
 * @param isAccountantReadonly - Optional flag indicating if user has accountant_readonly access
 */
export function checkRouteAccess(
  role: UserRole | null,
  pathname: string,
  isAccountantReadonly: boolean = false
): RouteGuardResult {
  if (!role && !isAccountantReadonly) {
    return { allowed: false, redirectTo: "/login" }
  }

  // Normalize pathname
  const path = pathname.split("?")[0] // Remove query params
  const normalizedPath = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path

  // MODE SEPARATION: Accountant readonly rules apply ONLY inside Accounting Mode (/accounting/*)
  // POS/Retail Mode routes ignore accountant_readonly flag and use normal role-based checks
  if (isAccountantReadonly && normalizedPath.startsWith("/accounting")) {
    // Accountant readonly users can ONLY access accounting routes
    // This restriction applies ONLY when accessing Accounting Mode routes
      const allowedRoutes = [
        "/accounting",
        "/accounting/ledger",
        "/accounting/trial-balance",
        "/accounting/periods",
        "/accounting/chart-of-accounts",
        "/accounting/opening-balances",
        "/accounting/carry-forward",
        "/accounting/exceptions",
        "/accounting/adjustments",
        "/accounting/adjustments/review",
        "/accounting/afs",
      ]

    for (const allowed of allowedRoutes) {
      if (normalizedPath === allowed || normalizedPath.startsWith(allowed + "/")) {
        return { allowed: true }
      }
    }

    // Block unauthorized accounting routes (accountant readonly users have limited access)
    return { allowed: false, redirectTo: "/accounting" }
  }

  // For non-accounting routes (POS, Retail, Inventory, Reports, Analytics):
  // Ignore accountant_readonly flag and use normal role-based access control
  // This ensures POS/Retail Mode operates independently from Accounting Mode permissions

  if (!role) {
    return { allowed: false, redirectTo: "/login" }
  }

  // Cashier rules - STRICT: Only POS routes allowed
  if (role === "cashier") {
    // Allow only POS routes (including /pos/pin for login)
    if (normalizedPath.startsWith("/pos")) {
      return { allowed: true }
    }

    // Explicitly block all admin/manager routes
    const blockedRoutes = [
      "/login",
      "/retail",
      "/dashboard",
      "/reports",
      "/settings",
      "/sales-history",
      "/sales/open-session",
      "/sales/close-session",
      "/admin",
      "/accounting",
      "/invoices",
      "/products",
      "/inventory",
      "/staff",
      "/payroll",
    ]

    for (const blocked of blockedRoutes) {
      if (normalizedPath === blocked || normalizedPath.startsWith(blocked + "/")) {
        return { allowed: false, redirectTo: "/pos" }
      }
    }

    // Block any route that's not POS (catch-all)
    if (!normalizedPath.startsWith("/pos")) {
      return { allowed: false, redirectTo: "/pos" }
    }
  }

  // Manager rules - Can open/close registers, access POS, but not admin settings
  if (role === "manager") {
    // Block admin-only settings
    const adminOnlySettings = [
      "/settings/staff",
      "/admin",
    ]

    for (const blocked of adminOnlySettings) {
      if (normalizedPath.startsWith(blocked)) {
        return { allowed: false, redirectTo: "/retail/dashboard" }
      }
    }

    // Allow register management (open/close sessions)
    if (
      normalizedPath.startsWith("/sales/open-session") ||
      normalizedPath.startsWith("/sales/close-session")
    ) {
      return { allowed: true }
    }

    // Allow retail dashboard, POS, sales
    if (
      normalizedPath === "/retail/dashboard" ||
      normalizedPath.startsWith("/pos") ||
      normalizedPath.startsWith("/sales")
    ) {
      return { allowed: true }
    }

    // Allow other retail routes
    if (normalizedPath.startsWith("/retail")) {
      return { allowed: true }
    }

    // Allow other common routes (invoices, products, etc.)
    // Block only admin-specific routes
    return { allowed: true }
  }

  // Admin/Owner rules - allow all routes
  if (role === "admin" || role === "owner") {
    return { allowed: true }
  }

  // Default: allow access
  return { allowed: true }
}

/**
 * Get the default home route for a role
 * MODE SEPARATION: Accountant readonly restriction is route-specific (applies only to /accounting/*)
 * For non-accounting route denials, use normal role-based home routes
 */
export function getHomeRouteForRole(
  role: UserRole | null,
  isAccountantReadonly: boolean = false,
  business?: { industry?: string | null } | null
): string {
  // Note: accountant_readonly restriction is now scoped to /accounting/* routes only
  // For non-accounting routes, use normal role-based home routes
  // This ensures POS/Retail Mode operates independently from Accounting Mode permissions
  const landing =
    business?.industry === "retail"
      ? "/retail/dashboard"
      : "/service/dashboard"

  if (!role) {
    return "/login"
  }

  switch (role) {
    case "cashier":
      return "/pos"
    case "manager":
      return "/retail/dashboard"
    case "admin":
    case "owner":
      return "/retail/dashboard"
    default:
      return landing
  }
}












