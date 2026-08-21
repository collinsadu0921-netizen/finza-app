import { createRequire } from "module"

const nodeRequire = createRequire(__filename)
const guards = nodeRequire("../lib/productionReleaseGuards.cjs") as {
  PRODUCTION: { projectId: string; projectName: string; crons: { path: string; schedule: string }[] }
  ReleaseGuardError: new (code: string, message: string) => Error
  assertExpectedSha: (sha: string) => string
  assertShaMatch: (expected: string, actual: string) => void
  assertProject: (project: { id?: string; name?: string }) => void
  assertProductionTarget: (target: string) => void
  assertReady: (state: string) => void
  assertRegion: (actual: unknown) => void
  assertProjectDefaultRegion: (project: Record<string, unknown>) => void
  parseInspectFunctionRegions: (text: string) => string[]
  parseXVercelIdRegion: (header: string) => string | null
  assertAlias: (aliases: unknown[], deploymentId: string, productionTargetId?: string) => void
  assertCrons: (definitions: unknown) => void
  assertSupabaseIdentity: (url: string) => void
  buildDeployArgs: (sha: string) => string[]
  parseDeployedSha: (deployment: unknown) => string
  assertCleanWorktree: (porcelain: string) => void
}

const {
  PRODUCTION,
  ReleaseGuardError,
  assertExpectedSha,
  assertShaMatch,
  assertProject,
  assertProductionTarget,
  assertReady,
  assertRegion,
  assertProjectDefaultRegion,
  parseInspectFunctionRegions,
  parseXVercelIdRegion,
  assertAlias,
  assertCrons,
  assertSupabaseIdentity,
  buildDeployArgs,
  parseDeployedSha,
  assertCleanWorktree,
} = guards

const GOOD_SHA = "45ca3db06b8a0175a018cdaf9b8dbc8bf7f94656"
const OTHER_SHA = "b26e699ec7b9f6756b94eb33ab61647976ec3bc3"

function expectCode(fn: () => unknown, code: string) {
  try {
    fn()
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(ReleaseGuardError)
    expect((error as { code: string }).code).toBe(code)
  }
}

describe("production release guards", () => {
  it("fails the wrong project", () => {
    expectCode(
      () => assertProject({ id: "prj_v1ReATVM7fae5NqoexqTKYtBuWwU", name: "finza-app-perf-arn" }),
      "WRONG_PROJECT",
    )
    expect(() =>
      assertProject({ id: PRODUCTION.projectId, name: PRODUCTION.projectName }),
    ).not.toThrow()
  })

  it("fails a missing SHA", () => {
    expectCode(() => assertExpectedSha(""), "MISSING_SHA")
    expectCode(() => assertExpectedSha("45ca3db"), "MISSING_SHA")
    expect(assertExpectedSha(GOOD_SHA)).toBe(GOOD_SHA)
  })

  it("fails a mismatched SHA", () => {
    expectCode(() => assertShaMatch(GOOD_SHA, OTHER_SHA), "SHA_MISMATCH")
    expectCode(() => assertShaMatch(GOOD_SHA, ""), "SHA_MISMATCH")
    expect(() => assertShaMatch(GOOD_SHA, GOOD_SHA)).not.toThrow()
  })

  it("accepts arn1 and rejects iad1 or unknown", () => {
    expect(() => assertRegion("arn1")).not.toThrow()
    expect(() => assertRegion(["arn1"])).not.toThrow()
    expectCode(() => assertRegion("iad1"), "IAD1_REGION")
    expectCode(() => assertRegion(["iad1"]), "IAD1_REGION")
    expectCode(() => assertRegion(null), "UNKNOWN_REGION")
    expectCode(() => assertRegion([]), "UNKNOWN_REGION")
    expectCode(() => assertRegion("dub1"), "WRONG_REGION")
  })

  it("fails a missing deployment alias", () => {
    expectCode(() => assertAlias([], "dpl_new"), "ALIAS_MISMATCH")
    expectCode(
      () => assertAlias(["app.finza.africa"], "dpl_new", "dpl_old"),
      "ALIAS_MISMATCH",
    )
    expect(() =>
      assertAlias(["https://app.finza.africa"], "dpl_new", "dpl_new"),
    ).not.toThrow()
  })

  it("fails unexpected cron configuration", () => {
    expectCode(() => assertCrons([]), "CRON_MISMATCH")
    expectCode(
      () =>
        assertCrons([
          ...PRODUCTION.crons,
          { path: "/api/cron/forensic-accounting-verification", schedule: "0 3 * * *" },
        ]),
      "CRON_MISMATCH",
    )
    expect(() => assertCrons(PRODUCTION.crons)).not.toThrow()
  })

  it("parses Vercel inspect function regions", () => {
    const inspect = `
      ├── λ index (4.52MB) [arn1]
      ├── λ _global-error (4.52MB) [arn1]
    `
    expect(parseInspectFunctionRegions(inspect)).toEqual(["arn1"])
    expect(parseInspectFunctionRegions("λ index (4.52MB) [iad1]")).toEqual(["iad1"])
    expect(parseInspectFunctionRegions("")).toEqual([])
  })

  it("parses x-vercel-id runtime region", () => {
    expect(parseXVercelIdRegion("cpt1::arn1::mh7ft-1")).toBe("arn1")
    expect(parseXVercelIdRegion("cpt1::iad1::abc")).toBe("iad1")
    expect(parseXVercelIdRegion("")).toBeNull()
  })

  it("reads deployed SHA from inspect metadata", () => {
    expect(parseDeployedSha({ meta: { gitCommitSha: GOOD_SHA } })).toBe(GOOD_SHA)
    expect(parseDeployedSha({})).toBe("")
  })

  it("requires a clean worktree and production target", () => {
    expect(() => assertCleanWorktree("")).not.toThrow()
    expectCode(() => assertCleanWorktree(" M package.json"), "DIRTY_WORKTREE")
    expect(() => assertProductionTarget("production")).not.toThrow()
    expectCode(() => assertProductionTarget("preview"), "WRONG_TARGET")
    expect(() => assertReady("READY")).not.toThrow()
    expectCode(() => assertReady("ERROR"), "NOT_READY")
    expectCode(() => assertReady(""), "NOT_READY")
  })

  it("blocks a production release while the project default is iad1", () => {
    expectCode(
      () => assertProjectDefaultRegion({ serverlessFunctionRegion: "iad1", functionDefaultRegions: ["iad1"] }),
      "IAD1_REGION",
    )
    expect(() =>
      assertProjectDefaultRegion({ serverlessFunctionRegion: "arn1", functionDefaultRegions: ["arn1"] }),
    ).not.toThrow()
  })

  it("rejects staging Supabase identity", () => {
    expect(() =>
      assertSupabaseIdentity("https://qjxhibvbmzogyzbhswjj.supabase.co"),
    ).not.toThrow()
    expectCode(
      () => assertSupabaseIdentity("https://adonhhtooawkeemdqqeo.supabase.co"),
      "STAGING_ENV",
    )
    expectCode(() => assertSupabaseIdentity(""), "ENV_UNVERIFIED")
  })

  it("always includes --prod and --regions arn1", () => {
    expect(buildDeployArgs(GOOD_SHA)).toEqual([
      "deploy",
      "--prod",
      "--yes",
      "--regions",
      "arn1",
      "--meta",
      `gitCommitSha=${GOOD_SHA}`,
    ])
  })
})
