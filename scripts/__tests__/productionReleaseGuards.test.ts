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
  assertProductionSupabasePair: (
    url: string,
    serviceRoleKey: string,
    options?: { opaqueProof?: { accepted?: boolean; projectRef?: string } },
  ) => { format: string; ref: string; role: string }
  classifyServiceRoleCredential: (value: string) => string
  detectSupabaseCredentialFormat: (value: string) => string
  decodeSupabaseServiceRoleJwtIdentity: (key: string) => { ref: string; role: string }
  assertLegacyServiceRoleClaims: (claims: { ref?: string; role?: string }) => { ref: string; role: string }
  evaluateOpaqueSecretVerifierStatus: (status: number) => { accepted: boolean; reason?: string }
  assertOpaqueSecretProof: (proof: unknown) => { ref: string; role: string }
  buildOpaqueSecretIdentityRequest: (url: string) => { method: string; url: string; headers: Record<string, string> }
  redactCredentialFragments: (text: string) => string
  toSafeReleaseFailure: (error: unknown) => { ok: false; code: string; message: string; stage?: string }
  toSafeEnvPullDiagnostic: (error: unknown) => Record<string, unknown> | null
  envPullDiagnosticError: (stage: string, extras?: Record<string, unknown>) => Error
  diagnoseSecretSafeChild: (result: {
    started?: boolean
    exitCode?: number | null
    signal?: string | null
  }) => { ok: boolean; stage: string | null; exitCode: number | null; signal: string | null }
  parseDotEnv: (text: string) => Record<string, string>
  inspectPulledProductionEnv: (
    dest: string,
    io: {
      existsSync: (path: string) => boolean
      readFileSync: (path: string, encoding: string) => string
      parseDotEnv?: (text: string) => Record<string, string>
    },
  ) => { stage: string; extracted: { url: string; serviceRoleKey: string } }
  resolveHostedReleaseMode: (inputs: { confirm?: string; mode?: string }) => {
    runReleaseJob: boolean
    runDiagnoseJob: boolean
    mayDeploy: boolean
    releaseRequiresConfirm: boolean
    scriptArgs: string[]
    includesPreflight: boolean
    includesDeploy: boolean
  }
  withTempProductionEnvDir: <T>(fn: (paths: { dir: string; dest: string }) => T) => T
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
  assertProductionSupabasePair,
  classifyServiceRoleCredential,
  detectSupabaseCredentialFormat,
  decodeSupabaseServiceRoleJwtIdentity,
  evaluateOpaqueSecretVerifierStatus,
  assertOpaqueSecretProof,
  buildOpaqueSecretIdentityRequest,
  redactCredentialFragments,
  toSafeReleaseFailure,
  toSafeEnvPullDiagnostic,
  envPullDiagnosticError,
  diagnoseSecretSafeChild,
  parseDotEnv,
  inspectPulledProductionEnv,
  resolveHostedReleaseMode,
  withTempProductionEnvDir,
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
    expect(parseInspectFunctionRegions("λ index (4.52MB) [630ms] [0ms] [arn1]")).toEqual(["arn1"])
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

function syntheticJwt(claims: Record<string, string>, secret = "test-signature-not-a-real-key") {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
  return `${header}.${payload}.${Buffer.from(secret).toString("base64url")}`
}

const PROD_URL = "https://qjxhibvbmzogyzbhswjj.supabase.co"
const STAGING_URL = "https://adonhhtooawkeemdqqeo.supabase.co"
const PROD_JWT = syntheticJwt({
  iss: "supabase",
  ref: "qjxhibvbmzogyzbhswjj",
  role: "service_role",
})
const STAGING_JWT = syntheticJwt({
  iss: "supabase",
  ref: "adonhhtooawkeemdqqeo",
  role: "service_role",
})
const WRONG_ROLE_JWT = syntheticJwt({
  iss: "supabase",
  ref: "qjxhibvbmzogyzbhswjj",
  role: "anon",
})
const MISSING_REF_JWT = syntheticJwt({
  iss: "supabase",
  role: "service_role",
})
const MISSING_ROLE_JWT = syntheticJwt({
  iss: "supabase",
  ref: "qjxhibvbmzogyzbhswjj",
})
const OPAQUE_SECRET = "sb_secret_DO_NOT_LEAK_TEST_VALUE"
const PROD_OPAQUE_PROOF = { accepted: true, projectRef: "qjxhibvbmzogyzbhswjj" }

