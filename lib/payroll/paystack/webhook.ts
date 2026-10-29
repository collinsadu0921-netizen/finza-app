import { createHash } from "crypto"

export type PaystackTransferWebhookEvent = {
  event: string
  eventKey: string
  reference: string | null
  providerTransferId: string | null
  providerTransferCode: string | null
  status: string | null
  amountPesewas: number | null
  currency: string | null
  feePesewas: number | null
  occurredAt: string | null
  data: Record<string, unknown>
  raw: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function asInteger(value: unknown): number | null {
  return value != null && Number.isFinite(Number(value)) ? Math.round(Number(value)) : null
}

export function buildPaystackWebhookEventKey(input: {
  event: string
  reference: string | null
  providerTransferId: string | null
  status: string | null
  amountPesewas: number | null
  occurredAt: string | null
}): string {
  const canonical = [
    input.event,
    input.reference ?? "",
    input.providerTransferId ?? "",
    input.status ?? "",
    input.amountPesewas ?? "",
    input.occurredAt ?? "",
  ].join("|")
  return createHash("sha256").update(canonical, "utf8").digest("hex")
}

export function parsePaystackTransferWebhook(rawBody: string): PaystackTransferWebhookEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return null
  }

  const raw = asRecord(parsed)
  if (!raw) return null
  const data = asRecord(raw.data)
  if (!data) return null

  const event = safeString(raw.event) ?? ""
  if (!event.startsWith("transfer.")) return null

  const reference = safeString(data.reference)
  const providerTransferId = safeString(data.id != null ? String(data.id) : data.transfer_id)
  const providerTransferCode = safeString(data.transfer_code)
  const status = safeString(data.status)
  const currency = safeString(data.currency)?.toUpperCase() ?? null
  const amountPesewas = asInteger(data.amount)
  const feePesewas =
    asInteger(data.fee) ??
    (Array.isArray(data.fees_breakdown)
      ? (data.fees_breakdown as unknown[]).reduce<number>((sum, item) => {
          const row = asRecord(item)
          return sum + (asInteger(row?.amount ?? row?.fee) ?? 0)
        }, 0)
      : null)
  const occurredAt =
    safeString(data.transferred_at) ??
    safeString(data.updatedAt) ??
    safeString(data.createdAt) ??
    safeString(raw.created_at)

  return {
    event,
    eventKey: buildPaystackWebhookEventKey({
      event,
      reference,
      providerTransferId,
      status,
      amountPesewas,
      occurredAt,
    }),
    reference,
    providerTransferId,
    providerTransferCode,
    status,
    amountPesewas,
    currency,
    feePesewas,
    occurredAt,
    data,
    raw,
  }
}

export function webhookEventToTransferStatus(
  event: string,
  providerStatus: string | null
): "successful" | "failed" | "reversed" | "pending" | "requires_attention" {
  const status = String(providerStatus ?? "").toLowerCase()
  if (event === "transfer.reversed" || status === "reversed") return "reversed"
  if (event === "transfer.success" || status === "success") return "successful"
  if (event === "transfer.failed" || status === "failed") return "failed"
  if (status === "pending" || status === "processing" || status === "queued") return "pending"
  return "requires_attention"
}
