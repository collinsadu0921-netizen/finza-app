/**
 * Server-validated Retail POS terminal lock credential (Option B).
 * HMAC-signed opaque token stored in an HttpOnly cookie — not localStorage.
 * Grants no owner/admin permissions; only marks the browser profile as in
 * cashier/kiosk mode so privileged routes/APIs can be rejected while a
 * manager Supabase session may still exist underneath.
 */

export const POS_TERMINAL_LOCK_COOKIE = "finza_pos_tl1"
export const POS_TERMINAL_LOCK_HEADER = "x-finza-pos-terminal-lock"

const TOKEN_PREFIX = "tl1."
const TOKEN_VERSION = 1 as const
const DEFAULT_TTL_SEC = 12 * 3600

export type PosTerminalLockClaims = {
  v: typeof TOKEN_VERSION
  businessId: string
  storeId: string
  registerId: string | null
  iat: number
  exp: number
}

function getSigningSecret(): string | null {
  const direct = process.env.CASHIER_POS_TOKEN_SECRET?.trim()
  if (direct && direct.length >= 16) return direct
  const sr = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (sr && sr.length >= 20) {
    // Stable derive — same pattern as cashier POS token fallback
    return `finza:pos-terminal-lock:v1:${sr.slice(0, 48)}`
  }
  return null
}

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ""
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]!)
  const b64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(u8).toString("base64")
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad
  if (typeof atob === "function") {
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  return new Uint8Array(Buffer.from(b64, "base64"))
}

async function hmacSign(secret: string, payloadB64: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64))
  return bytesToBase64Url(sig)
}

async function hmacVerify(secret: string, payloadB64: string, sigB64: string): Promise<boolean> {
  const expected = await hmacSign(secret, payloadB64)
  if (expected.length !== sigB64.length) return false
  let ok = 0
  for (let i = 0; i < expected.length; i++) {
    ok |= expected.charCodeAt(i) ^ sigB64.charCodeAt(i)
  }
  return ok === 0
}

export async function signPosTerminalLockToken(input: {
  businessId: string
  storeId: string
  registerId?: string | null
  ttlSeconds?: number
}): Promise<string | null> {
  const secret = getSigningSecret()
  if (!secret) return null
  const iat = Math.floor(Date.now() / 1000)
  const ttl = Math.min(Math.max(60, input.ttlSeconds ?? DEFAULT_TTL_SEC), 24 * 3600)
  const body: PosTerminalLockClaims = {
    v: TOKEN_VERSION,
    businessId: input.businessId,
    storeId: input.storeId,
    registerId: input.registerId ?? null,
    iat,
    exp: iat + ttl,
  }
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(body)))
  const sig = await hmacSign(secret, payloadB64)
  return `${TOKEN_PREFIX}${payloadB64}.${sig}`
}

export async function verifyPosTerminalLockToken(
  token: string
): Promise<PosTerminalLockClaims | null> {
  const secret = getSigningSecret()
  if (!secret || !token.startsWith(TOKEN_PREFIX)) return null
  const withoutPrefix = token.slice(TOKEN_PREFIX.length)
  const dot = withoutPrefix.lastIndexOf(".")
  if (dot <= 0) return null
  const payloadB64 = withoutPrefix.slice(0, dot)
  const sig = withoutPrefix.slice(dot + 1)
  if (!payloadB64 || !sig) return null
  if (!(await hmacVerify(secret, payloadB64, sig))) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const p = parsed as Record<string, unknown>
  if (p.v !== TOKEN_VERSION) return null
  if (
    typeof p.businessId !== "string" ||
    typeof p.storeId !== "string" ||
    typeof p.iat !== "number" ||
    typeof p.exp !== "number"
  ) {
    return null
  }
  if (p.registerId != null && typeof p.registerId !== "string") return null
  if (p.exp < Math.floor(Date.now() / 1000)) return null
  return {
    v: TOKEN_VERSION,
    businessId: p.businessId,
    storeId: p.storeId,
    registerId: typeof p.registerId === "string" ? p.registerId : null,
    iat: p.iat,
    exp: p.exp,
  }
}

export function readPosTerminalLockCookieValue(
  cookieHeader: string | null | undefined
): string | null {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(";")
  for (const part of parts) {
    const idx = part.indexOf("=")
    if (idx <= 0) continue
    const name = part.slice(0, idx).trim()
    if (name !== POS_TERMINAL_LOCK_COOKIE) continue
    const value = part.slice(idx + 1).trim()
    return value || null
  }
  return null
}

export async function readPosTerminalLockClaimsFromRequest(
  request: Request
): Promise<PosTerminalLockClaims | null> {
  const raw = readPosTerminalLockCookieValue(request.headers.get("cookie"))
  if (!raw) return null
  return verifyPosTerminalLockToken(raw)
}

/** Cookie options for Set-Cookie (API routes). */
export function posTerminalLockCookieOptions(maxAgeSec: number): {
  httpOnly: boolean
  secure: boolean
  sameSite: "lax"
  path: string
  maxAge: number
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSec,
  }
}

/**
 * Privileged retail/back-office APIs that must not fall through to a hidden
 * owner session while the terminal lock cookie is active.
 */
export function isApiBlockedByPosTerminalLock(pathname: string, method: string): boolean {
  const m = method.toUpperCase()
  if (pathname === "/api/auth/pin-login") return false
  if (pathname === "/api/retail/pos/bootstrap") return false
  if (pathname === "/api/retail/pos/sales") return false
  if (pathname.startsWith("/api/retail/pos/receipt")) return false
  if (pathname === "/api/retail/pos/terminal-lock") return false
  if (
    /^\/api\/retail\/registers\/[^/]+\/customer-display$/.test(pathname) &&
    m === "GET"
  ) {
    return false
  }
  // MoMo and other POS payment helpers still need session under current architecture;
  // block them while locked so cashier mode cannot use manager privileges silently.
  if (pathname.startsWith("/api/retail/")) return true
  if (pathname.startsWith("/api/customers")) return true
  if (pathname.startsWith("/api/sales")) return true
  if (pathname.startsWith("/api/sales-history")) return true
  return false
}

/** Page routes that remain reachable while terminal lock is active. */
export function isPageAllowedWithPosTerminalLock(pathname: string): boolean {
  const p = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname
  if (p === "/retail/pos" || p.startsWith("/retail/pos/")) return true
  if (p === "/pos" || p.startsWith("/pos/")) return true
  if (p === "/retail/sales" || p.startsWith("/retail/sales/")) return true
  if (p === "/login") return true
  return false
}
