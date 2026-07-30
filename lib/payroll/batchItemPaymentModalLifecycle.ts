export type BatchItemPaymentCloseResult = { kind: "blocked" } | { kind: "closed" }

/** User-initiated close while a request may be in flight. */
export function tryCloseBatchItemPaymentModal(isRecording: boolean): BatchItemPaymentCloseResult {
  if (isRecording) return { kind: "blocked" }
  return { kind: "closed" }
}

export type BatchItemPaymentSuccessReset = {
  clearTarget: true
  clearError: true
  clearIdempotencyKey: true
}

/** Success path reset — must not block on recording state. */
export function batchItemPaymentSuccessReset(): BatchItemPaymentSuccessReset {
  return {
    clearTarget: true,
    clearError: true,
    clearIdempotencyKey: true,
  }
}

export type BatchItemPaymentSubmitOutcome =
  | { kind: "success"; reused: boolean }
  | { kind: "conflict" }
  | { kind: "error"; message: string }
  | { kind: "network" }

export type BatchItemPaymentSubmitDeps = {
  postRecordPayment: () => Promise<Response>
  parseJson: (res: Response) => Promise<{ reused?: boolean; code?: string; error?: string }>
}

export async function submitBatchItemPaymentRequest(
  deps: BatchItemPaymentSubmitDeps
): Promise<BatchItemPaymentSubmitOutcome> {
  try {
    const res = await deps.postRecordPayment()
    const data = await deps.parseJson(res)
    if (!res.ok) {
      if (data.code === "PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT") {
        return { kind: "conflict" }
      }
      return { kind: "error", message: data.error || "Failed to record item payment." }
    }
    return { kind: "success", reused: Boolean(data.reused) }
  } catch {
    return { kind: "network" }
  }
}

export function canStartBatchItemPaymentSubmit(
  hasTarget: boolean,
  isSubmittingRef: boolean,
  isRecording: boolean
): boolean {
  return hasTarget && !isSubmittingRef && !isRecording
}

export const BATCH_ITEM_PAYMENT_NETWORK_UNCERTAINTY_MESSAGE =
  "Finza did not receive a conclusive response. Retrying will use the same reference key and will not create a duplicate."

export const BATCH_ITEM_PAYMENT_CONFLICT_MESSAGE =
  "This payment key was already used with different details. Reload the batch before trying again."
