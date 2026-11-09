import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite", () => ({
  enforceServiceIndustryFinancialWrite: jest.fn(() => Promise.resolve(null)),
}))
jest.mock("@/lib/proposals/createDraftInvoiceFromProposal", () => ({
  createDraftInvoiceFromProposal: jest.fn(),
}))

import { POST } from "../route"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { createDraftInvoiceFromProposal } from "@/lib/proposals/createDraftInvoiceFromProposal"

const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const PROPOSAL_ID = "pppppppp-pppp-4ppp-8ppp-pppppppppppp"

let proposalRow: Record<string, unknown> | null

function request(): NextRequest {
  return new NextRequest(`http://localhost/api/proposals/${PROPOSAL_ID}/convert-invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ business_id: BUSINESS_ID }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  proposalRow = {
    id: PROPOSAL_ID,
    business_id: BUSINESS_ID,
    customer_id: null,
    title: "Cleaning proposal",
    proposal_number: "PROP-001",
    status: "accepted",
    pricing_mode: "line_items",
    pricing_payload: {
      items: [{ description: "Monthly cleaning", quantity: 6, unit_price: 4500 }],
    },
    currency_code: "GHS",
    converted_estimate_id: null,
    converted_invoice_id: null,
    deleted_at: null,
  }

  const query = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    is: jest.fn(() => query),
    maybeSingle: jest.fn(async () => ({ data: proposalRow, error: null })),
  }
  jest.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } } })) },
    from: jest.fn(() => query),
  } as never)
  jest.mocked(resolveBusinessScopeForUser).mockResolvedValue({
    ok: true,
    businessId: BUSINESS_ID,
  } as never)
  jest.mocked(createDraftInvoiceFromProposal).mockResolvedValue({
    ok: true,
    invoiceId: "iiiiiiii-iiii-4iii-8iii-iiiiiiiiiiii",
    invoice: {},
  } as never)
})

describe("POST /api/proposals/[id]/convert-invoice", () => {
  it("rejects unauthenticated requests", async () => {
    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: jest.fn(async () => ({ data: { user: null } })) },
    } as never)
    const response = await POST(request(), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(401)
  })

  it("rejects cross-tenant scope before loading the proposal", async () => {
    jest.mocked(resolveBusinessScopeForUser).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    } as never)
    const response = await POST(request(), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(403)
    expect(createDraftInvoiceFromProposal).not.toHaveBeenCalled()
  })

  it("returns 404 when the proposal is not in the tenant", async () => {
    proposalRow = null
    const response = await POST(request(), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(404)
    expect(createDraftInvoiceFromProposal).not.toHaveBeenCalled()
  })

  it("returns 409 for an existing linked invoice", async () => {
    proposalRow = {
      ...proposalRow,
      status: "converted",
      converted_invoice_id: "iiiiiiii-iiii-4iii-8iii-iiiiiiiiiiii",
    }
    const response = await POST(request(), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    const body = (await response.json()) as { converted_invoice_id: string }
    expect(response.status).toBe(409)
    expect(body.converted_invoice_id).toBe("iiiiiiii-iiii-4iii-8iii-iiiiiiiiiiii")
    expect(createDraftInvoiceFromProposal).not.toHaveBeenCalled()
  })

  it("returns 409 when the proposal was already converted to an estimate", async () => {
    proposalRow = {
      ...proposalRow,
      status: "converted",
      converted_estimate_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    }
    const response = await POST(request(), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(409)
    expect(createDraftInvoiceFromProposal).not.toHaveBeenCalled()
  })

  it("creates a draft invoice from an accepted proposal", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    const body = (await response.json()) as { success: boolean; invoice_id: string; invoice_number: null }
    expect(response.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.invoice_id).toBe("iiiiiiii-iiii-4iii-8iii-iiiiiiiiiiii")
    expect(body.invoice_number).toBeNull()
    expect(createDraftInvoiceFromProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BUSINESS_ID,
        proposal: expect.objectContaining({ id: PROPOSAL_ID, status: "accepted" }),
      })
    )
  })

  it("passes a provided FX rate to the invoice helper", async () => {
    const req = new NextRequest(`http://localhost/api/proposals/${PROPOSAL_ID}/convert-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: BUSINESS_ID, fx_rate: 12.5 }),
    })
    await POST(req, { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(createDraftInvoiceFromProposal).toHaveBeenCalledWith(
      expect.objectContaining({ fxRate: 12.5 })
    )
  })

  it("maps helper validation failures without issuing an invoice", async () => {
    jest.mocked(createDraftInvoiceFromProposal).mockResolvedValue({
      ok: false,
      status: 400,
      error: "Only accepted proposals can be converted to an invoice.",
    } as never)
    const response = await POST(request(), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(400)
  })
})
