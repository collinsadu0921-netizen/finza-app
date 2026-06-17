/**
 * Marketing attribution params preserved from landing URL through signup → business setup.
 */

export type SignupAttribution = {
  signup_source: string | null
  signup_utm_source: string | null
  signup_utm_medium: string | null
  signup_utm_campaign: string | null
}

const SESSION_KEY = "finza_signup_attribution_v1"

const ATTRIBUTION_PARAM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "ref",
  "source",
] as const

function trimOrNull(v: string | null | undefined, max = 200): string | null {
  if (!v?.trim()) return null
  const t = v.trim()
  return t.length > max ? t.slice(0, max) : t
}

/** Read attribution from URLSearchParams (signup, callback, business-setup). */
export function parseSignupAttributionFromSearchParams(
  params: URLSearchParams | { get: (key: string) => string | null }
): SignupAttribution {
  const utm_source = trimOrNull(params.get("utm_source"))
  const utm_medium = trimOrNull(params.get("utm_medium"))
  const utm_campaign = trimOrNull(params.get("utm_campaign"))
  const ref = trimOrNull(params.get("ref"))
  const source = trimOrNull(params.get("source"))

  const signup_source = ref ?? source ?? utm_source ?? null

  return {
    signup_source,
    signup_utm_source: utm_source,
    signup_utm_medium: utm_medium,
    signup_utm_campaign: utm_campaign,
  }
}

/** Merge URL params over existing attribution (first-touch preserved in session). */
export function mergeSignupAttribution(
  base: SignupAttribution,
  fromUrl: SignupAttribution
): SignupAttribution {
  return {
    signup_source: base.signup_source ?? fromUrl.signup_source,
    signup_utm_source: base.signup_utm_source ?? fromUrl.signup_utm_source,
    signup_utm_medium: base.signup_utm_medium ?? fromUrl.signup_utm_medium,
    signup_utm_campaign: base.signup_utm_campaign ?? fromUrl.signup_utm_campaign,
  }
}

export function persistSignupAttributionToSession(attribution: SignupAttribution): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(attribution))
  } catch {
    /* ignore quota / private mode */
  }
}

export function readSignupAttributionFromSession(): SignupAttribution | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SignupAttribution>
    return {
      signup_source: trimOrNull(parsed.signup_source ?? null),
      signup_utm_source: trimOrNull(parsed.signup_utm_source ?? null),
      signup_utm_medium: trimOrNull(parsed.signup_utm_medium ?? null),
      signup_utm_campaign: trimOrNull(parsed.signup_utm_campaign ?? null),
    }
  } catch {
    return null
  }
}

/** For auth user_metadata merge at signup / OAuth callback. */
export function signupAttributionToUserMetadata(
  attribution: SignupAttribution
): Record<string, string> {
  const meta: Record<string, string> = {}
  if (attribution.signup_source) meta.signup_source = attribution.signup_source
  if (attribution.signup_utm_source) meta.signup_utm_source = attribution.signup_utm_source
  if (attribution.signup_utm_medium) meta.signup_utm_medium = attribution.signup_utm_medium
  if (attribution.signup_utm_campaign) meta.signup_utm_campaign = attribution.signup_utm_campaign
  return meta
}

export function signupAttributionFromUserMetadata(
  meta: Record<string, unknown> | null | undefined
): SignupAttribution {
  const m = meta ?? {}
  return {
    signup_source: trimOrNull(typeof m.signup_source === "string" ? m.signup_source : null),
    signup_utm_source: trimOrNull(typeof m.signup_utm_source === "string" ? m.signup_utm_source : null),
    signup_utm_medium: trimOrNull(typeof m.signup_utm_medium === "string" ? m.signup_utm_medium : null),
    signup_utm_campaign: trimOrNull(
      typeof m.signup_utm_campaign === "string" ? m.signup_utm_campaign : null
    ),
  }
}

/** Append UTM/ref params to a URL (OAuth callback redirect). */
export function appendAttributionToUrl(
  baseUrl: string,
  attribution: SignupAttribution
): string {
  const u = new URL(baseUrl)
  if (attribution.signup_utm_source) u.searchParams.set("utm_source", attribution.signup_utm_source)
  if (attribution.signup_utm_medium) u.searchParams.set("utm_medium", attribution.signup_utm_medium)
  if (attribution.signup_utm_campaign) u.searchParams.set("utm_campaign", attribution.signup_utm_campaign)
  if (attribution.signup_source) {
    u.searchParams.set("ref", attribution.signup_source)
  }
  return u.toString()
}

export { ATTRIBUTION_PARAM_KEYS }
