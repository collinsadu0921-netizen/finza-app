import { hubtelAmountsMatch, type NormalizedHubtelStatusResponse } from "./hubtelClient"

export type HubtelSettlementEvaluation = {
  expectedAmount: number
  grossAmount: number | null
  charges: number | null
  amountAfterCharges: number | null
  settlementAmount: number | null
  matches: boolean
}

/** Merchant net settlement: prefer amountAfterCharges, else gross amount. */
export function resolveHubtelSettlementAmount(
  statusData: Pick<NormalizedHubtelStatusResponse, "grossAmount" | "amountAfterCharges">
): number | null {
  if (statusData.amountAfterCharges != null && statusData.amountAfterCharges > 0) {
    return statusData.amountAfterCharges
  }
  if (statusData.grossAmount != null && statusData.grossAmount > 0) {
    return statusData.grossAmount
  }
  return null
}

export function evaluateHubtelSettlementAmount(
  expectedAmount: number,
  statusData: Pick<NormalizedHubtelStatusResponse, "grossAmount" | "amountAfterCharges" | "charges">
): HubtelSettlementEvaluation {
  const settlementAmount = resolveHubtelSettlementAmount(statusData)
  return {
    expectedAmount,
    grossAmount: statusData.grossAmount,
    charges: statusData.charges,
    amountAfterCharges: statusData.amountAfterCharges,
    settlementAmount,
    matches:
      settlementAmount != null && hubtelAmountsMatch(expectedAmount, settlementAmount),
  }
}

export function hubtelStatusPayloadIndicatesPaid(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false
  const raw = payload as Record<string, unknown>
  const data =
    raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
      ? (raw.data as Record<string, unknown>)
      : raw.Data && typeof raw.Data === "object" && !Array.isArray(raw.Data)
        ? (raw.Data as Record<string, unknown>)
        : raw
  const status = String(data.status ?? data.Status ?? "")
    .trim()
    .toLowerCase()
  return status === "paid"
}

/** Sync guard for failed sessions that may be retried after amount_mismatch fix. */
export function isRecoverableAmountMismatchFailure(params: {
  status: string
  payment_id: string | null
  last_event_payload: Record<string, unknown> | null | undefined
}): boolean {
  if (params.status !== "failed") return false
  if (params.payment_id) return false
  const last = params.last_event_payload ?? {}
  if (last.verificationError !== "amount_mismatch") return false
  const hubtelStatus = last.hubtelStatus
  return hubtelStatusPayloadIndicatesPaid(hubtelStatus)
}

export function logHubtelSettlementDecision(fields: HubtelSettlementEvaluation & {
  clientReference: string
  verificationOutcome: string
}): void {
  console.info(
    JSON.stringify({
      tag: "hubtel_settlement_amount",
      ts: new Date().toISOString(),
      clientReference: fields.clientReference,
      expectedAmount: fields.expectedAmount,
      grossAmount: fields.grossAmount,
      charges: fields.charges,
      amountAfterCharges: fields.amountAfterCharges,
      settlementAmount: fields.settlementAmount,
      matches: fields.matches,
      verificationOutcome: fields.verificationOutcome,
    })
  )
}
