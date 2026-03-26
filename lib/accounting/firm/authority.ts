/**
 * Firm Authority System
 * 
 * Handles authority checks for accounting firm users based on:
 * - Firm role (partner, senior, junior, readonly)
 * - Engagement access level (read, write, approve)
 * - Action type being performed
 * - Engagement status (pending, active, suspended, terminated)
 */

export type FirmRole = "partner" | "senior" | "junior" | "readonly"
export type EngagementAccessLevel = "read" | "write" | "approve"
export type EngagementStatus = "pending" | "active" | "suspended" | "terminated" | null

export type ActionType =
  | "create_engagement"
  | "update_engagement"
  | "terminate_engagement"
  | "approve_journal"
  | "post_journal"
  | "close_period"
  | "reopen_period"
  | "create_opening_balance"
  | "approve_opening_balance"
  | "post_opening_balance"
  | "view_ledger"
  | "view_trial_balance"
  | "create_adjustment"
  | "approve_adjustment"
  | "post_adjustment"
  | "view_reports"
  | "manage_clients"
  | "manage_firm_users"
  | "configure_firm"
  | "create_manual_journal_draft"
  | "view_client_data"
  | "bulk_operations"
  | "create_journal"

export interface ActionRequirement {
  description: string
  minFirmRole: FirmRole
  minEngagementAccess?: EngagementAccessLevel
}

/**
 * Authority matrix defining minimum requirements for each action
 */
export const AUTHORITY_MATRIX: Record<ActionType, ActionRequirement> = {
  // Administrative actions (Partner only)
  create_engagement: {
    description: "Create Client Engagement",
    minFirmRole: "partner",
  },
  update_engagement: {
    description: "Update Client Engagement",
    minFirmRole: "partner",
  },
  terminate_engagement: {
    description: "Terminate Client Engagement",
    minFirmRole: "partner",
  },
  manage_clients: {
    description: "Manage Clients",
    minFirmRole: "partner",
  },
  manage_firm_users: {
    description: "Manage Firm Users",
    minFirmRole: "partner",
  },
  configure_firm: {
    description: "Configure Firm Settings",
    minFirmRole: "partner",
  },

  // Period management (Partner only)
  close_period: {
    description: "Close Accounting Period",
    minFirmRole: "partner",
  },
  reopen_period: {
    description: "Reopen Accounting Period",
    minFirmRole: "partner",
  },

  // Approval actions (Partner or Senior)
  approve_journal: {
    description: "Approve Journal Entry",
    minFirmRole: "senior",
    minEngagementAccess: "approve",
  },
  approve_opening_balance: {
    description: "Approve Opening Balance",
    minFirmRole: "senior",
    minEngagementAccess: "approve",
  },
  approve_adjustment: {
    description: "Approve Adjustment Journal",
    minFirmRole: "senior",
    minEngagementAccess: "approve",
  },

  // Posting actions (Partner or Senior with approve access)
  post_journal: {
    description: "Post Journal Entry to Ledger",
    minFirmRole: "senior",
    minEngagementAccess: "approve",
  },
  post_opening_balance: {
    description: "Post Opening Balance to Ledger",
    minFirmRole: "senior",
    minEngagementAccess: "approve",
  },
  post_adjustment: {
    description: "Post Adjustment Journal to Ledger",
    minFirmRole: "senior",
    minEngagementAccess: "approve",
  },

  // Creation actions (Write access)
  create_opening_balance: {
    description: "Create Opening Balance Import",
    minFirmRole: "junior",
    minEngagementAccess: "write",
  },
  create_adjustment: {
    description: "Create Adjustment Journal",
    minFirmRole: "junior",
    minEngagementAccess: "write",
  },

  // View actions (Read access)
  view_ledger: {
    description: "View General Ledger",
    minFirmRole: "readonly",
    minEngagementAccess: "read",
  },
  view_trial_balance: {
    description: "View Trial Balance",
    minFirmRole: "readonly",
    minEngagementAccess: "read",
  },
  view_reports: {
    description: "View Financial Reports",
    minFirmRole: "readonly",
    minEngagementAccess: "read",
  },
  create_manual_journal_draft: {
    description: "Create Manual Journal Draft",
    minFirmRole: "junior",
    minEngagementAccess: "write",
  },
  view_client_data: {
    description: "View Client Data",
    minFirmRole: "readonly",
    minEngagementAccess: "read",
  },
  bulk_operations: {
    description: "Bulk Operations",
    minFirmRole: "partner",
  },
  create_journal: {
    description: "Create Journal",
    minFirmRole: "junior",
    minEngagementAccess: "write",
  },
}

/**
 * Get capabilities description for a role
 */
export function getRoleCapabilities(role: FirmRole): string {
  switch (role) {
    case "partner":
      return "Full access to all firm operations. Can create engagements, manage users, approve and post entries, close/reopen periods, and configure firm settings."
    case "senior":
      return "Can approve and post entries, create journals and adjustments, view all reports. Cannot manage engagements, users, or close periods."
    case "junior":
      return "Can create journals and adjustments, view reports. Cannot approve, post, or manage engagements. Requires write access level for creation actions."
    case "readonly":
      return "View-only access. Can view ledger, trial balance, and reports. Cannot create, approve, or post any entries. Requires read access level."
    default:
      return "No capabilities defined for this role."
  }
}

