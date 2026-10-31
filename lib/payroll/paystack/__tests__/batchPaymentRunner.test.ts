import { runBatchPaystackPayments } from "@/lib/payroll/paystack/batchPaymentRunner"

const items = [
  { id: "i1", employee_name: "Ama", amount: 1500 },
  { id: "i2", employee_name: "Kwame", amount: 2000 },
  { id: "i3", employee_name: "Esi", amount: 1200 },
]

function response(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe("runBatchPaystackPayments", () => {
  it("tracks successful, processing and failed employees independently", async () => {
    const calls: Array<{ url: string; key: string; body: Record<string, unknown> }> = []
    const responses = [
      response(200, { status: "successful", transfer_id: "t1" }),
      response(202, { status: "pending", transfer_id: "t2" }),
      response(409, { status: "failed", error: "Transfer failed" }),
    ]
    let cursor = 0
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        key: String((init.headers as Record<string, string>)["Idempotency-Key"]),
        body: JSON.parse(String(init.body)),
      })
      return responses[cursor++]
    }) as unknown as typeof fetch

    const progress: string[] = []
    const outcome = await runBatchPaystackPayments({
      runId: "run-1",
      batchId: "batch-1",
      items,
      fetchImpl,
      createIdempotencyKey: () => `key-${calls.length + 1}`,
      onItemComplete: (_item, result, index, total) => {
        progress.push(`${index + 1}/${total}:${result.status}`)
      },
    })

    expect(outcome).toMatchObject({
      paid: 1,
      processing: 1,
      failed: 1,
      stoppedForAuthorization: false,
      networkUncertain: false,
    })
    expect(calls).toHaveLength(3)
    expect(new Set(calls.map((call) => call.key)).size).toBe(3)
    expect(calls.every((call) => call.body.confirm === true)).toBe(true)
    expect(calls[0].url).toContain("/items/i1/paystack-pay")
    expect(progress).toEqual(["1/3:successful", "2/3:processing", "3/3:failed"])
  })

  it("stops for authorization without initiating the remaining employees", async () => {
    let calls = 0
    let authorizedItemId = ""
    const fetchImpl = (async () => {
      calls += 1
      return response(202, {
        status: "awaiting_authorization",
        otp_required: true,
        transfer_id: "t1",
      })
    }) as unknown as typeof fetch

    const outcome = await runBatchPaystackPayments({
      runId: "run-1",
      batchId: "batch-1",
      items,
      fetchImpl,
      onAuthorizationRequired: (item) => {
        authorizedItemId = item.id
      },
    })

    expect(calls).toBe(1)
    expect(outcome.stoppedForAuthorization).toBe(true)
    expect(authorizedItemId).toBe("i1")
  })

  it("treats an existing pending transfer as processing and continues", async () => {
    let calls = 0
    const responses = [
      response(409, { code: "TRANSFER_PENDING", transfer_id: "t1", error: "In progress" }),
      response(200, { status: "successful", transfer_id: "t2" }),
    ]
    const fetchImpl = (async () => responses[calls++]) as unknown as typeof fetch

    const outcome = await runBatchPaystackPayments({
      runId: "run-1",
      batchId: "batch-1",
      items: items.slice(0, 2),
      fetchImpl,
    })

    expect(outcome.processing).toBe(1)
    expect(outcome.paid).toBe(1)
    expect(calls).toBe(2)
  })

  it("stops on an uncertain network outcome to avoid duplicate payouts", async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      throw new Error("network")
    }) as unknown as typeof fetch

    const outcome = await runBatchPaystackPayments({
      runId: "run-1",
      batchId: "batch-1",
      items,
      fetchImpl,
    })

    expect(calls).toBe(1)
    expect(outcome.networkUncertain).toBe(true)
    expect(outcome.results[0].status).toBe("uncertain")
  })
})
