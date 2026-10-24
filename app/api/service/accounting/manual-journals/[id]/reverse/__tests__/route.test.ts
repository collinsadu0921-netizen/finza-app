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
const JE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

function adminWithOriginal(original: unknown = {
  id: JE,
  business_id: BIZ,
  source_type: "service_manual",
  date: "2026-08-20",
}) {
  const q: any = {
    select: () => q,
    eq: () => q,
    maybeSingle: () => Promise.resolve({ data: original, error: null }),
  }
  return { from: jest.fn(() => q) } as never
}

function userClient() {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER } }, error: null }) },
    rpc: jest.fn().mockResolvedValue({ data: "rev-1", error: null }),
  } as never
}

function call(body: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/service/accounting/manual-journals/${JE}/reverse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: JE }) }
  )
}

describe("POST Service manual journal reversal", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(createSupabaseAdminClient).mockReturnValue(adminWithOriginal())
    jest.mocked(createSupabaseServerClient).mockResolvedValue(userClient())
    jest.mocked(resolveServiceManualJournalAuthority).mockResolvedValue({
      ok: true,
      role: "owner",
      canWrite: true,
      businessId: BIZ,
      defaultCurrency: "GHS",
    })
  })

  it("posts a linked reversal", async () => {
    const client = userClient() as any
    jest.mocked(createSupabaseServerClient).mockResolvedValue(client)
    const response = await call({ reversal_date: "2026-09-01", reason: "Correct duplicate accrual" })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, reversal_journal_entry_id: "rev-1" })
    expect(client.rpc).toHaveBeenCalledWith("reverse_service_manual_journal", {
      p_journal_entry_id: JE,
      p_reversal_date: "2026-09-01",
      p_reason: "Correct duplicate accrual",
    })
  })

  it("rejects a short reason before calling the RPC", async () => {
    const client = userClient() as any
    jest.mocked(createSupabaseServerClient).mockResolvedValue(client)
    const response = await call({ reversal_date: "2026-09-01", reason: "short" })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe("REASON_INVALID")
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("denies an unauthorized user", async () => {
    jest.mocked(resolveServiceManualJournalAuthority).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 }),
    })
    const response = await call({ reversal_date: "2026-09-01", reason: "Correct duplicate accrual" })
    expect(response.status).toBe(403)
  })
})
