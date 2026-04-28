/**
 * Permission System
 *
 * Permissions are per-member, not fixed to a role.
 * Roles provide a starting set of defaults; any permission can be
 * individually granted or revoked on any member by an owner or admin.
 *
 * Effective permissions = ROLE_DEFAULTS[role] + granted − revoked
 * Owners always have every permission regardless of this system.
 */

// ── Permission registry ──────────────────────────────────────────────────────

export const PERMISSION_GROUPS = [
  {
    group: "Customers",
    permissions: [
      { key: "customers.view",   label: "View customers" },
      { key: "customers.create", label: "Add / edit customers" },
      { key: "customers.delete", label: "Delete customers" },
    ],
  },
  {
    group: "Invoices & Estimates",
    permissions: [
      { key: "invoices.view",    label: "View invoices" },
      { key: "invoices.create",  label: "Create & edit invoices" },
      { key: "invoices.send",    label: "Send invoices to clients" },
      { key: "invoices.delete",  label: "Delete invoices" },
      { key: "estimates.view",   label: "View quotes / estimates" },
      { key: "estimates.create", label: "Create & edit quotes" },
    ],
  },
  {
    group: "Projects & Operations",
    permissions: [
      { key: "jobs.view",   label: "View projects" },
      { key: "jobs.create", label: "Create & edit projects" },
      { key: "jobs.update", label: "Update project status / progress" },
    ],
  },
  {
    group: "Bills & Expenses",
    permissions: [
      { key: "bills.view",     label: "View supplier bills" },
      { key: "bills.create",   label: "Create & edit bills" },
      { key: "expenses.view",  label: "View expenses" },
      { key: "expenses.create",label: "Create & edit expenses" },
    ],
  },
  {
    group: "Accounting & Reports",
    permissions: [
      { key: "reports.view",            label: "View financial reports (P&L, Balance Sheet, Cash Flow)" },
      { key: "accounting.view",         label: "View ledger, chart of accounts, trial balance" },
      { key: "accounting.reconcile",    label: "Perform bank reconciliation" },
      { key: "accounting.close_period", label: "Close accounting periods" },
    ],
  },
  {
    group: "Payroll",
    permissions: [
      { key: "payroll.view",    label: "View payroll runs and payslips" },
      { key: "payroll.run",     label: "Create payroll runs" },
      { key: "payroll.approve", label: "Approve payroll (posts to ledger)" },
      { key: "payroll.pay",     label: "Record payroll salary payments" },
    ],
  },
  {
    group: "Settings & Admin",
    permissions: [
      { key: "settings.view",  label: "View business settings" },
      { key: "settings.edit",  label: "Edit business settings" },
      { key: "team.manage",    label: "Invite, remove, and edit team members" },
      { key: "staff.manage",   label: "Manage payroll staff profiles" },
    ],
  },
] as const

export type Permission = (typeof PERMISSION_GROUPS)[number]["permissions"][number]["key"]

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(
  (g) => g.permissions.map((p) => p.key as Permission)
)

// ── Role defaults ─────────────────────────────────────────────────────────────
// These are the starting permissions for each role.
// Any permission can be individually granted or revoked per member on top of these.

export const ROLE_DEFAULTS: Record<string, Permission[]> = {
  owner: ALL_PERMISSIONS, // owners always have everything

  admin: ALL_PERMISSIONS, // admins start with everything; individual permissions can be revoked

  manager: [
    "customers.view",
    "customers.create",
    "invoices.view",
    "invoices.create",
    "invoices.send",
    "estimates.view",
    "estimates.create",
    "jobs.view",
    "jobs.create",
    "jobs.update",
    "bills.view",
    "expenses.view",
    "expenses.create",
    "reports.view",
    "settings.view", // managers need invoice settings, payment settings, integrations
    "team.manage", // resolveAccess: /service/settings/team
    "staff.manage", // resolveAccess: /service/settings/staff (ORGANIZATION nav)
  ],

  accountant: [
    "customers.view",
    "invoices.view",
    "estimates.view",
    "bills.view",
    "bills.create",
    "expenses.view",
    "expenses.create",
    "reports.view",
    "accounting.view",
    "accounting.reconcile",
    "accounting.close_period",
    "payroll.view",
    "settings.view", // service workspace settings hub; avoids silent redirect to dashboard for firm accountants
  ],

  staff: [
    "customers.view",
    "invoices.view",
    "jobs.view",
    "jobs.update",
    "settings.view", // /service/settings* is guarded by settings.view; staff still lack team.manage / staff.manage / settings.edit
  ],

  employee: [
    "customers.view",
    "jobs.view",
    "jobs.update",
  ],

  cashier: [], // cashier access is handled separately (POS PIN session)
}

