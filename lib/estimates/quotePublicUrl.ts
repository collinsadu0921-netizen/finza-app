/**
 * One public URL for a quote. Copy link, email, and WhatsApp must use this.
 * Deployed environments must not fall back to localhost.
 */

export const QUOTE_PUBLIC_PATH = "/quote-public"

export function quotePublicPath(token: string): string {
  return `${QUOTE_PUBLIC_PATH}/${encodeURIComponent(token)}`
}

export function isLocalhostOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname
    return host === "localhost" || host === "127.0.0.1" || host === "::1"
  } catch {
    return true
  }
}

export function resolveQuotePublicOrigin(input: {
  appUrl?: string | null
  requestOrigin?: string | null
  vercelUrl?: string | null
  /** `production` | `preview` | `development` from VERCEL_ENV. */
  vercelEnv?: string | null
  deployed?: boolean
}): { ok: true; origin: string } | { ok: false; error: string } {
  const appUrl = input.appUrl?.trim().replace(/\/$/, "") || ""
  const requestOrigin = input.requestOrigin?.trim().replace(/\/$/, "") || ""
  const vercelUrl = input.vercelUrl?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "") || ""
  const vercelEnv = (input.vercelEnv || "").trim()
  const deployed = input.deployed === true || vercelEnv === "production" || vercelEnv === "preview"
  const usableRequest =
    /^https?:\/\//i.test(requestOrigin) && !(deployed && isLocalhostOrigin(requestOrigin))
  const usableApp = Boolean(appUrl) && !(deployed && isLocalhostOrigin(appUrl))

  // Preview deployments must link to the deployment that is actually serving the quote.
  if (vercelEnv === "preview") {
    if (usableRequest) return { ok: true, origin: requestOrigin }
    if (vercelUrl) return { ok: true, origin: `https://${vercelUrl}` }
  }

  if (usableApp) return { ok: true, origin: appUrl }
  if (usableRequest) return { ok: true, origin: requestOrigin }
  if (vercelUrl) return { ok: true, origin: `https://${vercelUrl}` }

  if (!deployed) {
    return { ok: true, origin: requestOrigin || "http://localhost:3000" }
  }

  return {
    ok: false,
    error: "Quote links are not configured for this environment. Set NEXT_PUBLIC_APP_URL to the public site origin.",
  }
}

export async function ensurePersistedQuotePublicToken(input: {
  existingToken?: string | null
  estimateId: string
  persistToken: (token: string) => Promise<{ errorMessage?: string | null }>
  now?: number
}): Promise<{ ok: true; token: string; created: boolean } | { ok: false; error: string }> {
  const existing = input.existingToken?.trim()
  if (existing) return { ok: true, token: existing, created: false }

  const token = createQuotePublicToken(input.estimateId, input.now ?? Date.now())
  const persisted = await input.persistToken(token)
  if (persisted.errorMessage) {
    return { ok: false, error: "Could not save the public quote link." }
  }
  return { ok: true, token, created: true }
}

export async function resolveEstimatePublicLink(input: {
  appUrl?: string | null
  requestOrigin?: string | null
  vercelUrl?: string | null
  vercelEnv?: string | null
  existingToken?: string | null
  estimateId: string
  persistToken: (token: string) => Promise<{ errorMessage?: string | null }>
  now?: number
}): Promise<{ ok: true; publicUrl: string; token: string } | { ok: false; error: string }> {
  const origin = resolveQuotePublicOrigin(input)
  if (!origin.ok) return origin

  const token = await ensurePersistedQuotePublicToken(input)
  if (!token.ok) return token

  return { ok: true, publicUrl: buildQuotePublicUrl(origin.origin, token.token), token: token.token }
}

export function buildQuotePublicUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}${quotePublicPath(token)}`
}

export function createQuotePublicToken(estimateId: string, now = Date.now()): string {
  return `est_${estimateId}_${now}`
}
