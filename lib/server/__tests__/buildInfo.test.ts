import { publicBuildInfo } from "@/lib/server/buildInfo"

describe("publicBuildInfo", () => {
  const prev = {
    sha: process.env.VERCEL_GIT_COMMIT_SHA,
    env: process.env.VERCEL_ENV,
    region: process.env.VERCEL_REGION,
    node: process.env.NODE_ENV,
  }

  afterEach(() => {
    if (prev.sha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA
    else process.env.VERCEL_GIT_COMMIT_SHA = prev.sha
    if (prev.env === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = prev.env
    if (prev.region === undefined) delete process.env.VERCEL_REGION
    else process.env.VERCEL_REGION = prev.region
  })

  it("handles missing Vercel metadata safely", () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA
    delete process.env.VERCEL_ENV
    delete process.env.VERCEL_REGION
    const info = publicBuildInfo()
    expect(info.commit_sha).toBeNull()
    expect(info.region).toBeNull()
    expect(typeof info.environment).toBe("string")
    expect(Object.keys(info).sort()).toEqual(["commit_sha", "environment", "region"])
  })

  it("returns only the commit SHA when present", () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "966d980105feb046b9dbdc8c1237a5f98be28a3d"
    process.env.VERCEL_ENV = "preview"
    process.env.VERCEL_REGION = "iad1"
    const info = publicBuildInfo()
    expect(info).toEqual({
      commit_sha: "966d980105feb046b9dbdc8c1237a5f98be28a3d",
      environment: "preview",
      region: "iad1",
    })
    const leaked = JSON.stringify(info)
    expect(leaked).not.toMatch(/supabase|service_role|password|token|secret/i)
  })
})
