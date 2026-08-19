import { evaluateEngagementState } from "@/lib/accounting/evaluateEngagementState"
import type { EngagementIssueRow } from "./types"

export type FirmMembership = {
  firm_id: string
}

export type EngagementScopeRow = {
  id: string
  accounting_firm_id: string
  client_business_id: string
  status: string
  access_level?: string | null
  effective_from: string
  effective_to: string | null
  created_at?: string | null
}

export type ResolvedWorkFirm = {
  firmId: string | null
  reason: "ok" | "no_membership" | "firm_not_member"
}

/**
 * Work is scoped to one active firm.
 * requestedFirmId must be a membership when provided.
 * If omitted and the user has multiple firms, pick a stable first id
 * (sorted) — remaining multi-firm UX debt is documented, not rewritten here.
 */
export function resolveWorkFirmId(opts: {
  memberships: FirmMembership[]
  requestedFirmId?: string | null
}): ResolvedWorkFirm {
  const memberships = opts.memberships
    .map((m) => m.firm_id)
    .filter((id): id is string => Boolean(id))
  const unique = [...new Set(memberships)].sort()

  if (unique.length === 0) {
    return { firmId: null, reason: "no_membership" }
  }

  const requested = opts.requestedFirmId?.trim() ?? ""
  if (requested) {
    if (!unique.includes(requested)) {
      return { firmId: null, reason: "firm_not_member" }
    }
    return { firmId: requested, reason: "ok" }
  }

  return { firmId: unique[0], reason: "ok" }
}

export type PartitionedEngagements = {
  effectiveBusinessIds: string[]
  issues: EngagementIssueRow[]
}

export function partitionFirmEngagements(
  rows: EngagementScopeRow[],
  now: Date = new Date()
): PartitionedEngagements {
  const effective = new Set<string>()
  const issues: EngagementIssueRow[] = []
  const seenIssue = new Set<string>()

  for (const row of rows) {
    const evaluated = evaluateEngagementState({
      engagement: {
        status: row.status,
        effective_from: row.effective_from,
        effective_to: row.effective_to,
      },
      now,
    })

    if (evaluated.effective) {
      effective.add(row.client_business_id)
      continue
    }

    if (
      evaluated.state === "PENDING" ||
      evaluated.state === "SUSPENDED" ||
      evaluated.state === "TERMINATED" ||
      evaluated.state === "NOT_EFFECTIVE"
    ) {
      const key = `${evaluated.state}:${row.id}`
      if (seenIssue.has(key)) continue
      seenIssue.add(key)
      issues.push({
        id: row.id,
        client_business_id: row.client_business_id,
        state: evaluated.state,
        status: row.status,
        created_at: row.created_at ?? null,
      })
    }
  }

  return {
    effectiveBusinessIds: [...effective],
    issues,
  }
}
