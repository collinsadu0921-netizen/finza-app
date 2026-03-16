/**
 * Document State Management
 * 
 * Enforces canonical document states and allowed transitions.
 * Documents are immutable once issued - editing creates new revisions.
 */

// ============================================================================
// ESTIMATE STATES
// ============================================================================

export type EstimateStatus = "draft" | "sent" | "accepted" | "expired" | "converted"

export const ESTIMATE_STATES = {
  draft: "draft",
  sent: "sent",
  accepted: "accepted",
  expired: "expired",
  converted: "converted",
} as const

// Allowed actions per estimate state
export const ESTIMATE_ACTIONS = {
  draft: ["send", "edit", "delete"] as const,
  sent: ["resend", "edit", "convert_to_order", "convert_to_invoice"] as const,
  accepted: ["convert_to_order", "convert_to_invoice"] as const,
  expired: ["duplicate"] as const,
  converted: [] as const, // View only
} as const

// State transitions for estimates
export const ESTIMATE_TRANSITIONS = {
  draft: ["sent"] as const,
  sent: [], // No state change on resend
  accepted: [] as const,
  expired: [] as const,
  converted: [] as const,
} as const

// ============================================================================
// ORDER STATES (COMMERCIAL + EXECUTION)
// ============================================================================

// Commercial state (controls editability & billing)
export type OrderStatus = "draft" | "issued" | "converted" | "cancelled"

export const ORDER_STATES = {
  draft: "draft",
  issued: "issued",
  converted: "converted",
  cancelled: "cancelled",
} as const

// Execution state (tracks fulfillment progress)
export type OrderExecutionStatus = "pending" | "active" | "completed"

export const ORDER_EXECUTION_STATES = {
  pending: "pending",
  active: "active",
  completed: "completed",
} as const

// Allowed actions per order commercial state
export const ORDER_ACTIONS = {
  draft: ["issue"] as const,
  issued: ["resend", "edit", "convert_to_invoice"] as const,
  converted: [] as const, // View only
  cancelled: ["duplicate"] as const,
} as const

// Commercial state transitions for orders
export const ORDER_TRANSITIONS = {
  draft: ["issued"] as const,
  issued: ["converted", "cancelled"] as const,
  converted: [] as const,
  cancelled: [] as const,
} as const

// Execution status transitions (independent from commercial state)
export const ORDER_EXECUTION_TRANSITIONS = {
  pending: ["active"] as const,
  active: ["completed"] as const,
  completed: [] as const,
} as const

// ============================================================================
// INVOICE STATES (STRICT - IMMUTABLE AFTER ISSUED)
// ============================================================================

export type InvoiceStatus = "draft" | "issued" | "paid" | "overdue" | "void"

export const INVOICE_STATES = {
  draft: "draft",
  issued: "issued",
  paid: "paid",
  overdue: "overdue",
  void: "void",
} as const

// Allowed actions per invoice state
export const INVOICE_ACTIONS = {
  draft: ["issue"] as const,
  issued: ["record_payment"] as const,
  paid: [] as const, // View / Receipt only
  overdue: ["record_payment"] as const,
  void: ["duplicate"] as const,
} as const

// State transitions for invoices
export const INVOICE_TRANSITIONS = {
  draft: ["issued"] as const,
  issued: ["paid", "overdue"] as const,
  paid: [] as const,
  overdue: ["paid"] as const,
  void: [] as const,
} as const

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Check if an action is allowed for a given estimate state
 */
export function isEstimateActionAllowed(
  status: EstimateStatus,
  action: string
): boolean {
  const allowedActions = ESTIMATE_ACTIONS[status] || []
  return allowedActions.includes(action as any)
}

/**
 * Check if an action is allowed for a given order state
 */
export function isOrderActionAllowed(
  status: OrderStatus,
  action: string
): boolean {
  const allowedActions = ORDER_ACTIONS[status] || []
  return allowedActions.includes(action as any)
}

/**
 * Check if an action is allowed for a given invoice state
 */
export function isInvoiceActionAllowed(
  status: InvoiceStatus,
  action: string
): boolean {
  const allowedActions = INVOICE_ACTIONS[status] || []
  return allowedActions.includes(action as any)
}

/**
 * Check if a state transition is valid for estimates
 */
export function isValidEstimateTransition(
  from: EstimateStatus,
  to: EstimateStatus
): boolean {
  const allowedTransitions = ESTIMATE_TRANSITIONS[from] || []
  return allowedTransitions.includes(to as any)
}

/**
 * Check if a state transition is valid for orders
 */
export function isValidOrderTransition(
  from: OrderStatus,
  to: OrderStatus
): boolean {
  const allowedTransitions = ORDER_TRANSITIONS[from] || []
  return allowedTransitions.includes(to as any)
}

/**
 * Check if a state transition is valid for invoices
 */
export function isValidInvoiceTransition(
  from: InvoiceStatus,
  to: InvoiceStatus
): boolean {
  const allowedTransitions = INVOICE_TRANSITIONS[from] || []
  return allowedTransitions.includes(to as any)
}

/**
 * Check if a document can be edited (draft only, or creates revision)
 */
export function canEditEstimate(status: EstimateStatus): boolean {
  return status === "draft" || status === "sent"
}

/**
 * Check if an order can be edited
 * Returns: "direct" (edit same record), "revision" (create new revision), or false (not editable)
 * 
 * Rules:
 * - draft: direct edit
 * - issued (not completed): create revision
 * - issued (completed): not editable (can only convert to invoice)
 * - converted/cancelled: not editable
 */
export function canEditOrder(
  order: { status: OrderStatus; execution_status?: OrderExecutionStatus | string | null }
): "direct" | "revision" | false {
  if (order.status === "draft") {
    return "direct"
  }

  if (
    order.status === "issued" &&
    order.execution_status !== "completed"
  ) {
    return "revision"
  }

  return false
}

export function canEditInvoice(status: InvoiceStatus): boolean {
  return status === "draft" // Invoices are immutable after issued
}

/**
 * Check if editing should create a revision (sent/issued documents)
 */
export function shouldCreateRevision(
  documentType: "estimate" | "order" | "invoice",
  status: string,
  executionStatus?: string | null
): boolean {
  if (documentType === "invoice") {
    return false // Invoices are never editable after issued
  }
  if (documentType === "estimate") {
    return status === "sent" // Editing sent estimate creates revision
  }
  if (documentType === "order") {
    // For orders, check both commercial and execution state
    return status === "issued" && executionStatus !== "completed"
  }
  return false
}

/**
 * Check if execution status transition is valid
 */
export function isValidExecutionTransition(
  from: OrderExecutionStatus,
  to: OrderExecutionStatus
): boolean {
  const allowedTransitions = ORDER_EXECUTION_TRANSITIONS[from] || []
  return allowedTransitions.includes(to as any)
}
