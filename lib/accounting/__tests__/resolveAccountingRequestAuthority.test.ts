import {
  getAccountingDataClient,
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
