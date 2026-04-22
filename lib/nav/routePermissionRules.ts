import type { Permission } from "@/lib/permissions"

/**
 * Route → permission for non-owner team members.
 * Order matters: first matching prefix wins (most specific prefixes first).
 * Used by resolveAccess and nav visibility helpers.
 */
export const ROUTE_PERMISSION_RULES: Array<{ prefix: string; permission: Permission }> = [
  { prefix: "/service/settings/team", permission: "team.manage" },
  { prefix: "/service/settings/staff", permission: "staff.manage" },
  { prefix: "/service/payroll/advances", permission: "payroll.view" },
  { prefix: "/service/payroll", permission: "payroll.view" },
  { prefix: "/payroll", permission: "payroll.view" },
  { prefix: "/service/reports/trial-balance", permission: "accounting.view" },
  { prefix: "/service/reports", permission: "reports.view" },
  { prefix: "/service/ledger", permission: "accounting.view" },
  { prefix: "/service/accounting", permission: "accounting.view" },
  { prefix: "/service/expenses/activity", permission: "expenses.view" },
  { prefix: "/service/expenses", permission: "expenses.view" },
  { prefix: "/service/bills", permission: "bills.view" },
  { prefix: "/service/credit-notes", permission: "invoices.view" },
  { prefix: "/service/proforma", permission: "invoices.view" },
  { prefix: "/service/recurring", permission: "invoices.view" },
  { prefix: "/service/payments", permission: "invoices.view" },
  { prefix: "/service/invoices", permission: "invoices.view" },
  { prefix: "/service/estimates", permission: "estimates.view" },
  { prefix: "/service/proposals", permission: "estimates.view" },
  { prefix: "/service/customers", permission: "customers.view" },
  { prefix: "/service/jobs", permission: "jobs.view" },
  { prefix: "/service/services", permission: "jobs.view" },
  { prefix: "/service/materials", permission: "jobs.view" },
  { prefix: "/service/health", permission: "accounting.view" },
  { prefix: "/service/invitations", permission: "settings.view" },
  { prefix: "/service/settings", permission: "settings.view" },
  { prefix: "/settings/staff", permission: "staff.manage" },
  { prefix: "/credit-notes", permission: "invoices.view" },
  { prefix: "/recurring", permission: "invoices.view" },
  { prefix: "/invoices", permission: "invoices.view" },
  { prefix: "/payments", permission: "invoices.view" },
  { prefix: "/expenses", permission: "expenses.view" },
  { prefix: "/customers", permission: "customers.view" },
  { prefix: "/estimates", permission: "estimates.view" },
  { prefix: "/bills", permission: "bills.view" },
  { prefix: "/audit-log", permission: "reports.view" },
  { prefix: "/accounting", permission: "accounting.view" },
  { prefix: "/admin", permission: "settings.edit" },
  // Retail admin: operational / reporting pages — managers have reports.view, not settings.edit
  { prefix: "/retail/expenses/new", permission: "expenses.create" },
  { prefix: "/retail/expenses", permission: "expenses.view" },
  { prefix: "/retail/reports", permission: "reports.view" },
  { prefix: "/retail/admin/analytics", permission: "reports.view" },
  { prefix: "/retail/admin/low-stock", permission: "reports.view" },
  { prefix: "/retail/admin/inventory-dashboard", permission: "reports.view" },
  { prefix: "/retail/admin/stock-transfers", permission: "reports.view" },
  { prefix: "/retail/admin/bulk-import", permission: "reports.view" },
  { prefix: "/retail/admin/suppliers", permission: "bills.view" },
  { prefix: "/retail/admin/purchase-orders", permission: "bills.view" },
  { prefix: "/retail/admin", permission: "settings.edit" },
  { prefix: "/reports/vat", permission: "reports.view" },
  { prefix: "/reports", permission: "reports.view" },
  { prefix: "/vat-returns", permission: "reports.view" },
  { prefix: "/service/assets", permission: "reports.view" },
  { prefix: "/assets", permission: "reports.view" },
]

/** Normalize pathname (no query, no trailing slash except root). */
export function normalizePathForPermission(path: string): string {
  const raw = path.split("?")[0]
  return raw.endsWith("/") && raw !== "/" ? raw.slice(0, -1) : raw
}

/** Returns required permission, or null if this path has no extra permission gate. */
export function getRequiredPermissionForPath(normalizedPath: string): Permission | null {
  for (const { prefix, permission } of ROUTE_PERMISSION_RULES) {
    if (normalizedPath === prefix || normalizedPath.startsWith(prefix + "/")) {
      return permission
    }
  }
  return null
}
