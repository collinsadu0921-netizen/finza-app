import { processPaystackTransferProviderResult } from "../transferProcessor"

type RpcCall = { name: string; args: Record<string, unknown> }

function makeTransfer(overrides: Record<string, unknown> = {}) {
  return {
    id: "transfer-1",
    business_id: "business-1",
    payroll_run_id: "run-1",
    batch_id: "batch-1",
    batch_item_id: "item-1",
    staff_id: "staff-1",
    payroll_entry_id: "entry-1",
    amount: 10,
    currency: "GHS",
    environment: "live",
    reference: "finza-ps-test",
    status: "requires_attention",
    provider_status: "success",
    provider_transfer_id: "1053149026",
    provider_transfer_code: "TRF_test",
    payment_id: null,
    fee_amount: null,
    initiated_by: "user-1",
    ...overrides,
  } as any
}

function makeAdmin(options: {
  transfer?: any
  settleResult?: { data: any; error: any }
  ensureResults?: Array<{ error: any }>
}) {
  const rpcCalls: RpcCall[] = []
  const updates: Array<{ table: string; values: Record<string, unknown> }> = []
  let ensureIndex = 0

  const admin = {
    from(table: string) {
      const update = (values: Record<string, unknown>) => ({
        eq: async () => {
          updates.push({ table, values })
          return { data: null, error: null }
        },
      })
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: options.transfer ?? makeTransfer(), error: null }),
        update,
      }
      return query
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args })
      if (name === "ensure_accounting_period") {
        const result = options.ensureResults?.[ensureIndex] ?? { error: null }
        ensureIndex += 1
        return result
      }
      if (name === "settle_payroll_paystack_transfer_atomic") {
        return options.settleResult ?? { data: { reused: false }, error: null }
      }
      return { data: null, error: null }
    },
  }

  return { admin: admin as any, rpcCalls, updates }
}

const providerSuccess = {
  status: "success",
  id: "1053149026",
  transfer_code: "TRF_test",
  reference: "finza-ps-test",
  amount: 1000,
  currency: "GHS",
  fee: 100,
  transferred_at: "2026-11-05T23:28:39.756Z",
}

describe("processPaystackTransferProviderResult", () => {
  it("provisions the payment month before settling a verified successful transfer", async () => {
    const { admin, rpcCalls } = makeAdmin({})
    const result = await processPaystackTransferProviderResult({
      admin,
      transfer: makeTransfer(),
      providerData: providerSuccess,
      source: "verification",
    })

    expect(result.status).toBe("successful")
    expect(rpcCalls.map((call) => call.name)).toEqual([
      "ensure_accounting_period",
      "settle_payroll_paystack_transfer_atomic",
    ])
    expect(rpcCalls[0].args).toEqual({
      p_business_id: "business-1",
      p_date: "2026-11-05",
    })
    expect(rpcCalls[1].args).toMatchObject({
      p_transfer_id: "transfer-1",
      p_provider_status: "success",
      p_provider_transfer_id: "1053149026",
      p_provider_transfer_code: "TRF_test",
      p_paid_at: "2026-11-05T23:28:39.756Z",
      p_fee_pesewas: 100,
    })
  })

  it("retries period provisioning after a concurrent unique-key conflict", async () => {
    const { admin, rpcCalls } = makeAdmin({
      ensureResults: [{ error: { code: "23505", message: "duplicate key" } }, { error: null }],
    })
    const result = await processPaystackTransferProviderResult({
      admin,
      transfer: makeTransfer(),
      providerData: providerSuccess,
      source: "verification",
    })

    expect(result.status).toBe("successful")
    expect(rpcCalls.filter((call) => call.name === "ensure_accounting_period")).toHaveLength(2)
    expect(rpcCalls.at(-1)?.name).toBe("settle_payroll_paystack_transfer_atomic")
  })

  it("keeps the transfer recoverable and logs the actual settlement error on failure", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    const { admin, updates } = makeAdmin({
      settleResult: {
        data: null,
        error: {
          code: "P0001",
          message: "No accounting period found for date 2026-11-05. Period must exist before posting.",
          details: "Posting blocked by period guard",
          hint: null,
        },
      },
    })

    const result = await processPaystackTransferProviderResult({
      admin,
      transfer: makeTransfer(),
      providerData: providerSuccess,
      source: "verification",
    })

    expect(result.status).toBe("requires_attention")
    expect(result.applied).toBe(false)
    expect(updates).toContainEqual({
      table: "payroll_paystack_transfers",
      values: expect.objectContaining({
        status: "requires_attention",
        requires_attention_reason:
          "Paystack confirmed the transfer but salary settlement failed. Do not retry; review the transfer.",
      }),
    })
    expect(errorSpy).toHaveBeenCalledWith(
      "[paystack transfer] settlement failed",
      expect.objectContaining({
        code: "P0001",
        message: "No accounting period found for date 2026-11-05. Period must exist before posting.",
        details: "Posting blocked by period guard",
      })
    )
    errorSpy.mockRestore()
  })

  it("does not provision or settle when the provider amount does not match", async () => {
    const { admin, rpcCalls } = makeAdmin({})
    const result = await processPaystackTransferProviderResult({
      admin,
      transfer: makeTransfer(),
      providerData: { ...providerSuccess, amount: 999 },
      source: "verification",
    })

    expect(result.status).toBe("requires_attention")
    expect(rpcCalls).toHaveLength(0)
  })

  it("does not reprocess an already-final successful transfer", async () => {
    const { admin, rpcCalls } = makeAdmin({
      transfer: makeTransfer({ status: "successful", payment_id: "payment-1" }),
    })
    const result = await processPaystackTransferProviderResult({
      admin,
      transfer: makeTransfer({ status: "successful", payment_id: "payment-1" }),
      providerData: providerSuccess,
      source: "verification",
    })

    expect(result.status).toBe("successful")
    expect(result.message).toBe("Transfer already has a final status.")
    expect(rpcCalls).toHaveLength(0)
  })
})
