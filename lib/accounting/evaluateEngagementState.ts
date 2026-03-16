/**
 * Single engagement state evaluator. Pure logic only — no Supabase.
 * All engagement decisions (authority, open, debug, control tower) derive from this.
 */

import {
  NO_ENGAGEMENT,
  ENGAGEMENT_PENDING,
  ENGAGEMENT_SUSPENDED,
  ENGAGEMENT_TERMINATED,
  ENGAGEMENT_NOT_EFFECTIVE,
  ACTIVE,
} from "./reasonCodes"

export type EngagementState =
  | "NO_ENGAGEMENT"
  | "PENDING"
  | "SUSPENDED"
  | "TERMINATED"
  | "NOT_EFFECTIVE"
  | "ACTIVE"

export type EngagementStateResult = {
  state: EngagementState
  reason_code: string
  effective: boolean
}

export type EngagementLike = {
  status: string
  effective_from: string
  effective_to?: string | null
} | null

/**
 * Evaluate engagement state for a single engagement row (or no row).
 * Date comparison uses YYYY-MM-DD; now is converted to date-only.
 */
export function evaluateEngagementState(opts: {
  engagement: EngagementLike
  now?: Date
}): EngagementStateResult {
  const { engagement, now = new Date() } = opts
  const checkDate = now instanceof Date ? now.toISOString().split("T")[0] : String(now).split("T")[0]

  if (!engagement) {
    return {
      state: "NO_ENGAGEMENT",
      reason_code: NO_ENGAGEMENT,
      effective: false,
    }
  }

  const status = String(engagement.status).toLowerCase()
  const effectiveFrom = engagement.effective_from
  const effectiveTo = engagement.effective_to ?? null

  if (status === "pending") {
    return {
      state: "PENDING",
      reason_code: ENGAGEMENT_PENDING,
      effective: false,
    }
  }
  if (status === "suspended") {
    return {
      state: "SUSPENDED",
      reason_code: ENGAGEMENT_SUSPENDED,
      effective: false,
    }
  }
  if (status === "terminated") {
    return {
      state: "TERMINATED",
      reason_code: ENGAGEMENT_TERMINATED,
      effective: false,
    }
  }

  if (status === "accepted" || status === "active") {
    if (effectiveFrom > checkDate) {
      return {
        state: "NOT_EFFECTIVE",
        reason_code: ENGAGEMENT_NOT_EFFECTIVE,
        effective: false,
      }
    }
    if (effectiveTo != null && effectiveTo !== "" && effectiveTo < checkDate) {
      return {
        state: "NOT_EFFECTIVE",
        reason_code: ENGAGEMENT_NOT_EFFECTIVE,
        effective: false,
      }
    }
    return {
      state: "ACTIVE",
      reason_code: ACTIVE,
      effective: true,
    }
  }

  // Unknown status (e.g. legacy or invalid)
  return {
    state: "PENDING",
    reason_code: ENGAGEMENT_PENDING,
    effective: false,
  }
}
