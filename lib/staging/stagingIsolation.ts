/**
 * Staging identity checks. Error strings are codes, never secret values.
 * Production startup does not call this unless FINZA_DEPLOYMENT_ENV=staging.
 */

export const PRODUCTION_SUPABASE_REF = "qjxhibvbmzogyzbhswjj"
export const STAGING_SUPABASE_REF = "adonhhtooawkeemdqqeo"

export const PRODUCTION_APP_HOSTS = [
  "app.finza.africa",
  "finza.africa",
  "www.finza.africa",
  "finza-app.vercel.app",
  "finza-app-collins-projects-f49524b8.vercel.app",
]

export type EnvMap = Record<string, string | undefined>

export type StagingCheckOptions = {
  /** When true, tenant invoice Paystack must be enabled with test keys. */
  packageA?: boolean
}

export function isStagingDeployment(env: EnvMap): boolean {
  return env.FINZA_DEPLOYMENT_ENV === "staging"
}

export type StagingCheckResult =
  | { ok: true }
  | { ok: false; errors: string[] }

function hostOf(value: string | undefined): string | null {
  if (!value || !value.trim()) return null
  try {
    return new URL(value.trim()).hostname.toLowerCase()
  } catch {
    return null
  }
}

function supabaseRefFromUrl(value: string | undefined): string | null {
  const host = hostOf(value)
  if (!host || !host.endsWith(".supabase.co")) return null
  return host.slice(0, -".supabase.co".length)
}

export type SupabaseApiKeyClass = "publishable" | "secret" | "legacy_jwt" | "missing" | "malformed"

export function classifySupabaseApiKey(value: string | undefined): SupabaseApiKeyClass {
  const key = (value || "").trim()
  if (!key || key.includes("REPLACE_")) return "missing"
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return "legacy_jwt"
  if (key.startsWith("sb_publishable_") && key.length > "sb_publishable_".length && !/\s/.test(key)) {
    return "publishable"
  }
  if (key.startsWith("sb_secret_") && key.length > "sb_secret_".length && !/\s/.test(key)) return "secret"
  return "malformed"
}

function isLivePaystackSecret(value: string | undefined): boolean {
  return (value || "").trim().startsWith("sk_live_")
}

function isLivePaystackPublic(value: string | undefined): boolean {
  return (value || "").trim().startsWith("pk_live_")
}

function isTestPaystackSecret(value: string | undefined): boolean {
  const trimmed = (value || "").trim()
  return trimmed.startsWith("sk_test_") && trimmed.length > "sk_test_".length && !trimmed.includes("REPLACE_ME")
}

function isTestPaystackPublic(value: string | undefined): boolean {
  const trimmed = (value || "").trim()
  return trimmed.startsWith("pk_test_") && trimmed.length > "pk_test_".length && !trimmed.includes("REPLACE_ME")
}

