import { describe, expect, it, jest, beforeEach } from "@jest/globals"
import { POST } from "../route"
import { NextRequest } from "next/server"
import { resolveAccountingRequestAuthority } from "@/lib/accounting/resolveAccountingRequestAuthority"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceWorkspaceAccess", () => ({
  enforceServiceWorkspaceAccess: jest.fn(() => Promise.resolve(null)),
  enforceServiceWorkspaceWriteAccess: jest.fn(() => Promise.resolve(null)),
}))
jest.mock("@/lib/accounting/resolveAccountingRequestAuthority", () => {
  const actual = jest.requireActual(
    "@/lib/accounting/resolveAccountingRequestAuthority"
  )
  return {
    ...actual,
    resolveAccountingRequestAuthority: jest.fn(),
  }
})

function setupSupabase(rpcResult: { data?: unknown; error?: unknown }) {
  const rpc = jest.fn(() => Promise.resolve(rpcResult))
  const mockSupabase = {
    auth: {
      getUser: jest.fn(() =>
        Promise.resolve({ data: { user: { id: "user-1" } }, error: null })
      ),
    },
    rpc,
  }
  const { createSupabaseServerClient } = require("@/lib/supabaseServer")
  ;(createSupabaseServerClient as jest.Mock).mockReturnValue(mockSupabase)
  return { rpc }
}

function request(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/wht", {
    method: "POST",
    body: JSON.stringify({
      business_id: "biz-1",
      bill_ids: ["bill-1", "bill-2"],
      remittance_date: "2026-03-15",
      reference: "GRA-REF-1",
      notes: "March remittance",
      payment_account: "1010",
      ...body,
    }),
    headers: { "Content-Type": "application/json" },
  })
}

describe("POST /api/wht - atomic remittance", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(resolveAccountingRequestAuthority as jest.Mock).mockResolvedValue({
      ok: true,
    })
  })

  it("calls the atomic remittance RPC with the selected bills", async () => {
    const { rpc } = setupSupabase({
      data: {
        reused: false,
        remittance_id: "rem-1",
        journal_entry_id: "je-1",
        amount: 125.5,
        reference: "GRA-REF-1",
      },
      error: null,
    })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.total_remitted).toBe(125.5)
    expect(rpc).toHaveBeenCalledWith("create_wht_remittance_atomic", {
      p_business_id: "biz-1",
      p_bill_ids: ["bill-1", "bill-2"],
      p_remittance_date: "2026-03-15",
      p_reference: "GRA-REF-1",
      p_notes: "March remittance",
      p_payment_account_code: "1010",
    })
  })

  it("does not create a second audit entry for an idempotent retry", async () => {
    setupSupabase({
      data: {
        reused: true,
        remittance_id: "rem-1",
        journal_entry_id: "je-1",
        amount: 125.5,
      },
      error: null,
    })

    const response = await POST(request())
    const body = await response.json()
    const { createAuditLog } = require("@/lib/auditLog")

    expect(response.status).toBe(200)
    expect(body.reused).toBe(true)
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it("returns 409 when the bills were already remitted", async () => {
    setupSupabase({
      data: null,
      error: {
        message:
          "WHT_REMITTANCE_ALREADY_REMITTED: The selected bills have already been remitted.",
      },
    })

    const response = await POST(request())
    expect(response.status).toBe(409)
  })

  it("returns 403 when accounting authority is missing", async () => {
    setupSupabase({
      data: null,
      error: {
        message:
          "WHT_REMITTANCE_NOT_AUTHORIZED: Accounting authority is required to remit withholding tax.",
      },
    })

    const response = await POST(request())
    expect(response.status).toBe(403)
  })

  it("returns 400 for a draft or ineligible source bill", async () => {
    setupSupabase({
      data: null,
      error: {
        message:
          "WHT_REMITTANCE_BILL_NOT_POSTED: Draft bills cannot be remitted. Post the bill first.",
      },
    })

    const response = await POST(request())
    expect(response.status).toBe(400)
  })

  it("fails closed when the RPC does not return a linked journal", async () => {
    setupSupabase({
      data: {
        reused: false,
        remittance_id: "rem-1",
        journal_entry_id: null,
        amount: 125.5,
      },
      error: null,
    })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.success).toBe(false)
  })

  it("requires business, bills, and remittance date", async () => {
    setupSupabase({ data: null, error: null })

    const response = await POST(request({ bill_ids: [] }))
    expect(response.status).toBe(400)
  })

  it("rejects read-only replay before calling the remittance RPC", async () => {
    const { rpc } = setupSupabase({
      data: {
        reused: true,
        remittance_id: "rem-1",
        journal_entry_id: "je-1",
        amount: 125.5,
      },
      error: null,
    })
    ;(resolveAccountingRequestAuthority as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
      reasonCode: "INSUFFICIENT_AUTHORITY",
    })

    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("rejects unauthorized staff replay before calling the remittance RPC", async () => {
    const { rpc } = setupSupabase({
      data: {
        reused: true,
        remittance_id: "rem-1",
        journal_entry_id: "je-1",
        amount: 125.5,
      },
      error: null,
    })
    ;(resolveAccountingRequestAuthority as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
      reasonCode: "INSUFFICIENT_AUTHORITY",
    })

    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
})