export interface AuthorityResolution {
  allowed: boolean
  reason?: string
  reasonCode?: string
  escalationHint?: string
  requiredEngagementAccess?: EngagementAccessLevel
  requiredFirmRole?: FirmRole
}

export interface ResolveAuthorityParams {
  firmRole: FirmRole | null
  engagementAccess: EngagementAccessLevel | null
  action: ActionType
  engagementStatus?: EngagementStatus | null
}

/**
 * Resolve authority for an action based on firm role, engagement access, and action type
 */
export function resolveAuthority(params: ResolveAuthorityParams): AuthorityResolution {
  const { firmRole, engagementAccess, action, engagementStatus = null } = params

  // No role = no access
  if (!firmRole) {
    return {
      allowed: false,
      reason: "You are not a member of this firm",
      reasonCode: "NO_FIRM_ROLE",
    }
  }

  // Check engagement status if engagement access is required
  if (engagementAccess && engagementStatus !== "active" && engagementStatus !== null) {
    return {
      allowed: false,
      reason: `Engagement is ${engagementStatus}. Active engagement required.`,
      reasonCode: "ENGAGEMENT_NOT_ACTIVE",
    }
  }

  // Action-specific checks
  switch (action) {
    // Administrative actions (Partner only)
    case "create_engagement":
    case "update_engagement":
    case "terminate_engagement":
    case "manage_clients":
    case "manage_firm_users":
    case "configure_firm":
      if (firmRole !== "partner") {
        return {
          allowed: false,
          reason: "Only Partners can perform this action",
          reasonCode: "INSUFFICIENT_FIRM_ROLE",
          escalationHint: "Contact a Partner to perform this action",
        }
      }
      break

    // Posting actions (Partner or Senior with approve access)
    case "post_journal":
    case "post_opening_balance":
    case "post_adjustment":
      if (firmRole === "readonly") {
        return {
          allowed: false,
          reason: "Read-only users cannot post to the ledger",
          reasonCode: "READONLY_ROLE",
        }
      }
      if (firmRole !== "partner" && engagementAccess !== "approve") {
        return {
          allowed: false,
          reason: "Approve access level or Partner role required",
          reasonCode: "INSUFFICIENT_ACCESS",
          escalationHint: "Request approve access or Partner role",
        }
      }
      break

    // Approval actions (Partner or Senior with approve access)
    case "approve_journal":
    case "approve_opening_balance":
    case "approve_adjustment":
      if (firmRole === "readonly" || firmRole === "junior") {
        return {
          allowed: false,
          reason: "Only Partners and Seniors can approve",
          reasonCode: "INSUFFICIENT_FIRM_ROLE",
          escalationHint: "Request Senior or Partner role",
        }
      }
      if (engagementAccess && engagementAccess !== "approve") {
        return {
          allowed: false,
          reason: "Approve access level required",
          reasonCode: "INSUFFICIENT_ACCESS",
          escalationHint: "Request approve access for this client",
        }
      }
      break

    // Period close/reopen (Partner only)
    case "close_period":
    case "reopen_period":
      if (firmRole !== "partner") {
        return {
          allowed: false,
          reason: "Only Partners can close or reopen periods",
          reasonCode: "INSUFFICIENT_FIRM_ROLE",
          escalationHint: "Contact a Partner to close/reopen the period",
        }
      }
      break

    // Creation actions (Write or Approve access)
    case "create_journal":
    case "create_opening_balance":
    case "create_adjustment":
      if (engagementAccess && engagementAccess === "read") {
        return {
          allowed: false,
          reason: "Write or Approve access required",
          reasonCode: "INSUFFICIENT_ACCESS",
          escalationHint: "Request write or approve access for this client",
        }
      }
      if (firmRole === "readonly") {
        return {
          allowed: false,
          reason: "Read-only users cannot create entries",
          reasonCode: "READONLY_ROLE",
        }
      }
      break

    // View actions (any access level, except readonly for sensitive views)
    case "view_ledger":
    case "view_trial_balance":
    case "view_reports":
      if (!engagementAccess) {
        return {
          allowed: false,
          reason: "Engagement access required to view this client's data",
          reasonCode: "NO_ENGAGEMENT_ACCESS",
        }
      }
      break
  }

  // Default: allow if we reach here
  return { allowed: true }
}

/**
 * Check if user can perform an action (simplified interface for AuthorityGuard)
 */
export function canPerformAction(
  userRole: FirmRole | null,
  engagementAccess: EngagementAccessLevel | null,
  actionType: ActionType
): { canPerform: boolean; reason?: string; escalationHint?: string } {
  const resolution = resolveAuthority({
    firmRole: userRole,
    engagementAccess,
    action: actionType,
    engagementStatus: null, // Assume active if engagement access is provided
  })

  return {
    canPerform: resolution.allowed,
    reason: resolution.reason,
    escalationHint: resolution.escalationHint,
  }
}
