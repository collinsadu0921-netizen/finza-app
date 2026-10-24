import { NextResponse } from "next/server"
import { resolveServiceManualJournalAuthority } from "../manualJournalAuth"
import { getUserRole, isUserAccountantReadonly } from "@/lib/userRoles"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

jest.mock("@/lib/serviceWorkspace/enforceServiceWorkspaceAccess", () => ({
  enforceServiceWorkspaceAccess: jest.fn(),
}))
jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
  isUserAccountantReadonly: jest.fn(),
}))

const BIZ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const USER = "user-1111-1111-1111-111111111111"

function supabaseWithBusiness(business: Record<string, unknown> | null) {
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: business, error: null }),
  }
  return {
    from: jest.fn().mockReturnValue(query),
  } as never
}

describe("Service manual journal authority", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(enforceServiceWorkspaceAccess).mockResolvedValue(null)
    jest.mocked(getUserRole).mockResolvedValue("owner")
    jest.mocked(isUserAccountantReadonly).mockResolvedValue(false)
  })

  it("allows an owner", async () => {
    const result = await resolveServiceManualJournalAuthority({
      supabase: supabaseWithBusiness({ id: BIZ, industry: "service", archived_at: null, default_currency: "GHS" }),
      userId: USER,
      businessId: BIZ,
      required: "write",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.role).toBe("owner")
    expect(result.canWrite).toBe(true)
  })

  it("allows an admin", async () => {
    jest.mocked(getUserRole).mockResolvedValue("admin")
    const result = await resolveServiceManualJournalAuthority({
      supabase: supabaseWithBusiness({ id: BIZ, industry: "service", archived_at: null, default_currency: "GHS" }),
      userId: USER,
      businessId: BIZ,
      required: "write",
    })
    expect(result.ok).toBe(true)
  })

  it("denies a readonly accountant on write but allows read", async () => {
    jest.mocked(getUserRole).mockResolvedValue("accountant")
    jest.mocked(isUserAccountantReadonly).mockResolvedValue(true)

    const write = await resolveServiceManualJournalAuthority({
      supabase: supabaseWithBusiness({ id: BIZ, industry: "service", archived_at: null, default_currency: "GHS" }),
      userId: USER,
      businessId: BIZ,
      required: "write",
    })
    expect(write.ok).toBe(false)

    const read = await resolveServiceManualJournalAuthority({
      supabase: supabaseWithBusiness({ id: BIZ, industry: "service", archived_at: null, default_currency: "GHS" }),
      userId: USER,
      businessId: BIZ,
      required: "read",
    })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.canWrite).toBe(false)
  })

  it("denies an employee", async () => {
    jest.mocked(getUserRole).mockResolvedValue("employee")
    const result = await resolveServiceManualJournalAuthority({
      supabase: supabaseWithBusiness({ id: BIZ, industry: "service", archived_at: null, default_currency: "GHS" }),
      userId: USER,
      businessId: BIZ,
      required: "write",
    })
    expect(result.ok).toBe(false)
  })

  it("denies a non-Service business", async () => {
    const result = await resolveServiceManualJournalAuthority({
      supabase: supabaseWithBusiness({ id: BIZ, industry: "retail", archived_at: null, default_currency: "GHS" }),
      userId: USER,
      businessId: BIZ,
      required: "write",
    })
    expect(result.ok).toBe(false)
  })

  it("allows a read-only view but disables writes when the write gate is locked", async () => {
    jest.mocked(enforceServiceWorkspaceAccess)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(NextResponse.json({ error: "Locked", code: "SUBSCRIPTION_READ_ONLY" }, { status: 403 }))

    const result = await resolveServiceManualJournalAuthority({
      supabase: supabaseWithBusiness({ id: BIZ, industry: "service", archived_at: null, default_currency: "GHS" }),
      userId: USER,
      businessId: BIZ,
      required: "read",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.canWrite).toBe(false)
  })

  it("propagates subscription/tier denial", async () => {
    jest.mocked(enforceServiceWorkspaceAccess).mockResolvedValue(
      NextResponse.json({ error: "Financial writes are locked.", code: "SUBSCRIPTION_READ_ONLY" }, { status: 403 })
    )
    const result = await resolveServiceManualJournalAuthority({
      supabase: supabaseWithBusiness({ id: BIZ, industry: "service", archived_at: null, default_currency: "GHS" }),
      userId: USER,
      businessId: BIZ,
      required: "write",
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
  })
})
