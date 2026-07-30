import {
  BATCH_ITEM_PAYMENT_NETWORK_UNCERTAINTY_MESSAGE,
  batchItemPaymentSuccessReset,
  canStartBatchItemPaymentSubmit,
  submitBatchItemPaymentRequest,
  tryCloseBatchItemPaymentModal,
} from "@/lib/payroll/batchItemPaymentModalLifecycle"

function mockResponse(ok: boolean, body: Record<string, unknown>, status = ok ? 200 : 409) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

describe("batchItemPaymentModalLifecycle", () => {
  describe("tryCloseBatchItemPaymentModal", () => {
    it("blocks close during request", () => {
      expect(tryCloseBatchItemPaymentModal(true)).toEqual({ kind: "blocked" })
    })

    it("allows explicit close when idle", () => {
      expect(tryCloseBatchItemPaymentModal(false)).toEqual({ kind: "closed" })
    })
  })

  describe("batchItemPaymentSuccessReset", () => {
    it("clears target, error and idempotency key flags", () => {
      expect(batchItemPaymentSuccessReset()).toEqual({
        clearTarget: true,
        clearError: true,
        clearIdempotencyKey: true,
      })
    })

    it("does not depend on recording state", () => {
      const reset = batchItemPaymentSuccessReset()
      expect(Object.keys(reset)).not.toContain("blocked")
    })
  })

  describe("canStartBatchItemPaymentSubmit", () => {
    it("prevents double submit", () => {
      expect(canStartBatchItemPaymentSubmit(true, true, false)).toBe(false)
      expect(canStartBatchItemPaymentSubmit(true, false, true)).toBe(false)
      expect(canStartBatchItemPaymentSubmit(true, false, false)).toBe(true)
    })
  })

  describe("submitBatchItemPaymentRequest", () => {
    it("returns success for ok response", async () => {
      const outcome = await submitBatchItemPaymentRequest({
        postRecordPayment: async () => mockResponse(true, { reused: false }),
        parseJson: (res) => res.json(),
      })
      expect(outcome).toEqual({ kind: "success", reused: false })
    })

    it("treats reused as success", async () => {
      const outcome = await submitBatchItemPaymentRequest({
        postRecordPayment: async () => mockResponse(true, { reused: true }),
        parseJson: (res) => res.json(),
      })
      expect(outcome).toEqual({ kind: "success", reused: true })
    })

    it("maps idempotency conflict", async () => {
      const outcome = await submitBatchItemPaymentRequest({
        postRecordPayment: async () =>
          mockResponse(false, { code: "PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT" }),
        parseJson: (res) => res.json(),
      })
      expect(outcome).toEqual({ kind: "conflict" })
    })

    it("maps network failure", async () => {
      const outcome = await submitBatchItemPaymentRequest({
        postRecordPayment: async () => {
          throw new Error("network")
        },
        parseJson: async () => ({}),
      })
      expect(outcome).toEqual({ kind: "network" })
    })
  })
})

