import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auditLog", () => ({ createAuditLog: jest.fn(async () => undefined) }))
jest.mock("@/lib/archivedBusiness", () => ({
  assertBusinessNotArchived: jest.fn(async () => undefined),
}))
jest.mock("@/lib/tax/ghanaTaxScheduleMetadata", () => ({
  fetchGhanaEvatLevyScheduleMetadataMap: jest.fn(async () => new Map()),
  enrichGhanaTaxResultWithScheduleMetadata: jest.fn((result) => result),
}))

import { createDraftInvoiceFromProposal } from "../createDraftInvoiceFromProposal"
import { createAuditLog } from "@/lib/auditLog"

const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const PROPOSAL_ID = "pppppppp-pppp-4ppp-8ppp-pppppppppppp"
const INVOICE_ID = "iiiiiiii-iiii-4iii-8iii-iiiiiiiiiiii"

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    business_id: BUSINESS_ID,
    customer_id: null,
    title: "Office cleaning proposal",
    proposal_number: "PROP-001",
    status: "accepted",
    pricing_mode: "line_items",
    pricing_payload: {
      items: [
        { description: "Monthly cleaning", quantity: 6, unit_price: 4500, discount_amount: 0 },
      ],
    },
    currency_code: "GHS",
    converted_estimate_id: null,
    converted_invoice_id: null,
    ...overrides,
  }
}

let insertedInvoice: Record<string, unknown> | null
let insertedItems: unknown[] | null
let updatedProposal: Record<string, unknown> | null
let linkSucceeds: boolean

function makeSupabase() {
  const from = jest.fn((table: string) => {
    if (table === "businesses") {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(async () => ({
              data: { address_country: "Ghana", default_currency: "GHS" },
              error: null,
            })),
          })),
        })),
      }
    }
    if (table === "invoice_settings") {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(async () => ({ data: null, error: null })),
          })),
        })),
      }
    }
    if (table === "invoices") {
      return {
        insert: jest.fn((payload: Record<string, unknown>) => {
          insertedInvoice = payload
          return {
            select: jest.fn(() => ({
              single: jest.fn(async () => ({
                data: { ...payload, id: INVOICE_ID },
                error: null,
              })),
            })),
          }
        }),
        delete: jest.fn(() => ({
          eq: jest.fn(async () => ({ error: null })),
        })),
      }
    }
    if (table === "invoice_items") {
      return {
        insert: jest.fn(async (payload: unknown[]) => {
          insertedItems = payload
          return { error: null }
        }),
      }
    }
    if (table === "proposals") {
      return {
        update: jest.fn((payload: Record<string, unknown>) => {
          updatedProposal = payload
          const chain: Record<string, jest.Mock> = {}
          chain.eq = jest.fn(() => chain)
          chain.is = jest.fn(() => chain)
          chain.select = jest.fn(async () => ({
            data: linkSucceeds ? [{ id: PROPOSAL_ID }] : [],
            error: null,
          }))
          return chain
        }),
      }
    }
    throw new Error(`Unexpected table ${table}`)
  })

  return {
    from,
    rpc: jest.fn(async () => ({ data: "public-token", error: null })),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  insertedInvoice = null
  insertedItems = null
  updatedProposal = null
  linkSucceeds = true
})

describe("createDraftInvoiceFromProposal", () => {
  it("creates an unissued draft invoice using the canonical tax engine", async () => {
    const supabase = makeSupabase()
    const result = await createDraftInvoiceFromProposal({
      supabase: supabase as never,
      userId: "user-1",
      businessId: BUSINESS_ID,
      proposal: source() as never,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.invoiceId).toBe(INVOICE_ID)
    expect(insertedInvoice).toMatchObject({
      business_id: BUSINESS_ID,
      status: "draft",
      invoice_number: null,
      source_proposal_id: PROPOSAL_ID,
      apply_taxes: true,
      currency_code: "GHS",
      tax_jurisdiction: "GH",
    })
    expect(Number(insertedInvoice?.total)).toBeGreaterThan(0)
    expect(Number(insertedInvoice?.total_tax)).toBeGreaterThan(0)
    expect(insertedItems).toHaveLength(1)
    expect(insertedItems?.[0]).toMatchObject({
      description: "Monthly cleaning",
      qty: 6,
      unit_price: 4500,
      line_subtotal: 27000,
    })
    expect(updatedProposal).toMatchObject({
      status: "converted",
      converted_invoice_id: INVOICE_ID,
    })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "proposal.converted_to_invoice" })
    )
  })

  it("returns 409 without creating anything when already linked to an invoice", async () => {
    const result = await createDraftInvoiceFromProposal({
      supabase: makeSupabase() as never,
      userId: "user-1",
      businessId: BUSINESS_ID,
      proposal: source({ converted_invoice_id: INVOICE_ID }) as never,
    })
    expect(result).toMatchObject({ ok: false, status: 409, converted_invoice_id: INVOICE_ID })
    expect(insertedInvoice).toBeNull()
  })

  it("returns 409 for proposals already linked to an estimate", async () => {
    const result = await createDraftInvoiceFromProposal({
      supabase: makeSupabase() as never,
      userId: "user-1",
      businessId: BUSINESS_ID,
      proposal: source({ converted_estimate_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }) as never,
    })
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(insertedInvoice).toBeNull()
  })

  it("requires a positive FX rate for a foreign-currency proposal", async () => {
    const result = await createDraftInvoiceFromProposal({
      supabase: makeSupabase() as never,
      userId: "user-1",
      businessId: BUSINESS_ID,
      proposal: source({ currency_code: "USD" }) as never,
    })
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(insertedInvoice).toBeNull()
  })

  it("rejects custom pricing instead of inventing invoice lines", async () => {
    const result = await createDraftInvoiceFromProposal({
      supabase: makeSupabase() as never,
      userId: "user-1",
      businessId: BUSINESS_ID,
      proposal: source({ pricing_mode: "custom", pricing_payload: { notes: "Discuss" } }) as never,
    })
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(insertedInvoice).toBeNull()
  })

  it("removes the draft invoice when proposal linking loses the race", async () => {
    linkSucceeds = false
    const result = await createDraftInvoiceFromProposal({
      supabase: makeSupabase() as never,
      userId: "user-1",
      businessId: BUSINESS_ID,
      proposal: source() as never,
    })
    expect(result).toMatchObject({ ok: false, status: 409 })
  })
})
