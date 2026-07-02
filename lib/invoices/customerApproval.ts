export const CUSTOMER_APPROVAL_STATUSES = [
  "not_requested",
  "pending_approval",
  "approved",
  "rejected",
] as const

export type CustomerApprovalStatus = (typeof CUSTOMER_APPROVAL_STATUSES)[number]

export type CustomerApprovalAction = "request" | "approve" | "reject" | "reset"

export const CUSTOMER_APPROVAL_LABELS: Record<CustomerApprovalStatus, string> = {
  not_requested: "Not requested",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
}

export const CUSTOMER_APPROVAL_AUDIT_ACTIONS: Record<CustomerApprovalAction, string> = {
  request: "invoice.approval_requested",
  approve: "invoice.approved_by_customer",
  reject: "invoice.rejected_by_customer",
  reset: "invoice.approval_reset",
}

export function isCustomerApprovalStatus(value: string): value is CustomerApprovalStatus {
  return (CUSTOMER_APPROVAL_STATUSES as readonly string[]).includes(value)
}

export function parseCustomerApprovalAction(body: unknown): CustomerApprovalAction | null {
  if (!body || typeof body !== "object") return null
  const record = body as Record<string, unknown>

  const action = typeof record.action === "string" ? record.action.trim() : ""
  if (action === "request" || action === "approve" || action === "reject" || action === "reset") {
    return action
  }

  const status = typeof record.status === "string" ? record.status.trim() : ""
  if (status === "pending_approval") return "request"
  if (status === "approved") return "approve"
  if (status === "rejected") return "reject"
  if (status === "not_requested") return "reset"

  return null
}

export function buildCustomerApprovalPatch(
  action: CustomerApprovalAction,
  userId: string,
  options?: { note?: string | null; method?: string | null }
): Record<string, unknown> {
  const now = new Date().toISOString()
  const note = options?.note?.trim() || null
  const method = options?.method?.trim() || null

  switch (action) {
    case "request":
      return {
        customer_approval_status: "pending_approval",
        customer_approval_requested_at: now,
        customer_approval_requested_by: userId,
        customer_approval_updated_by: userId,
        customer_approved_at: null,
        customer_rejected_at: null,
      }
    case "approve":
      return {
        customer_approval_status: "approved",
        customer_approved_at: now,
        customer_rejected_at: null,
        customer_approval_updated_by: userId,
        customer_approval_method: method,
        customer_approval_note: note,
      }
    case "reject":
      return {
        customer_approval_status: "rejected",
        customer_rejected_at: now,
        customer_approved_at: null,
        customer_approval_updated_by: userId,
        customer_approval_note: note,
      }
    case "reset":
      return {
        customer_approval_status: "not_requested",
        customer_approval_requested_at: null,
        customer_approved_at: null,
        customer_rejected_at: null,
        customer_approval_note: null,
        customer_approval_method: null,
        customer_approval_requested_by: null,
        customer_approval_updated_by: userId,
      }
  }
}

export function customerApprovalActionsForStatus(
  status: CustomerApprovalStatus,
  readOnly: boolean
): CustomerApprovalAction[] {
  if (readOnly) return []
  switch (status) {
    case "not_requested":
      return ["request", "approve", "reject"]
    case "pending_approval":
      return ["approve", "reject", "reset"]
    case "approved":
      return ["reset", "reject"]
    case "rejected":
      return ["request", "approve", "reset"]
    default:
      return []
  }
}

export const CUSTOMER_APPROVAL_ACTION_LABELS: Record<CustomerApprovalAction, string> = {
  request: "Request approval",
  approve: "Mark approved",
  reject: "Mark rejected",
  reset: "Reset approval",
}
