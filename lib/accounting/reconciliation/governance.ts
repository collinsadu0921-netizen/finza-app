/**
 * Ledger adjustment governance: proposal hash and policy.
 * Prevents bait-and-switch; enforces owner / two-person rules.
 */

import crypto from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { ProposedFixStrict } from "./resolution-types"
import type { ReconciliationResult } from "./types"
import { buildFullProposalHashPayload, buildProposalHashPayload } from "./proposalHashPayload"

const SMALL_DELTA_THRESHOLD = 0.01

/** Deterministic hash of proposed_fix only (order-independent for lines). Server-only. */
export function proposalHash(proposed_fix: ProposedFixStrict): string {
  const payload = buildProposalHashPayload(proposed_fix as import("./proposalHashPayload").ProposalFixForHash)
  return crypto.createHash("sha256").update(payload).digest("hex")
}

/**
 * Audit-grade hash of (result + proposed_fix). Used by /mismatches and /resolve.
 * Reconciliation proposals are hash-locked: resolve requires this hash; server
 * re-runs reconciliation, re-generates proposal, compares hash; mismatch → 409 STALE_RECONCILIATION.
 */
export function proposalHashFromResultAndProposal(
  result: ReconciliationResult,
  proposed_fix: ProposedFixStrict
): string {
  const payload = buildFullProposalHashPayload(result, proposed_fix)
  return crypto.createHash("sha256").update(payload).digest("hex")
}

export interface LedgerAdjustmentPolicy {
  adjustment_requires_accountant: boolean
  adjustment_requires_owner_over_amount: number
  adjustment_requires_two_person_rule: boolean
}

const DEFAULT_POLICY: LedgerAdjustmentPolicy = {
  adjustment_requires_accountant: true,
  adjustment_requires_owner_over_amount: 0,
  adjustment_requires_two_person_rule: false,
}

export async function getLedgerAdjustmentPolicy(
  supabase: SupabaseClient,
  businessId: string
): Promise<LedgerAdjustmentPolicy> {
  const { data, error } = await supabase
    .from("ledger_adjustment_policy")
    .select("adjustment_requires_accountant, adjustment_requires_owner_over_amount, adjustment_requires_two_person_rule")
    .eq("business_id", businessId)
    .maybeSingle()
  if (error || !data) return DEFAULT_POLICY
  return {
    adjustment_requires_accountant: data.adjustment_requires_accountant ?? DEFAULT_POLICY.adjustment_requires_accountant,
    adjustment_requires_owner_over_amount: Number(data.adjustment_requires_owner_over_amount ?? 0),
    adjustment_requires_two_person_rule: data.adjustment_requires_two_person_rule ?? false,
  }
}

export function isSmallDelta(delta: number): boolean {
  return Math.abs(delta) <= SMALL_DELTA_THRESHOLD
}

export function requiresOwnerApproval(
  policy: LedgerAdjustmentPolicy,
  delta: number
): boolean {
  if (policy.adjustment_requires_owner_over_amount <= 0) return false
  return Math.abs(delta) > policy.adjustment_requires_owner_over_amount
}

export function requiresTwoPersonApproval(policy: LedgerAdjustmentPolicy): boolean {
  return policy.adjustment_requires_two_person_rule === true
}