export function assertStagingIsolation(env: EnvMap, options: StagingCheckOptions = {}): StagingCheckResult {
  const errors: string[] = []
  if (!isStagingDeployment(env)) {
    errors.push("deployment_env_must_be_staging")
  }
  if (env.VERCEL_ENV === "production") {
    errors.push("vercel_target_is_production")
  }
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  const ref = supabaseRefFromUrl(supabaseUrl)
  if (!supabaseUrl || !ref) {
    errors.push("supabase_url_missing_or_invalid")
  } else if (ref === PRODUCTION_SUPABASE_REF || supabaseUrl.includes(PRODUCTION_SUPABASE_REF)) {
    errors.push("supabase_url_is_production")
  } else if (ref !== STAGING_SUPABASE_REF) {
    errors.push("supabase_url_is_not_staging_project")
  }

  const publishableClass = classifySupabaseApiKey(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  if (publishableClass === "missing") errors.push("publishable_key_missing")
  else if (publishableClass === "legacy_jwt") errors.push("legacy_publishable_api_key_rejected")
  else if (publishableClass !== "publishable") errors.push("publishable_key_must_be_sb_publishable")

  const secretClass = classifySupabaseApiKey(env.SUPABASE_SERVICE_ROLE_KEY)
  if (secretClass === "missing") errors.push("secret_key_missing")
  else if (secretClass === "legacy_jwt") errors.push("legacy_secret_api_key_rejected")
  else if (secretClass !== "secret") errors.push("secret_key_must_be_sb_secret")

  const appHost = hostOf(env.NEXT_PUBLIC_APP_URL)
  if (!appHost) {
    errors.push("app_url_missing_or_invalid")
  } else if (!env.NEXT_PUBLIC_APP_URL?.trim().toLowerCase().startsWith("https://")) {
    errors.push("app_url_must_be_https")
  } else if (PRODUCTION_APP_HOSTS.includes(appHost)) {
    errors.push("app_url_is_production")
    errors.push("webhook_url_is_production")
  }

  const siteHost = hostOf(env.NEXT_PUBLIC_SITE_URL)
  if (siteHost && PRODUCTION_APP_HOSTS.includes(siteHost)) {
    errors.push("site_url_is_production")
  }

  if (isLivePaystackSecret(env.PAYSTACK_SECRET_KEY)) {
    errors.push("paystack_secret_is_live")
  }
  if (isLivePaystackPublic(env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY)) {
    errors.push("paystack_public_key_is_live")
  }

  const paymentsOn = env.FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED === "true"
  if (paymentsOn) {
    if (!isTestPaystackSecret(env.PAYSTACK_SECRET_KEY)) errors.push("paystack_secret_not_test_mode")
    if (!isTestPaystackPublic(env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY)) errors.push("paystack_public_key_not_test_mode")
  }
  if (options.packageA && !paymentsOn) {
    errors.push("tenant_invoice_payments_not_enabled")
  }

  const emailMode = (env.FINZA_STAGING_EMAIL_MODE || "").trim()
  if (emailMode !== "disabled" && emailMode !== "allowlist") {
    errors.push("staging_email_mode_invalid")
  }
  if (emailMode === "disabled" && (env.RESEND_API_KEY || "").trim()) {
    errors.push("resend_key_set_while_email_disabled")
  }
  if (emailMode === "allowlist") {
    const list = (env.FINZA_STAGING_EMAIL_ALLOWLIST || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    if (list.length === 0 || list.some((item) => item === "*" || item.startsWith("@") || !item.includes("@"))) {
      errors.push("staging_email_allowlist_invalid")
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

export type RestProbeAuth =
  | "accepted_admin"
  | "recognized_public"
  | "legacy_disabled"
  | "rejected"
  | "missing"
  | "unclassified"

export type RestProbe = { http: number; auth: RestProbeAuth }

export function interpretRestProbe(status: number, bodyText: string): RestProbeAuth {
  if (/legacy api keys are disabled/i.test(bodyText)) return "legacy_disabled"
  if (status === 200) return "accepted_admin"
  // A valid sb_publishable_ key on /rest/v1/ is recognized, then refused because that route requires a secret key.
  if (/secret api key required/i.test(bodyText)) return "recognized_public"
  if (status === 403 && !/invalid api key/i.test(bodyText)) return "recognized_public"
  if (status === 401 || /invalid api key/i.test(bodyText)) return "rejected"
  return "unclassified"
}

export function assertStagingApiProbe(probe: { publishable: RestProbe; secret: RestProbe }): StagingCheckResult {
  const errors: string[] = []
  if (probe.publishable.auth === "missing") errors.push("publishable_key_missing")
  else if (probe.publishable.auth === "accepted_admin") errors.push("publishable_key_has_privileged_access")
  else if (probe.publishable.auth !== "recognized_public") errors.push("publishable_key_not_accepted_by_staging")
  if (probe.secret.auth === "missing") errors.push("secret_key_missing")
  else if (probe.secret.auth !== "accepted_admin") errors.push("secret_key_not_accepted_by_staging")
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{ status: number; text: () => Promise<string> }>

export async function probeStagingSupabaseKey(key: string | undefined, fetchImpl: FetchLike = fetch): Promise<RestProbe> {
  const classified = classifySupabaseApiKey(key)
  if (classified === "missing") return { http: 0, auth: "missing" }
  const url = `https://${STAGING_SUPABASE_REF}.supabase.co/rest/v1/`
  if (url.includes(PRODUCTION_SUPABASE_REF)) {
    return { http: 0, auth: "unclassified" }
  }
  const response = await fetchImpl(url, {
    headers: {
      apikey: (key || "").trim(),
      Authorization: `Bearer ${(key || "").trim()}`,
    },
  })
  const bodyText = await response.text()
  return { http: response.status, auth: interpretRestProbe(response.status, bodyText) }
}

export async function probeStagingApiKeys(env: EnvMap, fetchImpl?: FetchLike): Promise<{ publishable: RestProbe; secret: RestProbe }> {
  const [publishable, secret] = await Promise.all([
    probeStagingSupabaseKey(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, fetchImpl),
    probeStagingSupabaseKey(env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl),
  ])
  return { publishable, secret }
}

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./
const LIVE_SECRET_PATTERN = /\b(sk_live_|pk_live_)/

export function findUnsafeExampleViolations(content: string): string[] {
  const violations: string[] = []
  if (JWT_PATTERN.test(content)) violations.push("jwt_shaped_credential")
  if (LIVE_SECRET_PATTERN.test(content)) violations.push("live_paystack_key")
  const database = content.match(/^DATABASE_URL=(.*)$/m)
  if (database && database[1] && !database[1].includes("YOUR_PASSWORD") && !database[1].includes("REPLACE_")) {
    if (/postgres:[^@\s]+@/.test(database[1]) && !/postgres:(YOUR_PASSWORD|REPLACE_ME)@/.test(database[1])) {
      violations.push("database_url_has_password")
    }
  }
  return violations
}
