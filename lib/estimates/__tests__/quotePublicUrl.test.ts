import {
  buildQuotePublicUrl,
  ensurePersistedQuotePublicToken,
  resolveEstimatePublicLink,
  resolveQuotePublicOrigin,
} from "../quotePublicUrl"

describe("quote public URL", () => {
  it("reuses an existing token and builds the public route", async () => {
    const persistToken = jest.fn()
    const result = await resolveEstimatePublicLink({
      appUrl: "https://staging.example.com",
      vercelEnv: "production",
      existingToken: "tok-existing",
      estimateId: "est-1",
      persistToken,
    })
    expect(persistToken).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      token: "tok-existing",
      publicUrl: "https://staging.example.com/quote-public/tok-existing",
    })
  })

  it("creates and persists a missing token before returning a URL", async () => {
    const persistToken = jest.fn().mockResolvedValue({ errorMessage: null })
    const result = await ensurePersistedQuotePublicToken({
      existingToken: null,
      estimateId: "est-1",
      persistToken,
      now: 1000,
    })
    expect(result).toEqual({ ok: true, token: "est_est-1_1000", created: true })
    expect(persistToken).toHaveBeenCalledWith("est_est-1_1000")
  })

  it("does not return a URL when token persistence fails", async () => {
    const result = await resolveEstimatePublicLink({
      appUrl: "https://staging.example.com",
      vercelEnv: "production",
      existingToken: "",
      estimateId: "est-1",
      persistToken: async () => ({ errorMessage: "permission denied" }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toContain("permission denied")
    expect(JSON.stringify(result)).not.toContain("https://")
  })

  it("uses the same public route for copy, email, and WhatsApp", () => {
    const origin = resolveQuotePublicOrigin({
      appUrl: "https://app.example.com",
      vercelEnv: "production",
    })
    expect(origin.ok).toBe(true)
    if (!origin.ok) return
    const url = buildQuotePublicUrl(origin.origin, "abc")
    expect(url).toBe("https://app.example.com/quote-public/abc")
  })

  it("uses the preview request origin instead of a baked production URL", () => {
    const origin = resolveQuotePublicOrigin({
      appUrl: "https://app.example.com",
      requestOrigin: "https://finza-preview.vercel.app",
      vercelEnv: "preview",
    })
    expect(origin).toEqual({ ok: true, origin: "https://finza-preview.vercel.app" })
  })

  it("does not emit localhost for a deployed environment", () => {
    const origin = resolveQuotePublicOrigin({
      appUrl: "http://localhost:3000",
      requestOrigin: "http://localhost:3000",
      vercelEnv: "production",
    })
    expect(origin.ok).toBe(false)
  })

  it("allows localhost only outside a deployment", () => {
    const origin = resolveQuotePublicOrigin({
      requestOrigin: "http://localhost:3000",
      vercelEnv: "",
    })
    expect(origin).toEqual({ ok: true, origin: "http://localhost:3000" })
  })
})