function expectNoSecretLeak(run: () => unknown, secrets: string[]) {
  try {
    run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const serialized = JSON.stringify(error)
    const safe = toSafeReleaseFailure(error)
    for (const secret of secrets) {
      expect(message).not.toContain(secret)
      expect(serialized).not.toContain(secret)
      expect(safe.message).not.toContain(secret)
      expect(JSON.stringify(safe)).not.toContain(secret)
    }
    return
  }
  throw new Error("expected failure")
}

describe("production service-role identity", () => {
  it("accepts production URL plus production service-role JWT", () => {
    const result = assertProductionSupabasePair(PROD_URL, PROD_JWT)
    expect(result).toEqual({
      format: "jwt",
      ref: "qjxhibvbmzogyzbhswjj",
      role: "service_role",
    })
  })

  it("rejects production URL plus staging service-role JWT", () => {
    expectCode(() => assertProductionSupabasePair(PROD_URL, STAGING_JWT), "STAGING_ENV")
  })

  it("rejects staging URL plus production service-role JWT", () => {
    expectCode(() => assertProductionSupabasePair(STAGING_URL, PROD_JWT), "STAGING_ENV")
  })

  it("fails closed when the service-role is missing", () => {
    expectCode(() => assertProductionSupabasePair(PROD_URL, ""), "SERVICE_ROLE_ENV_UNVERIFIED")
    expectCode(() => assertProductionSupabasePair(PROD_URL, "   "), "SERVICE_ROLE_ENV_UNVERIFIED")
  })

  it("fails closed when the service-role is malformed", () => {
    expectCode(() => assertProductionSupabasePair(PROD_URL, "not-a-jwt-or-secret"), "SERVICE_ROLE_UNVERIFIED")
    expectCode(() => assertProductionSupabasePair(PROD_URL, "eyJonlyonepart"), "SERVICE_ROLE_UNVERIFIED")
  })

  it("rejects a JWT with the production ref but the wrong role", () => {
    expectCode(() => assertProductionSupabasePair(PROD_URL, WRONG_ROLE_JWT), "SERVICE_ROLE_UNVERIFIED")
  })

  it("rejects a JWT missing the project ref", () => {
    expectCode(() => assertProductionSupabasePair(PROD_URL, MISSING_REF_JWT), "SERVICE_ROLE_UNVERIFIED")
  })

  it("rejects a JWT missing the role claim", () => {
    expectCode(() => assertProductionSupabasePair(PROD_URL, MISSING_ROLE_JWT), "SERVICE_ROLE_UNVERIFIED")
  })

  it("explicitly rejects the staging project ref", () => {
    expectCode(() => assertProductionSupabasePair(PROD_URL, STAGING_JWT), "STAGING_ENV")
    expectCode(() => assertProductionSupabasePair(STAGING_URL, STAGING_JWT), "STAGING_ENV")
    expectCode(
      () => assertProductionSupabasePair(PROD_URL, OPAQUE_SECRET, {
        opaqueProof: { accepted: true, projectRef: "adonhhtooawkeemdqqeo" },
      }),
      "STAGING_ENV",
    )
  })

  it("classifies opaque sb_secret keys without JWT parsing", () => {
    expect(detectSupabaseCredentialFormat(OPAQUE_SECRET)).toBe("secret")
    expect(classifyServiceRoleCredential(OPAQUE_SECRET)).toBe("secret")
    expect(classifyServiceRoleCredential(PROD_JWT)).toBe("jwt")
    expectCode(() => decodeSupabaseServiceRoleJwtIdentity(OPAQUE_SECRET), "SERVICE_ROLE_UNVERIFIED")
  })

  it("fails closed when opaque-key verification is missing or rejected", () => {
    expectCode(() => assertProductionSupabasePair(PROD_URL, OPAQUE_SECRET), "SERVICE_ROLE_UNVERIFIED")
    expectCode(
      () => assertProductionSupabasePair(PROD_URL, OPAQUE_SECRET, { opaqueProof: { accepted: false } }),
      "SERVICE_ROLE_UNVERIFIED",
    )
    expectCode(() => assertOpaqueSecretProof({ accepted: false }), "SERVICE_ROLE_UNVERIFIED")
  })

  it("accepts an opaque key only with a production identity proof", () => {
    expect(
      assertProductionSupabasePair(PROD_URL, OPAQUE_SECRET, { opaqueProof: PROD_OPAQUE_PROOF }),
    ).toEqual({
      format: "secret",
      ref: "qjxhibvbmzogyzbhswjj",
      role: "service_role",
    })
    expectCode(
      () => assertProductionSupabasePair(STAGING_URL, OPAQUE_SECRET, { opaqueProof: PROD_OPAQUE_PROOF }),
      "STAGING_ENV",
    )
  })

  it("evaluates opaque verifier statuses without network", () => {
    expect(evaluateOpaqueSecretVerifierStatus(200)).toEqual({ accepted: true })
    expect(evaluateOpaqueSecretVerifierStatus(401)).toEqual({ accepted: false, reason: "rejected" })
    expect(evaluateOpaqueSecretVerifierStatus(403)).toEqual({ accepted: false, reason: "rejected" })
    expect(evaluateOpaqueSecretVerifierStatus(500)).toEqual({ accepted: false, reason: "unverifiable" })
    expect(evaluateOpaqueSecretVerifierStatus(0)).toEqual({ accepted: false, reason: "unverifiable" })
    const request = buildOpaqueSecretIdentityRequest(PROD_URL)
    expect(request.method).toBe("GET")
    expect(request.url).toBe(
      "https://qjxhibvbmzogyzbhswjj.supabase.co/auth/v1/admin/users?page=1&per_page=1",
    )
    expect(JSON.stringify(request)).not.toContain("apikey")
    expectCode(() => buildOpaqueSecretIdentityRequest(STAGING_URL), "STAGING_ENV")
  })

  it("never includes the supplied secret in thrown or serialized diagnostics", () => {
    const secrets = [STAGING_JWT, PROD_JWT, WRONG_ROLE_JWT, OPAQUE_SECRET, "super-secret-service-role-value-xyz"]
    const cases: Array<() => unknown> = [
      () => assertProductionSupabasePair(PROD_URL, STAGING_JWT),
      () => assertProductionSupabasePair(STAGING_URL, PROD_JWT),
      () => assertProductionSupabasePair(PROD_URL, ""),
      () => assertProductionSupabasePair(PROD_URL, WRONG_ROLE_JWT),
      () => assertProductionSupabasePair(PROD_URL, MISSING_REF_JWT),
      () => assertProductionSupabasePair(PROD_URL, MISSING_ROLE_JWT),
      () => assertProductionSupabasePair(PROD_URL, "super-secret-service-role-value-xyz"),
      () => assertProductionSupabasePair(PROD_URL, OPAQUE_SECRET),
      () => decodeSupabaseServiceRoleJwtIdentity(OPAQUE_SECRET),
    ]
    for (const run of cases) {
      expectNoSecretLeak(run, secrets)
    }
    expect(redactCredentialFragments(`key was ${OPAQUE_SECRET}`)).not.toContain(OPAQUE_SECRET)
    expect(redactCredentialFragments(`token ${PROD_JWT}`)).not.toContain(PROD_JWT)
  })
})

