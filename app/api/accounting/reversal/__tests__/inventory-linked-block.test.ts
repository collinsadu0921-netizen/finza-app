/**
 * POST /api/accounting/reversal — inventory-linked fulfilment journals blocked.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/accounting/auth", () => ({
  checkAccountingAuthority: jest.fn(),
}))
jest.mock("@/lib/accounting/permissions", () => ({
  assertAccountingAccess: jest.fn(),
  accountingUserFromRequest: jest.fn(() => ({ id: "u1" })),
}))
jest.mock("@/lib/accounting/resolveAccountingContext", () => ({
  resolveAccountingContext: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi", () => ({
  enforceServiceIndustryBusinessTierForAccountingApi: jest.fn(() => Promise.resolve(null)),
}))
jest.mock("@/lib/auditLog", () => ({
  logAudit: jest.fn(() => Promise.resolve()),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { POST } from "../route"

const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const JE_ID = "jjjjjjjj-jjjj-4jjj-8jjj-jjjjjjjjjjjj"

describe("POST /api/accounting/reversal — inventory guard", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(checkAccountingAuthority).mockResolvedValue({ authorized: true } as never)
    jest.mocked(resolveAccountingContext).mockResolvedValue({ businessId: BUSINESS_ID } as never)
  })

  it("rejects invoice_material_fulfilment with domain code", async () => {
    const rpc = jest.fn()
    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
      },
      from: jest.fn((table: string) => {
        if (table === "journal_entries") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: {
                id: JE_ID,
                business_id: BUSINESS_ID,
                date: "2099-08-15",
                description: "Invoice material fulfilment",
                period_id: "p1",
                reference_type: "invoice_material_fulfilment",
                reference_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
              },
              error: null,
            }),
            limit: jest.fn().mockReturnThis(),
          }
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        }
      }),
      rpc,
    } as never)

    const req = new NextRequest("http://localhost/api/accounting/reversal", {
      method: "POST",
      body: JSON.stringify({
        original_je_id: JE_ID,
        reason: "Need to reverse this fulfilment entry",
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe("INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW")
    expect(rpc).not.toHaveBeenCalled()
  })

  it("rejects invoice_material_fulfilment_return", async () => {
    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
      },
      from: jest.fn((table: string) => {
        if (table === "journal_entries") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: {
                id: JE_ID,
                business_id: BUSINESS_ID,
                date: "2099-08-15",
                description: "Return",
                period_id: "p1",
                reference_type: "invoice_material_fulfilment_return",
                reference_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
              },
              error: null,
            }),
            limit: jest.fn().mockReturnThis(),
          }
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        }
      }),
      rpc: jest.fn(),
    } as never)

    const req = new NextRequest("http://localhost/api/accounting/reversal", {
      method: "POST",
      body: JSON.stringify({
        original_je_id: JE_ID,
        reason: "Need to reverse this return entry",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe("INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW")
  })

  it("rejects invoice_material_fulfilment_return_undo", async () => {
    const rpc = jest.fn()
    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
      },
      from: jest.fn((table: string) => {
        if (table === "journal_entries") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: {
                id: JE_ID,
                business_id: BUSINESS_ID,
                date: "2099-08-15",
                description: "Undo return",
                period_id: "p1",
                reference_type: "invoice_material_fulfilment_return_undo",
                reference_id: "rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr",
              },
              error: null,
            }),
            limit: jest.fn().mockReturnThis(),
          }
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        }
      }),
      rpc,
    } as never)

    const req = new NextRequest("http://localhost/api/accounting/reversal", {
      method: "POST",
      body: JSON.stringify({
        original_je_id: JE_ID,
        reason: "Need to reverse this undo-return entry",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe("INVENTORY_LINKED_JOURNAL_REQUIRES_SOURCE_WORKFLOW")
    expect(rpc).not.toHaveBeenCalled()
  })
})
