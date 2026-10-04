/**
 * Online POS idempotency.
 *
 * The cashier UI generates one UUID per checkout attempt and sends it as
 * client_sale_id. The database unique index
 * sales_online_client_sale_id_uidx (business_id, register_id, client_sale_id)
 * allows only one row. A retry or a concurrent duplicate hits that index and
 * returns the existing sale without posting stock again. A new sale uses a new id.
 * Sales that omit client_sale_id are unchanged.
 */

const CLIENT_SALE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ExistingOnlineSale = {
  id: string
  amount: number | string
  business_id: string
  register_id: string | null
}

export function normalizeClientSaleId(raw: unknown): string | null {
  if (raw == null || raw === "") return null
  if (typeof raw !== "string") {
    throw new Error("client_sale_id must be a UUID string")
  }
  const trimmed = raw.trim().toLowerCase()
  if (!CLIENT_SALE_ID_RE.test(trimmed)) {
    throw new Error("client_sale_id must be a UUID")
  }
  return trimmed
}

export function amountsMatchForReplay(existingAmount: number | string, requestedAmount: number): boolean {
  return Math.abs(Number(existingAmount) - Number(requestedAmount)) <= 0.01
}

export type OnlineSaleReplayDecision = "insert" | "replay" | "conflict"

export function decideOnlineSaleReplay(
  existing: ExistingOnlineSale | null,
  requested: { businessId: string; registerId: string; amount: number }
): OnlineSaleReplayDecision {
  if (!existing) return "insert"
  if (existing.business_id !== requested.businessId) return "conflict"
  if (existing.register_id !== requested.registerId) return "conflict"
  if (!amountsMatchForReplay(existing.amount, requested.amount)) return "conflict"
  return "replay"
}

export function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === "23505") return true
  const message = String(error.message || "").toLowerCase()
  return message.includes("duplicate key") || message.includes("sales_online_client_sale_id_uidx")
}

/**
 * In-memory stand-in for the unique index. Two concurrent inserts of the same
 * key produce one winner and one unique violation, matching PostgreSQL.
 */
export function simulateUniqueInsertRace(keys: string[]): Array<"inserted" | "duplicate"> {
  const seen = new Set<string>()
  return keys.map((key) => {
    if (seen.has(key)) return "duplicate"
    seen.add(key)
    return "inserted"
  })
}
