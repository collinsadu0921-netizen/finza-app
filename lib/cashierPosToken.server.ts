import "server-only"
import { createHmac, timingSafeEqual } from "crypto"

const TOKEN_PREFIX = "fp1."
const TOKEN_VERSION = 1 as const
/** Default shift-length bound for POS receipt access (seconds). */
const DEFAULT_TTL_SEC = 12 * 3600

export type CashierPosTokenPayload = {
  v: typeof TOKEN_VERSION
  cashierId: string
  businessId: string
  storeId: string
  iat: number
  exp: number
}

function getSigningSecret(): string | null {
  const direct = process.env.CASHIER_POS_TOKEN_SECRET?.trim()
  if (direct && direct.length >= 16) return direct
  const sr = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (sr && sr.length >= 20) {
    return createHmac("sha256", sr).update("finza:cashier-pos-token:v1").digest("base64")
  }
  return null
}

/**
 * Issues a short-lived HMAC token for PIN-only POS (receipt API, etc.).
 * Returns null if the server cannot derive a signing secret (misconfiguration).
 */
export function signCashierPosToken(input: {
  cashierId: string
  businessId: string
  storeId: string
  ttlSeconds?: number
}): string | null {
  const secret = getSigningSecret()
  if (!secret) return null

  const iat = Math.floor(Date.now() / 1000)
  const ttl = Math.min(
    Math.max(60, input.ttlSeconds ?? DEFAULT_TTL_SEC),
    24 * 3600
  )
  const exp = iat + ttl
  const body: CashierPosTokenPayload = {
    v: TOKEN_VERSION,
    cashierId: input.cashierId,
    businessId: input.businessId,
    storeId: input.storeId,
    iat,
    exp,
  }
  const payloadB64 = Buffer.from(JSON.stringify(body), "utf8").toString("base64url")
  const sig = createHmac("sha256", secret).update(payloadB64).digest("base64url")
  return `${TOKEN_PREFIX}${payloadB64}.${sig}`
}

export function verifyCashierPosToken(token: string): CashierPosTokenPayload | null {
  const secret = getSigningSecret()
  if (!secret || !token.startsWith(TOKEN_PREFIX)) return null

  const withoutPrefix = token.slice(TOKEN_PREFIX.length)
  const dot = withoutPrefix.lastIndexOf(".")
  if (dot <= 0) return null

  const payloadB64 = withoutPrefix.slice(0, dot)
  const sig = withoutPrefix.slice(dot + 1)
  if (!payloadB64 || !sig) return null

  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest("base64url")
  const a = Buffer.from(sig, "utf8")
  const b = Buffer.from(expectedSig, "utf8")
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"))
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object") return null
  const p = parsed as Record<string, unknown>
  if (p.v !== TOKEN_VERSION) return null
  if (
    typeof p.cashierId !== "string" ||
    typeof p.businessId !== "string" ||
    typeof p.storeId !== "string" ||
    typeof p.iat !== "number" ||
    typeof p.exp !== "number"
  ) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if (p.exp < now) return null

  return {
    v: TOKEN_VERSION,
    cashierId: p.cashierId,
    businessId: p.businessId,
    storeId: p.storeId,
    iat: p.iat,
    exp: p.exp,
  }
}

export function extractBearerCashierPosToken(request: Request): string | null {
  const h = request.headers.get("authorization") || request.headers.get("Authorization")
  if (!h || !h.toLowerCase().startsWith("bearer ")) return null
  const t = h.slice(7).trim()
  return t || null
}
