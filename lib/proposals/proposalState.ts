export const PROPOSAL_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "rejected",
  "expired",
  "converted",
] as const

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

export function isProposalStatus(value: string): value is ProposalStatus {
  return (PROPOSAL_STATUSES as readonly string[]).includes(value)
}

export function normalizeProposalStatus(value: string | null | undefined): ProposalStatus {
  const v = (value || "").trim().toLowerCase()
  return isProposalStatus(v) ? v : "draft"
}

/** Terminal: no further client/staff workflow on this proposal (v1). */
export function proposalStatusIsTerminal(status: ProposalStatus): boolean {
  return status === "accepted" || status === "rejected" || status === "expired" || status === "converted"
}

/**
 * Staff may edit content (sections, pricing, assets) while the proposal is not terminal.
 * Differs from estimates: once accepted/rejected, proposal content is locked.
 */
export function proposalCanBeEditedByStaff(status: ProposalStatus): boolean {
  return !proposalStatusIsTerminal(status)
}

/** @deprecated Use proposalCanBeEditedByStaff */
export function proposalStatusIsEditable(status: ProposalStatus): boolean {
  return proposalCanBeEditedByStaff(status)
}

/** First-time send: only from draft. */
export function proposalStaffSendInitialAllowed(status: ProposalStatus): boolean {
  return status === "draft"
}

/** Email, WhatsApp share, or manual mark-sent — not allowed once proposal is terminal. */
export function proposalStaffOutboundChannelsAllowed(status: ProposalStatus): boolean {
  return status === "draft" || status === "sent" || status === "viewed"
}

/**
 * Public accept/reject: only while the proposal is out for client review.
 * Not allowed from draft (not yet sent) or after terminal decision.
 */
export function proposalPublicAcceptAllowed(status: ProposalStatus): boolean {
  return status === "sent" || status === "viewed"
}

export function proposalPublicRejectAllowed(status: ProposalStatus): boolean {
  return proposalPublicAcceptAllowed(status)
}

export function proposalPublicActionsAllowed(status: ProposalStatus): boolean {
  return proposalPublicAcceptAllowed(status)
}

/** Proposal already linked to an estimate from conversion (idempotent guard). */
export function proposalIsLinkedToEstimate(convertedEstimateId: string | null | undefined): boolean {
  return typeof convertedEstimateId === "string" && convertedEstimateId.length > 0
}

/** Only accepted proposals may become estimates in v1 (staff conversion). */
export function proposalStaffConvertToEstimateStatusAllowed(status: ProposalStatus): boolean {
  return status === "accepted"
}

/** Pricing modes that can be mapped into estimate line items without custom logic. */
export function proposalConversionPricingModeAllowed(pricingMode: string | null | undefined): boolean {
  const m = (pricingMode || "none").trim().toLowerCase()
  return m === "fixed" || m === "line_items"
}

/**
 * When non-null, conversion should be blocked; map to HTTP errors in the API layer.
 * Keeps proposal lifecycle separate from estimate document state.
 */
export function proposalConversionBlockReason(params: {
  status: ProposalStatus
  converted_estimate_id: string | null | undefined
  pricing_mode: string | null | undefined
}): "already_linked" | "wrong_status" | "pricing" | null {
  if (proposalIsLinkedToEstimate(params.converted_estimate_id)) return "already_linked"
  if (params.status === "converted") return "already_linked"
  if (!proposalStaffConvertToEstimateStatusAllowed(params.status)) return "wrong_status"
  if (!proposalConversionPricingModeAllowed(params.pricing_mode)) return "pricing"
  return null
}

/** Valid next statuses from a given status (subset used by v1 APIs). */
export function proposalAllowedStatusTransitionsFrom(from: ProposalStatus): ProposalStatus[] {
  switch (from) {
    case "draft":
      return ["draft", "sent"]
    case "sent":
      return ["sent", "viewed", "accepted", "rejected"]
    case "viewed":
      return ["viewed", "accepted", "rejected"]
    case "accepted":
      return ["accepted", "converted"]
    case "rejected":
    case "expired":
    case "converted":
      return [from]
    default:
      return [from]
  }
}

export function proposalTransitionStaffSendIsValid(from: ProposalStatus): boolean {
  return from === "draft"
}

export function proposalTransitionPublicViewedIsValid(from: ProposalStatus): boolean {
  return from === "sent"
}

export function proposalTransitionPublicAcceptIsValid(from: ProposalStatus): boolean {
  return from === "sent" || from === "viewed"
}

export function proposalTransitionPublicRejectIsValid(from: ProposalStatus): boolean {
  return proposalTransitionPublicAcceptIsValid(from)
}

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  converted: "Converted",
}
