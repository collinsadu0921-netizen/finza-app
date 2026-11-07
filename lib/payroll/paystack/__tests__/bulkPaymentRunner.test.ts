import { runBulkPaystackPayments } from "../bulkPaymentRunner"

function response(status: number, body: Record<string, unknown>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe("runBulkPaystackPayments", () => {
  it("submits all selected employees through one genuine bulk endpoint request", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; key: string }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body)),
        key: String((init.headers as Record<string, string>)["Idempotency-Key"]),
      })
      return response(200, {
        success: true,
        bulk: true,
        results: [
          { item_id: "i1", status: "successful" },
          { item_id: "i2", status: "pending" },
        ],
        paid: 1,
        processing: 1,
        failed: 0,
        requires_attention: 0,
      })
    }) as unknown as typeof fetch

    const outcome = await runBulkPaystackPayments({
      runId: "run-1",
      batchId: "batch-1",
      itemIds: ["i1", "i2"],
      fetchImpl,
      createIdempotencyKey: () => "bulk-idempotency-key-123",
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain("/payment-batches/batch-1/paystack-bulk")
    expect(calls[0].body.item_ids).toEqual(["i1", "i2"])
    expect(calls[0].body.confirm).toBe(true)
    expect(calls[0].key).toBe("bulk-idempotency-key-123")
    expect(outcome).toMatchObject({ paid: 1, processing: 1, failed: 0, requiresAttention: 0 })
  })

  it("returns a clear bulk-unavailable outcome without hiding individual payment", async () => {
    const fetchImpl = (async () =>
      response(409, {
        error: "Paystack bulk transfers are unavailable for this account.",
        code: "PAYSTACK_BULK_UNAVAILABLE",
        bulk_unavailable: true,
      })) as unknown as typeof fetch

    const outcome = await runBulkPaystackPayments({
      runId: "run-1",
      batchId: "batch-1",
      itemIds: ["i1", "i2"],
      fetchImpl,
      createIdempotencyKey: () => "bulk-idempotency-key-123",
    })

    expect(outcome.bulkUnavailable).toBe(true)
    expect(outcome.error).toContain("unavailable")
    expect(outcome.networkUncertain).toBe(false)
  })

  it("marks network failures as uncertain rather than failed for duplicate-safe recovery", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    const outcome = await runBulkPaystackPayments({
      runId: "run-1",
      batchId: "batch-1",
      itemIds: ["i1"],
      fetchImpl,
      createIdempotencyKey: () => "bulk-idempotency-key-123",
    })

    expect(outcome.networkUncertain).toBe(true)
    expect(outcome.error).toContain("uncertain")
  })
})
