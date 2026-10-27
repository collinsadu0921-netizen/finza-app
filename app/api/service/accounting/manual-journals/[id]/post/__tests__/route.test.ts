import { NextRequest, NextResponse } from "next/server"
import { POST } from "../route"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { resolveServiceManualJournalAuthority } from "@/lib/service/accounting/manualJournalAuth"

jest.mock("@/lib/supabaseServer", () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock("@/lib/supabaseAdmin", () => ({ createSupabaseAdminClient: jest.fn() }))
jest.mock("@/lib/service/accounting/manualJournalAuth", () => ({
  resolveServiceManualJournalAuthority: jest.fn(),
}))

const BIZ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const USER = "user-1111-1111-1111-111111111111"
const DRAFT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

function adminWithDraft(draft: unknown = {
  id: DRAFT,
  business_id: BIZ,
  status: "draft",
  journal_entry_id: null,
}) {
  const q: any = {
    select: () => q,
    eq: () => q,
    maybeSingle: () => Promise.resolve({ data: draft, error: null }),
  }
  return { from: jest.fn(() => q) } as never
}

function userClient() {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER } }, error: null }) },
    rpc: jest.fn().mockResolvedValue({ data: "je-1", error: null }),
  } as never
}

function call() {
  return POST(
    new NextRequest(`http://localhost/api/service/accounting/manual-journals/${DRAFT}/post`, { method: "POST" }),
    { params: Promise.resolve({ id: DRAFT }) }
  )
}

describe("POST Service manual journal", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(createSupabaseAdminClient).mockReturnValue(adminWithDraft())
    jest.mocked(createSupabaseServerClient).mockResolvedValue(userClient())
    jest.mocked(resolveServiceManualJournalAuthority).mockResolvedValue({
      ok: true,
      role: "owner",
      canWrite: true,
      businessId: BIZ,
      defaultCurrency: "GHS",
    })
  })

  it("posts a draft", async () => {
    const client = userClient() as any
    jest.mocked(createSupabaseServerClient).mockResolvedValue(client)
    const response = await call()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, journal_entry_id: "je-1" })
    expect(client.rpc).toHaveBeenCalledWith("post_service_manual_journal_draft", { p_draft_id: DRAFT })
  })

  it("is retry-safe and returns the same ledger entry", async () => {
    const client = userClient() as any
    jest.mocked(createSupabaseServerClient).mockResolvedValue(client)

    const first = await call()
    const second = await call()
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await first.json()).journal_entry_id).toBe("je-1")
    expect((await second.json()).journal_entry_id).toBe("je-1")
  })

  it("returns a clear closed-period error from the database", async () => {
    const client = userClient() as any
    client.rpc.mockResolvedValue({
      data: null,
      error: { message: "SERVICE_MANUAL_PERIOD_NOT_OPEN: accounting period is locked" },
    })
    jest.mocked(createSupabaseServerClient).mockResolvedValue(client)

    const response = await call()
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe("PERIOD_NOT_OPEN")
  })

  it("denies an unauthorized user", async () => {
    jest.mocked(resolveServiceManualJournalAuthority).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 }),
    })
    const response = await call()
    expect(response.status).toBe(403)
  })

  it("returns 404 for a missing draft", async () => {
    jest.mocked(createSupabaseAdminClient).mockReturnValue(adminWithDraft(null))
    const response = await call()
    expect(response.status).toBe(404)
  })
})
