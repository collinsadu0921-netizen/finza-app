import { GET } from "@/app/api/health/version/route"

describe("GET /api/health/version", () => {
  const prevSha = process.env.VERCEL_GIT_COMMIT_SHA
  const prevEnv = process.env.VERCEL_ENV
  const prevRegion = process.env.VERCEL_REGION

  afterEach(() => {
    if (prevSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA
    else process.env.VERCEL_GIT_COMMIT_SHA = prevSha
    if (prevEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = prevEnv
    if (prevRegion === undefined) delete process.env.VERCEL_REGION
    else process.env.VERCEL_REGION = prevRegion
  })

  it("returns only non-sensitive build fields", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abc1234"
    process.env.VERCEL_ENV = "preview"
    process.env.VERCEL_REGION = "iad1"
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(res.headers.get("X-Finza-Commit")).toBe("abc1234")
    expect(res.headers.get("X-Finza-Region")).toBe("iad1")
    expect(body).toEqual({
      commit_sha: "abc1234",
      environment: "preview",
      region: "iad1",
    })
    expect(JSON.stringify(body)).not.toMatch(/supabase|service_role|password|token|secret|host/i)
  })
})