describe("batch item payment page flow simulation", () => {
  type FlowState = {
    target: { batchId: string; itemId: string } | null
    error: string
    idempotencyKey: string | null
    recording: boolean
    submittingRef: boolean
    form: { payment_date: string; payment_account_id: string }
    postCount: number
    lastHeaderKey: string | null
    toastMessages: string[]
    reloadCounts: { batches: number; expanded: number; payments: number; obligations: number }
  }

  function createFlowState(): FlowState {
    return {
      target: { batchId: "batch-1", itemId: "item-1" },
      error: "",
      idempotencyKey: "payroll-batch-item:test-key-123456789012",
      recording: false,
      submittingRef: false,
      form: { payment_date: "2026-08-15", payment_account_id: "cash-1" },
      postCount: 0,
      lastHeaderKey: null,
      toastMessages: [],
      reloadCounts: { batches: 0, expanded: 0, payments: 0, obligations: 0 },
    }
  }

  function resetAfterSuccess(state: FlowState) {
    const reset = batchItemPaymentSuccessReset()
    if (reset.clearTarget) state.target = null
    if (reset.clearError) state.error = ""
    if (reset.clearIdempotencyKey) state.idempotencyKey = null
  }

  async function runSubmit(
    state: FlowState,
    response: { ok: boolean; body: Record<string, unknown> }
  ) {
    if (
      !canStartBatchItemPaymentSubmit(Boolean(state.target), state.submittingRef, state.recording)
    ) {
      return
    }
    state.submittingRef = true
    try {
      if (!state.target) return
      const key = state.idempotencyKey || "payroll-batch-item:fallback-key-1234567890"
      state.recording = true
      state.error = ""
      try {
        const outcome = await submitBatchItemPaymentRequest({
          postRecordPayment: async () => {
            state.postCount += 1
            state.lastHeaderKey = key
            return mockResponse(response.ok, response.body, response.ok ? 200 : 409)
          },
          parseJson: (res) => res.json(),
        })
        if (outcome.kind === "network") {
          state.error = BATCH_ITEM_PAYMENT_NETWORK_UNCERTAINTY_MESSAGE
          return
        }
        if (outcome.kind === "conflict" || outcome.kind === "error") {
          return
        }
        resetAfterSuccess(state)
        state.toastMessages.push(outcome.reused ? "reused-success" : "new-success")
        state.reloadCounts.batches += 1
        state.reloadCounts.expanded += 1
        state.reloadCounts.payments += 1
        state.reloadCounts.obligations += 1
      } finally {
        state.recording = false
      }
    } finally {
      state.submittingRef = false
    }
  }

  it("successful payment closes modal and clears key", async () => {
    const state = createFlowState()
    await runSubmit(state, { ok: true, body: { reused: false } })
    expect(state.postCount).toBe(1)
    expect(state.lastHeaderKey).toBe("payroll-batch-item:test-key-123456789012")
    expect(state.target).toBeNull()
    expect(state.idempotencyKey).toBeNull()
    expect(state.error).toBe("")
    expect(state.recording).toBe(false)
    expect(state.toastMessages).toEqual(["new-success"])
    expect(state.reloadCounts).toEqual({ batches: 1, expanded: 1, payments: 1, obligations: 1 })
  })

  it("reused payment closes modal and clears key", async () => {
    const state = createFlowState()
    await runSubmit(state, { ok: true, body: { reused: true } })
    expect(state.target).toBeNull()
    expect(state.idempotencyKey).toBeNull()
    expect(state.toastMessages).toEqual(["reused-success"])
  })

  it("network uncertainty keeps modal open and preserves key", async () => {
    const state = createFlowState()
    const originalKey = state.idempotencyKey
    await submitBatchItemPaymentRequest({
      postRecordPayment: async () => {
        throw new Error("offline")
      },
      parseJson: async () => ({}),
    }).then((outcome) => {
      if (outcome.kind === "network") {
        state.error = BATCH_ITEM_PAYMENT_NETWORK_UNCERTAINTY_MESSAGE
      }
    })
    expect(state.target).not.toBeNull()
    expect(state.idempotencyKey).toBe(originalKey)
    expect(state.form.payment_date).toBe("2026-08-15")
    expect(state.error).toContain("same reference key")
  })

  it("retry after network uncertainty reuses same key", async () => {
    const state = createFlowState()
    const networkOutcome = await submitBatchItemPaymentRequest({
      postRecordPayment: async () => {
        throw new Error("offline")
      },
      parseJson: async () => ({}),
    })
    expect(networkOutcome.kind).toBe("network")
    expect(state.idempotencyKey).toBe("payroll-batch-item:test-key-123456789012")
    await runSubmit(state, { ok: true, body: { reused: false } })
    expect(state.lastHeaderKey).toBe("payroll-batch-item:test-key-123456789012")
    expect(state.target).toBeNull()
  })

  it("double submit creates one request", async () => {
    const state = createFlowState()
    state.recording = true
    await runSubmit(state, { ok: true, body: { reused: false } })
    expect(state.postCount).toBe(0)
    state.recording = false
    await runSubmit(state, { ok: true, body: { reused: false } })
    expect(state.postCount).toBe(1)
  })

  it("explicit close clears target and key when idle", () => {
    const state = createFlowState()
    if (tryCloseBatchItemPaymentModal(state.recording).kind === "closed") {
      state.target = null
      state.error = ""
      state.idempotencyKey = null
    }
    expect(state.target).toBeNull()
    expect(state.idempotencyKey).toBeNull()
  })

  it("close during request is blocked and preserves key", () => {
    const state = createFlowState()
    state.recording = true
    const close = tryCloseBatchItemPaymentModal(state.recording)
    expect(close).toEqual({ kind: "blocked" })
    expect(state.target).not.toBeNull()
    expect(state.idempotencyKey).not.toBeNull()
  })
})
