/**
 * Selected-business access for Service supplier bills.
 *
 * A user can own/access more than one business. The server cannot read the
 * client's selected-workspace preference, so bill routes must authorize against
 * the bill/submitted business, not the server-resolved default business.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest, NextResponse } from "next/server"

jest.mock("@vercel/functions", () => ({
  waitUntil: jest.fn((p: Promise<unknown>) => p),
}))
jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
}))
jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/server/fireAfterAccountingPost", () => ({
  fireAfterAccountingPost: jest.fn(),
}))
jest.mock("@/lib/documents/incomingDocumentsService", () => ({
  getIncomingDocumentForBusiness: jest.fn(),
  linkIncomingDocumentToEntity: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTierWrite: jest.fn(() => Promise.resolve(null)),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceWorkspaceAccess", () => ({
  enforceServiceWorkspaceAccess: jest.fn(),
  enforceServiceWorkspaceWriteAccess: jest.fn(),
}))

import { POST } from "../create/route"
import { GET, PUT, DELETE } from "../[id]/route"
import { GET as GET_PAYMENTS } from "../[id]/payments/route"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import {
  enforceServiceWorkspaceAccess,
  enforceServiceWorkspaceWriteAccess,
} from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

const USER_ID = "user-1111-1111-1111-111111111111"
const DEFAULT_BIZ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const SELECTED_BIZ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const UNRELATED_BIZ = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const SELECTED_BILL = "b1111111-1111-4111-8111-111111111111"
const UNRELATED_BILL = "b2222222-2222-4222-8222-222222222222"
const MISSING_BILL = "b3333333-3333-4333-8333-333333333333"

type BillRow = {
  id: string
  business_id: string
  supplier_id: string | null
  supplier_name: string
  supplier_phone: string | null
  supplier_email: string | null
  bill_number: string
  issue_date: string
  status: string
  total: number
  currency_code: string | null
  fx_rate: number | null
  deleted_at: string | null
  [key: string]: unknown
}

type State = {
  bills: Map<string, BillRow>
  billItems: Array<Record<string, unknown>>
  payments: Array<Record<string, unknown>>
  inserted: Array<Record<string, unknown>>
  updates: Array<{ payload: Record<string, unknown>; filters: Record<string, unknown> }>
}

let state: State

function makeBill(
  id: string,
  businessId: string,
  overrides: Partial<BillRow> = {}
): BillRow {
  return {
    id,
    business_id: businessId,
    supplier_id: null,
    supplier_name: "Selected Supplier",
    supplier_phone: null,
    supplier_email: null,
    bill_number: `BILL-${id.slice(0, 4)}`,
    issue_date: "2026-10-20",
    status: "draft",
    total: 100,
    currency_code: null,
    fx_rate: null,
    deleted_at: null,
    ...overrides,
  }
}

function denied() {
  return NextResponse.json(
    { error: "Forbidden: no access to this business" },
    { status: 403 }
  )
}

function selectBuilder(resolve: () => Promise<{ data: unknown; error: unknown }>) {
  const q: Record<string, any> = {}
  q.select = jest.fn(() => q)
  q.eq = jest.fn(() => q)
  q.is = jest.fn(() => q)
  q.order = jest.fn(() => q)
  q.limit = jest.fn(() => q)
  q.single = jest.fn(resolve)
  q.maybeSingle = jest.fn(resolve)
  q.then = (onFulfilled: unknown, onRejected: unknown) =>
    resolve().then(
      onFulfilled as (value: unknown) => unknown,
      onRejected as (reason: unknown) => unknown
    )
  return q
}

function billSelect() {
  const filters: Record<string, unknown> = {}
  const q = selectBuilder(async () => {
    let row: BillRow | undefined
    if (typeof filters.id === "string") row = state.bills.get(filters.id)
    else row = [...state.bills.values()][0]

    if (row && filters.business_id && row.business_id !== filters.business_id) {
      row = undefined
    }
    if (row && filters["is:deleted_at"] === null && row.deleted_at) {
      row = undefined
    }
    return row ? { data: row, error: null } : { data: null, error: { code: "PGRST116" } }
  })
  q.eq = jest.fn((column: string, value: unknown) => {
    filters[column] = value
    return q
  })
  q.is = jest.fn((column: string, value: unknown) => {
    filters[`is:${column}`] = value
    return q
  })
  return q
}

function billUpdate(payload: Record<string, unknown>) {
  const filters: Record<string, unknown> = {}
  const q: Record<string, any> = {}
  const resolve = async () => {
    const id = filters.id
    const row = typeof id === "string" ? state.bills.get(id) : undefined
    if (!row) return { data: null, error: { code: "PGRST116" } }
    if (filters.business_id && row.business_id !== filters.business_id) {
      return { data: null, error: { code: "PGRST116" } }
    }
    const updated = { ...row, ...payload }
    state.bills.set(row.id, updated)
    state.updates.push({ payload, filters: { ...filters } })
    return { data: updated, error: null }
  }
  q.eq = jest.fn((column: string, value: unknown) => {
    filters[column] = value
    return q
  })
  q.select = jest.fn(() => q)
  q.single = jest.fn(resolve)
  q.maybeSingle = jest.fn(resolve)
  q.then = (onFulfilled: unknown, onRejected: unknown) =>
    resolve().then(
      onFulfilled as (value: unknown) => unknown,
      onRejected as (reason: unknown) => unknown
    )
  return q
}

function makeSupabase() {
  return {
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      })),
    },
    from: jest.fn((table: string) => {
      if (table === "bills") {
        return {
          select: jest.fn(() => billSelect()),
          insert: jest.fn((row: Record<string, unknown>) => {
            const bill = {
              ...makeBill(SELECTED_BILL, String(row.business_id)),
              ...row,
              id: SELECTED_BILL,
            } as BillRow
            state.bills.set(bill.id, bill)
            state.inserted.push(bill)
            return {
              select: jest.fn(() => ({
                single: jest.fn(async () => ({ data: bill, error: null })),
              })),
            }
          }),
          update: jest.fn((payload: Record<string, unknown>) => billUpdate(payload)),
          delete: jest.fn(() => ({
            eq: jest.fn(async () => ({ error: null })),
          })),
        }
      }

      if (table === "bill_items") {
        return {
          select: jest.fn(() =>
            selectBuilder(async () => ({
              data: state.billItems.filter(
                (item) => item.bill_id === SELECTED_BILL
              ),
              error: null,
            }))
          ),
          insert: jest.fn(async (rows: Array<Record<string, unknown>>) => {
            state.billItems.push(...rows)
            return { error: null }
          }),
          delete: jest.fn(() => {
            const deleteQuery: Record<string, any> = {}
            deleteQuery.eq = jest.fn(async () => {
              state.billItems = []
              return { error: null }
            })
            return deleteQuery
          }),
        }
      }

      if (table === "bill_payments") {
        return {
          select: jest.fn(() => {
            const filters: Record<string, unknown> = {}
            const q = selectBuilder(async () => {
              return {
                data: state.payments.filter((payment) => {
                  if (filters.bill_id && payment.bill_id !== filters.bill_id) return false
                  if (
                    filters.business_id &&
                    payment.business_id !== filters.business_id
                  ) {
                    return false
                  }
                  if (filters["is:deleted_at"] === null && payment.deleted_at) {
                    return false
                  }
                  return true
                }),
                error: null,
              }
            })
            q.eq = jest.fn((column: string, value: unknown) => {
              filters[column] = value
              return q
            })
            q.is = jest.fn((column: string, value: unknown) => {
              filters[`is:${column}`] = value
              return q
            })
            return q
          }),
        }
      }

      if (table === "businesses") {
        return {
          select: jest.fn(() =>
            selectBuilder(async () => ({
              data: { default_currency: "GHS" },
              error: null,
            }))
          ),
        }
      }

      return {
        select: jest.fn(() =>
          selectBuilder(async () => ({ data: null, error: null }))
        ),
      }
    }),
  }
}

function createRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/bills/create", {
    method: "POST",
    body: JSON.stringify({
      business_id: SELECTED_BIZ,
      supplier_name: "Selected Supplier",
      bill_number: "BILL-SELECTED-1",
      issue_date: "2026-10-20",
      apply_taxes: false,
      status: "open",
      items: [{ description: "Service", qty: 1, unit_price: 100, discount_amount: 0 }],
      ...body,
    }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()

  state = {
    bills: new Map([
      [
        SELECTED_BILL,
        makeBill(SELECTED_BILL, SELECTED_BIZ, { status: "draft" }),
      ],
      [
        UNRELATED_BILL,
        makeBill(UNRELATED_BILL, UNRELATED_BIZ, { status: "draft" }),
      ],
    ]),
    billItems: [
      {
        id: "item-1",
        bill_id: SELECTED_BILL,
        description: "Service",
        qty: 1,
        unit_price: 100,
      },
    ],
    payments: [
      {
        id: "payment-1",
        bill_id: SELECTED_BILL,
        business_id: SELECTED_BIZ,
        amount: 25,
        date: "2026-10-21",
        deleted_at: null,
      },
    ],
    inserted: [],
    updates: [],
  }

  ;(getCurrentBusiness as jest.Mock).mockResolvedValue({
    id: DEFAULT_BIZ,
    industry: "service",
  })
  ;(getUserRole as jest.Mock).mockImplementation(async (_supabase, _userId, businessId) =>
    businessId === SELECTED_BIZ ? "owner" : null
  )
  ;(enforceServiceIndustryMinTierWrite as jest.Mock).mockResolvedValue(null)
  ;(enforceServiceWorkspaceAccess as jest.Mock).mockImplementation(
    async ({ businessId }: { businessId: string }) =>
      businessId === DEFAULT_BIZ || businessId === SELECTED_BIZ ? null : denied()
  )
  ;(enforceServiceWorkspaceWriteAccess as jest.Mock).mockImplementation(
    async ({ businessId }: { businessId: string }) =>
      businessId === DEFAULT_BIZ || businessId === SELECTED_BIZ ? null : denied()
  )
  ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
})

describe("selected non-default Service business", () => {
  it("creates and opens a bill for the submitted business, not the server default", async () => {
    const res = await POST(createRequest({}))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.bill.business_id).toBe(SELECTED_BIZ)
    expect(body.bill.status).toBe("open")
    expect(state.inserted[0]?.business_id).toBe(SELECTED_BIZ)
    expect(getUserRole).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      SELECTED_BIZ
    )
    expect(enforceServiceIndustryMinTierWrite).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      SELECTED_BIZ,
      "professional"
    )
    expect(getCurrentBusiness).not.toHaveBeenCalled()
  })

  it("opens the direct bill link and refreshes it for the selected business", async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await GET(
        new NextRequest(`http://localhost/api/bills/${SELECTED_BILL}`),
        { params: { id: SELECTED_BILL } }
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.bill.id).toBe(SELECTED_BILL)
      expect(body.bill.business_id).toBe(SELECTED_BIZ)
    }

    expect(enforceServiceWorkspaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        businessId: SELECTED_BIZ,
        minTier: "professional",
      })
    )
    expect(getCurrentBusiness).not.toHaveBeenCalled()
  })

  it("updates a selected-business bill using the bill's actual business", async () => {
    const res = await PUT(
      new NextRequest(`http://localhost/api/bills/${SELECTED_BILL}`, {
        method: "PUT",
        body: JSON.stringify({ notes: "Updated from selected workspace" }),
      }),
      { params: { id: SELECTED_BILL } }
    )

    expect(res.status).toBe(200)
    expect(enforceServiceWorkspaceWriteAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        businessId: SELECTED_BIZ,
        minTier: "professional",
      })
    )
    expect(state.updates.some((u) => u.payload.notes === "Updated from selected workspace")).toBe(
      true
    )
    expect(getCurrentBusiness).not.toHaveBeenCalled()
  })

  it("deletes a draft selected-business bill using the bill's actual business", async () => {
    const res = await DELETE(
      new NextRequest(`http://localhost/api/bills/${SELECTED_BILL}`, {
        method: "DELETE",
      }),
      { params: { id: SELECTED_BILL } }
    )

    expect(res.status).toBe(200)
    expect(enforceServiceWorkspaceWriteAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        businessId: SELECTED_BIZ,
        minTier: "professional",
      })
    )
    expect(state.bills.get(SELECTED_BILL)?.deleted_at).toBeTruthy()
    expect(getCurrentBusiness).not.toHaveBeenCalled()
  })

  it("lists payments for a selected-business bill", async () => {
    const res = await GET_PAYMENTS(
      new NextRequest(`http://localhost/api/bills/${SELECTED_BILL}/payments`),
      { params: { id: SELECTED_BILL } }
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payments).toHaveLength(1)
    expect(body.payments[0].bill_id).toBe(SELECTED_BILL)
    expect(enforceServiceWorkspaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        businessId: SELECTED_BIZ,
        minTier: "professional",
      })
    )
    expect(getCurrentBusiness).not.toHaveBeenCalled()
  })
})

describe("cross-tenant and missing-bill behavior", () => {
  it("denies creating a bill for an unrelated business", async () => {
    const res = await POST(createRequest({ business_id: UNRELATED_BIZ }))

    expect(res.status).toBe(403)
    expect(state.inserted).toHaveLength(0)
  })

  it("denies direct access to an unrelated business bill", async () => {
    const getRes = await GET(
      new NextRequest(`http://localhost/api/bills/${UNRELATED_BILL}`),
      { params: { id: UNRELATED_BILL } }
    )
    expect(getRes.status).toBe(403)

    const paymentsRes = await GET_PAYMENTS(
      new NextRequest(`http://localhost/api/bills/${UNRELATED_BILL}/payments`),
      { params: { id: UNRELATED_BILL } }
    )
    expect(paymentsRes.status).toBe(403)
  })

  it("returns 404 for a missing bill across detail, edit, delete and payments", async () => {
    const getRes = await GET(
      new NextRequest(`http://localhost/api/bills/${MISSING_BILL}`),
      { params: { id: MISSING_BILL } }
    )
    expect(getRes.status).toBe(404)

    const putRes = await PUT(
      new NextRequest(`http://localhost/api/bills/${MISSING_BILL}`, {
        method: "PUT",
        body: JSON.stringify({ notes: "missing" }),
      }),
      { params: { id: MISSING_BILL } }
    )
    expect(putRes.status).toBe(404)

    const deleteRes = await DELETE(
      new NextRequest(`http://localhost/api/bills/${MISSING_BILL}`, {
        method: "DELETE",
      }),
      { params: { id: MISSING_BILL } }
    )
    expect(deleteRes.status).toBe(404)

    const paymentsRes = await GET_PAYMENTS(
      new NextRequest(`http://localhost/api/bills/${MISSING_BILL}/payments`),
      { params: { id: MISSING_BILL } }
    )
    expect(paymentsRes.status).toBe(404)
  })
})

