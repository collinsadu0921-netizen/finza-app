export type ManualPaymentSubmitOutcome =
  | { kind: "success"; reused: boolean }
  | { kind: "conflict" }
  | { kind: "error"; message: string }
  | { kind: "network" }

export type ManualPaymentSubmitDeps = {
  postPayment: () => Promise<Response>
  parseJson: (res: Response) => Promise<{ reused?: boolean; code?: string; error?: string }>
}

export async function submitManualSalaryPaymentRequest(
  deps: ManualPaymentSubmitDeps
): Promise<ManualPaymentSubmitOutcome> {
  try {
    const res = await deps.postPayment()
    const data = await deps.parseJson(res)
    if (!res.ok) {
      if (data.code === "PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT") {
        return { kind: "conflict" }
      }
      return { kind: "error", message: data.error || "Failed to record salary payment." }
    }
    return { kind: "success", reused: Boolean(data.reused) }
  } catch {
    return { kind: "network" }
  }
}

export function tryCloseManualPaymentModal(isRecording: boolean): "blocked" | "closed" {
  return isRecording ? "blocked" : "closed"
}