describe("production env-pull diagnostics", () => {
  const SYNTHETIC_EXPORT = [
    `NEXT_PUBLIC_SUPABASE_URL=${PROD_URL}`,
    `SUPABASE_SERVICE_ROLE_KEY=${PROD_JWT}`,
  ].join("\n")

  function inspectText(text: string, parse?: (value: string) => Record<string, string>) {
    return inspectPulledProductionEnv("production.env", {
      existsSync: () => true,
      readFileSync: () => text,
      parseDotEnv: parse,
    })
  }

  it("classifies child spawn and nonzero export exits", () => {
    expect(diagnoseSecretSafeChild({ started: false })).toEqual({
      ok: false,
      stage: "CHILD_SPAWN_FAILED",
      exitCode: null,
      signal: null,
    })
    expect(diagnoseSecretSafeChild({ started: true, exitCode: 1 })).toEqual({
      ok: false,
      stage: "ENV_PULL_NONZERO",
      exitCode: 1,
      signal: null,
    })
    expect(diagnoseSecretSafeChild({ started: true, exitCode: null, signal: "SIGTERM" })).toEqual({
      ok: false,
      stage: "ENV_PULL_NONZERO",
      exitCode: null,
      signal: "SIGTERM",
    })
    expect(diagnoseSecretSafeChild({ started: true, exitCode: 0 })).toEqual({
      ok: true,
      stage: null,
      exitCode: 0,
      signal: null,
    })
  })

  it("classifies missing file, read failure, and parse failure", () => {
    expectCode(
      () => inspectPulledProductionEnv("missing.env", { existsSync: () => false, readFileSync: () => "" }),
      "SERVICE_ROLE_ENV_UNVERIFIED",
    )
    try {
      inspectPulledProductionEnv("missing.env", { existsSync: () => false, readFileSync: () => "" })
    } catch (error) {
      expect((error as { stage: string }).stage).toBe("EXPORT_FILE_MISSING")
      expect((error as { exportFileExists: boolean }).exportFileExists).toBe(false)
    }
    expectCode(
      () =>
        inspectPulledProductionEnv("production.env", {
          existsSync: () => true,
          readFileSync: () => {
            throw new Error(`cannot read ${PROD_JWT}`)
          },
        }),
      "SERVICE_ROLE_ENV_UNVERIFIED",
    )
    try {
      inspectPulledProductionEnv("production.env", {
        existsSync: () => true,
        readFileSync: () => {
          throw new Error(`cannot read ${PROD_JWT}`)
        },
      })
    } catch (error) {
      expect((error as { stage: string }).stage).toBe("EXPORT_READ_FAILED")
      expect(JSON.stringify(toSafeReleaseFailure(error))).not.toContain(PROD_JWT)
    }
    expectCode(
      () => inspectText(SYNTHETIC_EXPORT, () => {
        throw new Error(`bad parse ${OPAQUE_SECRET}`)
      }),
      "SERVICE_ROLE_ENV_UNVERIFIED",
    )
    try {
      inspectText(SYNTHETIC_EXPORT, () => {
        throw new Error(`bad parse ${OPAQUE_SECRET}`)
      })
    } catch (error) {
      expect((error as { stage: string }).stage).toBe("EXPORT_PARSE_FAILED")
      expect(JSON.stringify(toSafeReleaseFailure(error))).not.toContain(OPAQUE_SECRET)
    }
  })

  it("classifies empty URL, empty service-role, and both keys present", () => {
    try {
      inspectText("SUPABASE_SERVICE_ROLE_KEY=sb_secret_SYNTHETIC_EMPTY_URL_PATH")
    } catch (error) {
      expect((error as { code: string }).code).toBe("ENV_UNVERIFIED")
      expect((error as { stage: string }).stage).toBe("URL_ABSENT_OR_EMPTY")
      expect((error as { hasUrl: boolean }).hasUrl).toBe(false)
      expect((error as { hasServiceRoleKey: boolean }).hasServiceRoleKey).toBe(true)
      expect((error as { serviceRoleKeyNonEmpty: boolean }).serviceRoleKeyNonEmpty).toBe(true)
    }
    try {
      inspectText(`NEXT_PUBLIC_SUPABASE_URL=${PROD_URL}\nSUPABASE_SERVICE_ROLE_KEY=`)
    } catch (error) {
      expect((error as { code: string }).code).toBe("SERVICE_ROLE_ENV_UNVERIFIED")
      expect((error as { stage: string }).stage).toBe("SERVICE_ROLE_KEY_ABSENT_OR_EMPTY")
      expect((error as { hasUrl: boolean }).hasUrl).toBe(true)
      expect((error as { serviceRoleKeyNonEmpty: boolean }).serviceRoleKeyNonEmpty).toBe(false)
    }
    const present = inspectText(SYNTHETIC_EXPORT)
    expect(present.stage).toBe("KEYS_PRESENT")
    expect(present.extracted.url).toBe(PROD_URL)
    expect(parseDotEnv(SYNTHETIC_EXPORT).SUPABASE_SERVICE_ROLE_KEY).toBe(PROD_JWT)
  })

  it("never includes synthetic credentials in safe diagnostic JSON", () => {
    const secrets = [PROD_JWT, OPAQUE_SECRET, "sb_secret_SYNTHETIC_EMPTY_URL_PATH"]
    const error = envPullDiagnosticError("SERVICE_ROLE_KEY_ABSENT_OR_EMPTY", {
      exitCode: 1,
      exportFileExists: true,
      hasUrl: true,
      hasServiceRoleKey: true,
      serviceRoleKeyNonEmpty: false,
      versions: { node: "v20.20.2", npm: "10.8.2", vercel: "59.10.0" },
    })
    ;(error as { message: string }).message += ` leaked ${PROD_JWT} ${OPAQUE_SECRET}`
    const safe = toSafeReleaseFailure(error)
    const serialized = JSON.stringify(safe)
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret)
    }
    expect(safe.stage).toBe("SERVICE_ROLE_KEY_ABSENT_OR_EMPTY")
    expect(safe).toMatchObject({
      exitCode: 1,
      exportFileExists: true,
      hasUrl: true,
      hasServiceRoleKey: true,
      serviceRoleKeyNonEmpty: false,
    })
    expect(toSafeEnvPullDiagnostic({ message: PROD_JWT })).toBeNull()
  })

  it("removes the temporary export directory after success and failure", () => {
    const { existsSync } = require("node:fs") as { existsSync: (path: string) => boolean }
    let captured = ""
    withTempProductionEnvDir(({ dir }) => {
      captured = dir
      expect(existsSync(dir)).toBe(true)
    })
    expect(captured).toBeTruthy()
    expect(existsSync(captured)).toBe(false)
    expect(() =>
      withTempProductionEnvDir(({ dir }) => {
        captured = dir
        throw new Error("synthetic cleanup failure")
      }),
    ).toThrow("synthetic cleanup failure")
    expect(existsSync(captured)).toBe(false)
  })

  it("selects preflight for diagnose and keeps RELEASE required for deploy", () => {
    const diagnose = resolveHostedReleaseMode({ confirm: "RELEASE", mode: "diagnose" })
    expect(diagnose.runDiagnoseJob).toBe(true)
    expect(diagnose.runReleaseJob).toBe(false)
    expect(diagnose.mayDeploy).toBe(false)
    expect(diagnose.includesPreflight).toBe(true)
    expect(diagnose.includesDeploy).toBe(false)
    expect(diagnose.scriptArgs).toEqual(["--preflight", "--expected-sha"])

    const blocked = resolveHostedReleaseMode({ confirm: "nope", mode: "release" })
    expect(blocked.runReleaseJob).toBe(false)
    expect(blocked.mayDeploy).toBe(false)
    expect(blocked.releaseRequiresConfirm).toBe(true)

    const release = resolveHostedReleaseMode({ confirm: "RELEASE", mode: "release" })
    expect(release.runReleaseJob).toBe(true)
    expect(release.runDiagnoseJob).toBe(false)
    expect(release.mayDeploy).toBe(true)
    expect(release.includesPreflight).toBe(false)
    expect(release.scriptArgs).toEqual(["--expected-sha"])
  })

  it("keeps the hosted diagnose job on --preflight and off vercel deploy", () => {
    const { readFileSync } = require("node:fs") as { readFileSync: (path: string, encoding: string) => string }
    const { join } = require("node:path") as { join: (...parts: string[]) => string }
    const yaml = readFileSync(join(__dirname, "../../.github/workflows/production-release.yml"), "utf8")
    expect(yaml).toContain("required: true")
    expect(yaml).toContain("Type RELEASE to deploy the selected SHA to production ARN1")
    expect(yaml).toContain("github.event.inputs.confirm == 'RELEASE'")
    expect(yaml).toContain("github.event.inputs.mode != 'diagnose'")
    expect(yaml).toContain("github.event.inputs.mode == 'diagnose'")
    const diagnoseBlock = yaml.slice(yaml.indexOf("diagnose:"))
    expect(diagnoseBlock).toContain("node scripts/release-production.mjs --preflight --expected-sha ${{ github.sha }}")
    expect(diagnoseBlock).not.toMatch(/vercel deploy/)
    expect(diagnoseBlock).not.toContain("release-production.mjs --expected-sha ${{ github.sha }}\n")
    expect(diagnoseBlock).toContain("secrets.VERCEL_TOKEN")
    expect(diagnoseBlock).toContain("secrets.VERCEL_ORG_ID")
    expect(diagnoseBlock).toContain("secrets.VERCEL_PROJECT_ID")
    const releaseBlock = yaml.slice(yaml.indexOf("release:"), yaml.indexOf("diagnose:"))
    expect(releaseBlock).toContain("node scripts/release-production.mjs --expected-sha ${{ github.sha }}")
    expect(releaseBlock).not.toContain("--preflight")
  })
})
