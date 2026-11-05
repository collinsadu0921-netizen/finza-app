import {
  buildPaystackWebhookEventKey,
  parsePaystackTransferWebhook,
  webhookEventToTransferStatus,
} from "@/lib/payroll/paystack/webhook"

function body(overrides: Record<string, unknown> = {}, dataOverrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: "transfer.success",
    data: {
      id: 12345,
      reference: "finza-ps-abc",
      status: "success",
      amount: 100000,
      currency: "GHS",
      transfer_code: "TRF_abc",
      transferred_at: "2026-10-29T12:00:00.000Z",
      ...dataOverrides,
    },
    ...overrides,
  })
}

describe("Paystack transfer webhooks", () => {
  it("parses transfer identity, amount and currency", () => {
    const parsed = parsePaystackTransferWebhook(body())
    expect(parsed).toEqual(
      expect.objectContaining({
        event: "transfer.success",
        reference: "finza-ps-abc",
        providerTransferId: "12345",
        providerTransferCode: "TRF_abc",
        status: "success",
        amountPesewas: 100000,
        currency: "GHS",
      })
    )
  })

  it("deduplicates identical deliveries but keeps different events", () => {
    const a = parsePaystackTransferWebhook(body())!
    const b = parsePaystackTransferWebhook(body())!
    const reversed = parsePaystackTransferWebhook(
      body({ event: "transfer.reversed" }, { status: "reversed" })
    )!
    expect(a.eventKey).toBe(b.eventKey)
    expect(reversed.eventKey).not.toBe(a.eventKey)
  })

  it("does not accept non-transfer events", () => {
    expect(parsePaystackTransferWebhook(body({ event: "charge.success" }))).toBeNull()
    expect(parsePaystackTransferWebhook("not json")).toBeNull()
  })

  it("maps events to transfer status without trusting a bare HTTP 200", () => {
    expect(webhookEventToTransferStatus("transfer.success", "success")).toBe("successful")
    expect(webhookEventToTransferStatus("transfer.failed", "failed")).toBe("failed")
    expect(webhookEventToTransferStatus("transfer.reversed", "reversed")).toBe("reversed")
    expect(webhookEventToTransferStatus("transfer.success", "pending")).toBe("successful")
    expect(webhookEventToTransferStatus("transfer.success", "weird")).toBe("successful")
    expect(webhookEventToTransferStatus("transfer.unknown", "weird")).toBe("requires_attention")
  })

  it("builds a stable event key from the canonical provider fields", () => {
    expect(
      buildPaystackWebhookEventKey({
        event: "transfer.success",
        reference: "ref",
        providerTransferId: "1",
        status: "success",
        amountPesewas: 100,
        occurredAt: "2026-01-01",
      })
    ).toBe(
      buildPaystackWebhookEventKey({
        event: "transfer.success",
        reference: "ref",
        providerTransferId: "1",
        status: "success",
        amountPesewas: 100,
        occurredAt: "2026-01-01",
      })
    )
  })
})
