/**
 * Jest coverage for invoice material fulfil/return API error mapping + route shape.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { mapInvoiceMaterialFulfilRpcError } from "@/lib/invoices/invoiceMaterialFulfilmentErrors"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))
jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))
jest.mock("@/lib/auditLog", () => ({
  logAudit: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTier: jest.fn(() => Promise.resolve(null)),
}))
jest.mock("@/lib/server/fireAfterAccountingPost", () => ({
  fireAfterAccountingPost: jest.fn(),
}))
jest.mock("@vercel/functions", () => ({
  waitUntil: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { POST as fulfilPost } from "../[id]/fulfil-materials/route"
import { POST as returnPost } from "../[id]/return-materials/route"

const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const INVOICE_ID = "iiiiiiii-iiii-4iii-8iii-iiiiiiiiiiii"
const ITEM_ID = "llllllll-llll-4lll-8lll-llllllllllll"
const FULFIL_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff"

describe("mapInvoiceMaterialFulfilRpcError", () => {
  it("maps insufficient stock", () => {
    const mapped = mapInvoiceMaterialFulfilRpcError(
      'INSUFFICIENT_STOCK: material "Paint" — requested 2, remaining unfulfilled 2, available stock 1'
    )
    expect(mapped.status).toBe(400)
    expect(mapped.code).toBe("INSUFFICIENT_STOCK")
  })

  it("maps draft invoice", () => {
    const mapped = mapInvoiceMaterialFulfilRpcError(
      "INVOICE_NOT_ISSUED: fulfil materials only after the invoice is issued"
    )
    expect(mapped.status).toBe(400)
    expect(mapped.code).toBe("INVOICE_NOT_ISSUED")
  })

  it("maps job usage no fulfil", () => {
    const mapped = mapInvoiceMaterialFulfilRpcError(
      "JOB_USAGE_NO_FULFIL: job-sourced material lines cannot be fulfilled from stock"
    )
    expect(mapped.code).toBe("JOB_USAGE_NO_FULFIL")
  })
})

describe("POST fulfil-materials", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getUserRole).mockResolvedValue("owner" as never)
    jest.mocked(resolveBusinessScopeForUser).mockResolvedValue({
      ok: true,
      businessId: BUSINESS_ID,
    } as never)
  })

  it("calls fulfil RPC and returns result", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        fulfilment_id: FULFIL_ID,
        invoice_item_id: ITEM_ID,
        invoice_id: INVOICE_ID,
        material_id: "m1",
        quantity: 1,
        unit_cost: 100,
        total_cost: 100,
        movement_id: "mov1",
        journal_entry_id: "je1",
        status: "active",
        idempotent: false,
      },
      error: null,
    })

    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
      },
      from: jest.fn((table: string) => {
        if (table === "invoices") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: INVOICE_ID, business_id: BUSINESS_ID, status: "sent", deleted_at: null },
              error: null,
            }),
          }
        }
        return {}
      }),
      rpc,
    } as never)

    const req = new NextRequest(`http://localhost/api/invoices/${INVOICE_ID}/fulfil-materials`, {
      method: "POST",
      body: JSON.stringify({
        invoice_item_id: ITEM_ID,
        quantity: 1,
        idempotency_key: "key-1",
      }),
    })

    const res = await fulfilPost(req, { params: Promise.resolve({ id: INVOICE_ID }) })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(
      "fulfil_invoice_material_line",
      expect.objectContaining({
        p_invoice_item_id: ITEM_ID,
        p_quantity: 1,
        p_idempotency_key: "key-1",
      })
    )
  })

  it("blocks draft via RPC error mapping", async () => {
    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
      },
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: INVOICE_ID, business_id: BUSINESS_ID, status: "draft", deleted_at: null },
          error: null,
        }),
      })),
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "INVOICE_NOT_ISSUED: fulfil materials only after the invoice is issued" },
      }),
    } as never)

    const req = new NextRequest(`http://localhost/api/invoices/${INVOICE_ID}/fulfil-materials`, {
      method: "POST",
      body: JSON.stringify({ invoice_item_id: ITEM_ID, quantity: 1, idempotency_key: "k" }),
    })
    const res = await fulfilPost(req, { params: Promise.resolve({ id: INVOICE_ID }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("INVOICE_NOT_ISSUED")
  })
})

describe("POST return-materials", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getUserRole).mockResolvedValue("owner" as never)
    jest.mocked(resolveBusinessScopeForUser).mockResolvedValue({
      ok: true,
      businessId: BUSINESS_ID,
    } as never)
  })

  it("calls return RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        return_id: "r1",
        fulfilment_id: FULFIL_ID,
        quantity: 1,
        unit_cost: 100,
        total_cost: 100,
        movement_id: "mov2",
        journal_entry_id: "je2",
        idempotent: false,
      },
      error: null,
    })

    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
      },
      from: jest.fn((table: string) => {
        if (table === "invoices") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: INVOICE_ID, business_id: BUSINESS_ID, deleted_at: null },
              error: null,
            }),
          }
        }
        if (table === "invoice_material_fulfilments") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: FULFIL_ID, invoice_id: INVOICE_ID, business_id: BUSINESS_ID },
              error: null,
            }),
          }
        }
        return {}
      }),
      rpc,
    } as never)

    const req = new NextRequest(`http://localhost/api/invoices/${INVOICE_ID}/return-materials`, {
      method: "POST",
      body: JSON.stringify({
        fulfilment_id: FULFIL_ID,
        quantity: 1,
        idempotency_key: "ret-1",
      }),
    })
    const res = await returnPost(req, { params: Promise.resolve({ id: INVOICE_ID }) })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(
      "return_invoice_material_fulfilment",
      expect.objectContaining({ p_fulfilment_id: FULFIL_ID, p_quantity: 1 })
    )
  })
})