// ── Custom permissions shape ──────────────────────────────────────────────────

export interface CustomPermissions {
  granted: Permission[]
  revoked: Permission[]
}

export const DEFAULT_CUSTOM_PERMISSIONS: CustomPermissions = {
  granted: [],
  revoked: [],
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Compute the effective permission set for a member.
 * Owners always receive ALL_PERMISSIONS regardless of custom_permissions.
 */
export function resolveEffectivePermissions(
  role: string,
  customPermissions: CustomPermissions | null | undefined
): Set<Permission> {
  if (role === "owner") return new Set(ALL_PERMISSIONS)

  const base: Permission[] = ROLE_DEFAULTS[role] ?? []
  const granted = customPermissions?.granted ?? []
  const revoked = new Set(customPermissions?.revoked ?? [])

  const effective = new Set<Permission>([...base, ...granted] as Permission[])
  for (const p of revoked) effective.delete(p as Permission)

  return effective
}

/**
 * Check whether a member has a specific permission.
 */
export function hasPermission(
  role: string,
  customPermissions: CustomPermissions | null | undefined,
  permission: Permission
): boolean {
  if (role === "owner") return true
  return resolveEffectivePermissions(role, customPermissions).has(permission)
}

/**
 * Given a permission key, return its human label.
 */
export function getPermissionLabel(key: string): string {
  for (const group of PERMISSION_GROUPS) {
    for (const p of group.permissions) {
      if (p.key === key) return p.label
    }
  }
  return key
}

// ── Named permission constants ────────────────────────────────────────────────
// Convenience namespace so API routes can write PERMISSIONS.PAYROLL_VIEW
// instead of the raw string "payroll.view".

export const PERMISSIONS = {
  // Customers
  CUSTOMERS_VIEW:        "customers.view"            as Permission,
  CUSTOMERS_CREATE:      "customers.create"          as Permission,
  CUSTOMERS_DELETE:      "customers.delete"          as Permission,
  // Invoices & Estimates
  INVOICES_VIEW:         "invoices.view"             as Permission,
  INVOICES_CREATE:       "invoices.create"           as Permission,
  INVOICES_SEND:         "invoices.send"             as Permission,
  INVOICES_DELETE:       "invoices.delete"           as Permission,
  ESTIMATES_VIEW:        "estimates.view"            as Permission,
  ESTIMATES_CREATE:      "estimates.create"          as Permission,
  // Jobs & Operations
  JOBS_VIEW:             "jobs.view"                 as Permission,
  JOBS_CREATE:           "jobs.create"               as Permission,
  JOBS_UPDATE:           "jobs.update"               as Permission,
  // Bills & Expenses
  BILLS_VIEW:            "bills.view"                as Permission,
  BILLS_CREATE:          "bills.create"              as Permission,
  EXPENSES_VIEW:         "expenses.view"             as Permission,
  EXPENSES_CREATE:       "expenses.create"           as Permission,
  // Accounting & Reports
  REPORTS_VIEW:          "reports.view"              as Permission,
  ACCOUNTING_VIEW:       "accounting.view"           as Permission,
  ACCOUNTING_RECONCILE:  "accounting.reconcile"      as Permission,
  ACCOUNTING_CLOSE:      "accounting.close_period"   as Permission,
  // Payroll
  PAYROLL_VIEW:          "payroll.view"              as Permission,
  PAYROLL_CREATE:        "payroll.run"               as Permission,
  PAYROLL_APPROVE:       "payroll.approve"           as Permission,
  PAYROLL_LOCK:          "payroll.approve"           as Permission, // locking = highest payroll privilege
  PAYROLL_PAYSLIPS:      "payroll.approve"           as Permission, // generating payslips requires an approved run
  PAYROLL_PAY:           "payroll.pay"               as Permission,
  // Settings & Admin
  SETTINGS_VIEW:         "settings.view"             as Permission,
  SETTINGS_EDIT:         "settings.edit"             as Permission,
  SETTINGS_TEAM:         "team.manage"               as Permission,
  STAFF_MANAGE:          "staff.manage"              as Permission,
} as const

// ── Permission metadata alias ─────────────────────────────────────────────────
// PERMISSION_META is an alias for PERMISSION_GROUPS; exported so API routes
// can send it to the UI for building the permission editor.
export const PERMISSION_META = PERMISSION_GROUPS
