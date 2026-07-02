/**
 * PATCH /api/invoices/[id]/approval — ledger-neutral customer approval workflow.
 */

import { PATCH } from "../[id]/approval/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite", () => ({
  enforceServiceIndustryFinancialWrite: jest.fn().mockResolvedValue(null),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { createAuditLog } from "@/lib/auditLog"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockGetUserRole = getUserRole as jest.MockedFunction<typeof getUserRole>
const mockAudit = createAuditLog as jest.MockedFunction<typeof createAuditLog>

const INVOICE_ID = "inv-001"
const BUSINESS_A = "biz-a"
const USER_ID = "user-001"

const BEFORE = {
  id: INVOICE_ID,
  business_id: BUSINESS_A,
  status: "sent",
  invoice_number: "INV-001",
  customer_approval_status: "not_requested",
  customer_approval_requested_at: null,
  customer_approved_at: null,
  customer_rejected_at: null,
  customer_approval_note: null,
  customer_approval_method: null,
  customer_approval_requested_by: null,
  customer_approval_updated_by: null,
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/invoices/${INVOICE_ID}/approval`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makeParams() {
  return { params: Promise.resolve({ id: INVOICE_ID }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetUserRole.mockResolvedValue("owner" as any)
})

describe("PATCH /api/invoices/[id]/approval", () => {
  it("marks invoice approved without changing financial status", async () => {
    let updatePayload: Record<string, unknown> | null = null
    const from = jest.fn((table: string) => {
      if (table === "invoices") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { id: INVOICE_ID, business_id: BUSINESS_A, deleted_at: null, status: "sent" },
            error: null,
          }),
          single: jest.fn().mockImplementation(() => {
            if (updatePayload) {
              return Promise.resolve({
                data: { ...BEFORE, ...updatePayload, status: "sent" },
                error: null,
              })
            }
            return Promise.resolve({ data: BEFORE, error: null })
          }),
          update: jest.fn().mockImplementation((payload: Record<string, unknown>) => {
            updatePayload = payload
            return {
              eq: jest.fn().mockReturnThis(),
              is: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({
                data: {
                  ...BEFORE,
                  ...payload,
                  status: "sent",
                  customer_approval_status: "approved",
                },
                error: null,
              }),
            }
          }),
        }
      }
      return { select: jest.fn().mockReturnThis() }
    })

    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from,
    } as any)

    const res = await PATCH(makeRequest({ action: "approve", note: "Customer confirmed" }), makeParams())
    expect(res.status).toBe(200)

    expect(updatePayload).toMatchObject({
      customer_approval_status: "approved",
      customer_approval_updated_by: USER_ID,
    })
    expect(updatePayload).not.toHaveProperty("status")
    expect(updatePayload).not.toHaveProperty("total")

    const body = await res.json()
    expect(body.financialStatusUnchanged).toBe(true)
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "invoice.approved_by_customer",
        entityType: "invoice",
        entityId: INVOICE_ID,
      })
    )
  })

  it("returns 404 when user has no role on invoice business", async () => {
    mockGetUserRole.mockResolvedValue(null)
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: INVOICE_ID, business_id: BUSINESS_A, deleted_at: null, status: "sent" },
          error: null,
        }),
      })),
    } as any)

    const res = await PATCH(makeRequest({ action: "approve" }), makeParams())
    expect(res.status).toBe(404)
  })

  it("does not insert payments or journal entries", async () => {
    const rpc = jest.fn()
    const from = jest.fn((table: string) => {
      if (table === "invoices") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { id: INVOICE_ID, business_id: BUSINESS_A, deleted_at: null, status: "sent" },
            error: null,
          }),
          single: jest.fn().mockResolvedValue({ data: BEFORE, error: null }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { ...BEFORE, customer_approval_status: "rejected", status: "sent" },
              error: null,
            }),
          }),
        }
      }
      return { select: jest.fn().mockReturnThis(), insert: jest.fn() }
    })

    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from,
      rpc,
    } as any)

    const res = await PATCH(makeRequest({ action: "reject", note: "Declined" }), makeParams())
    expect(res.status).toBe(200)
    expect(from).not.toHaveBeenCalledWith("payments")
    expect(from).not.toHaveBeenCalledWith("journal_entries")
    expect(rpc).not.toHaveBeenCalled()
  })
})
