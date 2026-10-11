import fs from "fs"
import path from "path"
import {
  assertStagingApiProbe,
  assertStagingIsolation,
  findUnsafeExampleViolations,
  interpretRestProbe,
  isStagingDeployment,
  probeStagingSupabaseKey,
  type EnvMap,
} from "../stagingIsolation"

function stagingJwt(role: "anon" | "service_role"): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify({ role, ref: "adonhhtooawkeemdqqeo" })).toString("base64url")
  return `${header}.${body}.test-signature`
}

function stagingEnv(overrides: EnvMap = {}): EnvMap {
  return {
    FINZA_DEPLOYMENT_ENV: "staging",
    VERCEL_ENV: "preview",
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://adonhhtooawkeemdqqeo.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_stagingexamplekey",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_stagingexamplekey",
    NEXT_PUBLIC_APP_URL: "https://finza-staging-preview.vercel.app",
    NEXT_PUBLIC_SITE_URL: "https://finza-staging-preview.vercel.app",
    PAYSTACK_SECRET_KEY: "sk_test_examplekey",
    NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: "pk_test_examplekey",
    FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED: "true",
    FINZA_STAGING_EMAIL_MODE: "disabled",
    RESEND_API_KEY: "",
    ...overrides,
  }
}

describe("assertStagingIsolation", () => {
  it("accepts publishable and secret key formats when NODE_ENV is production", () => {
    expect(assertStagingIsolation(stagingEnv(), { packageA: true })).toEqual({ ok: true })
    expect(isStagingDeployment({ NODE_ENV: "production" })).toBe(false)
    expect(isStagingDeployment({ FINZA_DEPLOYMENT_ENV: "staging", NODE_ENV: "production" })).toBe(true)
  })

  it("rejects legacy anon and service-role JWTs", () => {
    const result = assertStagingIsolation(
      stagingEnv({
        NEXT_PUBLIC_SUPABASE_ANON_KEY: stagingJwt("anon"),
        SUPABASE_SERVICE_ROLE_KEY: stagingJwt("service_role"),
      })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain("legacy_publishable_api_key_rejected")
      expect(result.errors).toContain("legacy_secret_api_key_rejected")
      expect(result.errors.join(" ")).not.toContain("test-signature")
    }
  })

  it("rejects a missing publishable key and a secret placed in the publishable variable", () => {
    const missing = assertStagingIsolation(stagingEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }))
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.errors).toContain("publishable_key_missing")

    const missingSecret = assertStagingIsolation(stagingEnv({ SUPABASE_SERVICE_ROLE_KEY: "REPLACE_WITH_STAGING_SECRET_KEY" }))
    expect(missingSecret.ok).toBe(false)
    if (!missingSecret.ok) expect(missingSecret.errors).toContain("secret_key_missing")

    const swapped = assertStagingIsolation(
      stagingEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_stagingexamplekey" })
    )
    expect(swapped.ok).toBe(false)
    if (!swapped.ok) expect(swapped.errors).toContain("publishable_key_must_be_sb_publishable")
  })

  it("requires the explicit staging identity and accepts only a privileged secret probe", () => {
    const unnamed = assertStagingIsolation(stagingEnv({ FINZA_DEPLOYMENT_ENV: undefined }))
    expect(unnamed.ok).toBe(false)
    if (!unnamed.ok) expect(unnamed.errors).toContain("deployment_env_must_be_staging")

    expect(
      assertStagingApiProbe({
        publishable: { http: 403, auth: "recognized_public" },
        secret: { http: 200, auth: "accepted_admin" },
      })
    ).toEqual({ ok: true })

    const privilegedPublishable = assertStagingApiProbe({
      publishable: { http: 200, auth: "accepted_admin" },
      secret: { http: 200, auth: "accepted_admin" },
    })
    expect(privilegedPublishable.ok).toBe(false)
    if (!privilegedPublishable.ok) expect(privilegedPublishable.errors).toContain("publishable_key_has_privileged_access")
  })

  it("does not treat a prefix alone as proof the key belongs to staging", () => {
    const result = assertStagingApiProbe({
      publishable: { http: 401, auth: "rejected" },
      secret: { http: 401, auth: "rejected" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain("publishable_key_not_accepted_by_staging")
      expect(result.errors).toContain("secret_key_not_accepted_by_staging")
    }
    expect(interpretRestProbe(200, "{\"swagger\":\"2.0\"}")).toBe("accepted_admin")
    expect(interpretRestProbe(403, "{\"message\":\"permission denied\"}")).toBe("recognized_public")
    expect(interpretRestProbe(401, "{\"message\":\"Secret API key required\"}")).toBe("recognized_public")
    expect(interpretRestProbe(401, "{\"message\":\"Invalid API key\"}")).toBe("rejected")
    expect(interpretRestProbe(401, "Legacy API keys are disabled")).toBe("legacy_disabled")
  })

  it("probes only the staging project host", async () => {
    const calls: string[] = []
    const fetchImpl = async (url: string) => {
      calls.push(url)
      return { status: 403, text: async () => "{\"message\":\"permission denied\"}" }
    }
    const probe = await probeStagingSupabaseKey("sb_publishable_stagingexamplekey", fetchImpl)
    expect(probe).toEqual({ http: 403, auth: "recognized_public" })
    expect(calls).toEqual(["https://adonhhtooawkeemdqqeo.supabase.co/rest/v1/"])
    expect(JSON.stringify(probe)).not.toContain("sb_publishable_stagingexamplekey")
  })

  it("rejects a production Supabase URL even when NODE_ENV is production", () => {
    const result = assertStagingIsolation(
      stagingEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://qjxhibvbmzogyzbhswjj.supabase.co" })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain("supabase_url_is_production")
  })

  it("rejects the production application host as the callback origin", () => {
    const result = assertStagingIsolation(
      stagingEnv({ NEXT_PUBLIC_APP_URL: "https://app.finza.africa" })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain("app_url_is_production")
  })

  it("rejects Paystack live keys", () => {
    const result = assertStagingIsolation(
      stagingEnv({
        PAYSTACK_SECRET_KEY: "sk_live_notprinted",
        NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: "pk_live_notprinted",
      })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain("paystack_secret_is_live")
      expect(result.errors).toContain("paystack_public_key_is_live")
    }
  })

  it("requires the tenant invoice flag and test keys for Package A", () => {
    const result = assertStagingIsolation(
      stagingEnv({
        FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED: "false",
        PAYSTACK_SECRET_KEY: "",
        NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: "",
      }),
      { packageA: true }
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain("tenant_invoice_payments_not_enabled")
  })

  it("rejects a Vercel production target", () => {
    const result = assertStagingIsolation(stagingEnv({ VERCEL_ENV: "production" }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain("vercel_target_is_production")
  })

  it("rejects a Resend key when email delivery is disabled", () => {
    const result = assertStagingIsolation(
      stagingEnv({ RESEND_API_KEY: "re_test_present" })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain("resend_key_set_while_email_disabled")
  })

  it("accepts an allowlist and rejects a wildcard", () => {
    expect(
      assertStagingIsolation(
        stagingEnv({
          FINZA_STAGING_EMAIL_MODE: "allowlist",
          FINZA_STAGING_EMAIL_ALLOWLIST: "staging-tester@example.invalid",
          RESEND_API_KEY: "re_test_present",
        })
      ).ok
    ).toBe(true)

    const wildcard = assertStagingIsolation(
      stagingEnv({
        FINZA_STAGING_EMAIL_MODE: "allowlist",
        FINZA_STAGING_EMAIL_ALLOWLIST: "*",
        RESEND_API_KEY: "re_test_present",
      })
    )
    expect(wildcard.ok).toBe(false)
  })

  it("does not include secret values in error codes", () => {
    const result = assertStagingIsolation(
      stagingEnv({ PAYSTACK_SECRET_KEY: "sk_live_supersecretvalue" })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(" ")).not.toContain("supersecretvalue")
    }
  })
})

describe("tracked env examples", () => {
  it("rejects JWT-shaped and live Paystack material", () => {
    expect(findUnsafeExampleViolations("SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig")).toContain(
      "jwt_shaped_credential"
    )
    expect(findUnsafeExampleViolations("PAYSTACK_SECRET_KEY=sk_live_example")).toContain("live_paystack_key")
  })

  it("accepts the tracked staging example after placeholder replacement", () => {
    const file = fs.readFileSync(path.join(process.cwd(), ".env.staging.example"), "utf8")
    expect(findUnsafeExampleViolations(file)).toEqual([])
  })
})
