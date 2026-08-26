import {
  deniedMutationResponse,
  getAccountingDataClient,
  getAccountingIdentityClient,
  type AccountingRequestAuthorityOk,
} from "@/lib/accounting/resolveAccountingRequestAuthority"

jest.mock("@/lib/supabaseAdmin", () => ({
  createSupabaseAdminClient: jest.fn(() => ({ kind: "admin" })),
}))

describe("getAccountingDataClient", () => {
  it("returns admin client for practice authority", () => {
    const auth = {
      ok: true,
      isPractice: true,
      businessId: "b1",
    } as AccountingRequestAuthorityOk
    const user = { kind: "user" } as never
    const client = getAccountingDataClient(auth, user)
    expect((client as { kind: string }).kind).toBe("admin")
  })

  it("returns user client for service authority", () => {
    const auth = {
      ok: true,
      isPractice: false,
      businessId: "b1",
    } as AccountingRequestAuthorityOk
    const user = { kind: "user" } as never
    expect(getAccountingDataClient(auth, user)).toBe(user)
  })
})

describe("getAccountingIdentityClient", () => {
  it("returns the user session for Practice — never the admin data client", () => {
    const auth = {
      ok: true,
      isPractice: true,
      businessId: "b1",
    } as AccountingRequestAuthorityOk
    const user = { kind: "user" } as never
    expect(getAccountingIdentityClient(auth, user)).toBe(user)
    expect(getAccountingDataClient(auth, user)).not.toBe(user)
  })

  it("returns the user session for Service owner", () => {
    const auth = {
      ok: true,
      isPractice: false,
      businessId: "b1",
    } as AccountingRequestAuthorityOk
    const user = { kind: "user" } as never
    expect(getAccountingIdentityClient(auth, user)).toBe(user)
  })
})

describe("resolveAccountingRequestAuthority missing business", () => {
  it("rejects blank business_id without DB calls", async () => {
    const { resolveAccountingRequestAuthority } = await import(
      "@/lib/accounting/resolveAccountingRequestAuthority"
    )
    const r = await resolveAccountingRequestAuthority({
      supabase: {} as never,
      userId: "u1",
      businessId: " ",
      requiredLevel: "read",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasonCode).toBe("MISSING_BUSINESS_ID")
      expect(r.status).toBe(400)
    }
  })
})

describe("deniedMutationResponse", () => {
  const denied = {
    ok: false as const,
    status: 403 as const,
    error: "Forbidden",
    reasonCode: "INSUFFICIENT_ACCESS_LEVEL",
    businessId: "b1",
  }

  it("names approve when approve is required", () => {
    const r = deniedMutationResponse(denied, "approve", "reverse this journal")
    expect(r.status).toBe(403)
    expect(r.body.reason_code).toBe("INSUFFICIENT_ACCESS_LEVEL")
    expect(r.body.error).toBe("Approve access is required to reverse this journal.")
  })

  it("names write when write is required", () => {
    const r = deniedMutationResponse(denied, "write", "create adjusting journals")
    expect(r.body.error).toBe("Write access is required to create adjusting journals.")
  })

  it("keeps engagement-state codes unchanged", () => {
    const r = deniedMutationResponse(
      { ...denied, reasonCode: "ENGAGEMENT_PENDING" },
      "approve",
      "reverse this journal"
    )
    expect(r.body.reason_code).toBe("ENGAGEMENT_PENDING")
    expect(r.body.error).toBe("Forbidden")
  })
})
