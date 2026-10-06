import { NextRequest } from "next/server"

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(),
}))
jest.mock("@/lib/publicDocuments/fetchPublicEstimateRowByToken", () => ({
  fetchPublicEstimateRowByToken: jest.fn(),
}))
jest.mock("@/lib/invoices/loadInvoiceSettingsForDocument", () => ({
  loadInvoiceSettingsForDocument: jest.fn().mockResolvedValue(null),
  mergeQuotePdfTerms: jest.fn(() => ({
    payment_terms: null,
    footer_message: null,
    quote_terms: null,
  })),
}))
jest.mock("@/lib/pdf/renderHtmlToPdf", () => ({
  renderHtmlToPdfBuffer: jest.fn(async (html: string) => {
    ;(global as { __quotePdfHtml?: string }).__quotePdfHtml = html
    return Buffer.from("%PDF-1.4")
  }),
}))

import { createClient } from "@supabase/supabase-js"
import { renderHtmlToPdfBuffer } from "@/lib/pdf/renderHtmlToPdf"
import { fetchPublicEstimateRowByToken } from "@/lib/publicDocuments/fetchPublicEstimateRowByToken"
import { GET as getQuote } from "../[token]/route"
import { GET as getPdf } from "../[token]/pdf/route"
import { ESTIMATE_ITEM_SELECT_CURRENT } from "@/lib/publicDocuments/fetchEstimateItems"

const DESCRIPTION =
  "Move-in cleaning of a three bedroom apartment at haatso, (living room, 2 washrooms, kitchen, corridor, terrazzo floors, tiles, )"

const estimate = {
  id: "est-1",
  business_id: "biz-1",
  customer_id: "cust-1",
  estimate_number: "QUO-0010",
  currency_code: "GHS",
  currency_symbol: "GH₵",
  issue_date: "2026-09-01",
  subtotal: 1980,
  total_tax_amount: 0,
  total_amount: 1980,
}

const legacyItem = {
  id: "line-1",
  description: DESCRIPTION,
  quantity: 1,
  price: 2200,
  discount_amount: 220,
  total: 1980,
  created_at: "2026-09-01T00:00:00Z",
}

function supabaseFor(itemSelect: (columns: string) => Promise<{ data: unknown; error: unknown }>) {
  return {
    from(table: string) {
      if (table === "estimate_items") {
        return {
          select(columns: string) {
            return { eq: () => ({ order: () => itemSelect(columns) }) }
          },
        }
      }
      if (table === "customers") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "cust-1",
                  name: "Customer",
                  email: null,
                  phone: null,
                  whatsapp_phone: null,
                  address: null,
                  tin: null,
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === "businesses") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { name: "Cleaning Co", default_currency: "GHS" }, error: null }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }
    },
  }
}

const mockCreateClient = createClient as jest.Mock
const mockFetchEstimate = fetchPublicEstimateRowByToken as jest.Mock

function pdfRequest() {
  return getPdf(new NextRequest("http://localhost/api/public/quote/tok/pdf"), {
    params: Promise.resolve({ token: "tok" }),
  })
}

beforeEach(() => {
  ;(global as { __quotePdfHtml?: string }).__quotePdfHtml = ""
  ;(renderHtmlToPdfBuffer as jest.Mock).mockClear()
  mockFetchEstimate.mockResolvedValue({ data: estimate, error: null, columnVariant: "legacy" })
})

describe("public quote line items", () => {
  it("loads the public quote without a Finza login and returns the description", async () => {
    mockCreateClient.mockReturnValue(
      supabaseFor(async (columns) => {
        if (columns === ESTIMATE_ITEM_SELECT_CURRENT) {
          return { data: null, error: { code: "42703", message: "column qty does not exist" } }
        }
        return { data: [legacyItem], error: null }
      })
    )
    const res = await getQuote(new NextRequest("http://localhost/api/public/quote/tok"), {
      params: Promise.resolve({ token: "tok" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items[0].description).toBe(DESCRIPTION)
    expect(body.items[0].quantity).toBe(1)
    expect(body.items[0].price).toBe(2200)
    expect(body.items[0].discount_amount).toBe(220)
    expect(body.items[0].total).toBe(1980)
  })

  it("puts the same description into the PDF HTML and keeps the tax-inclusive total", async () => {
    mockCreateClient.mockReturnValue(
      supabaseFor(async () => ({ data: [legacyItem], error: null }))
    )
    const res = await pdfRequest()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/pdf")
    const renderedHtml = (global as { __quotePdfHtml?: string }).__quotePdfHtml || ""
    expect(renderedHtml).toContain(DESCRIPTION)
    expect(renderedHtml).toContain("1,980.00")
  })

  it("does not return HTTP 200 PDF when the item query fails", async () => {
    mockCreateClient.mockReturnValue(
      supabaseFor(async () => ({
        data: null,
        error: { code: "08006", message: "connection failure" },
      }))
    )
    const res = await pdfRequest()
    expect(res.status).toBe(500)
    expect(res.headers.get("content-type")).toContain("application/json")
    const body = await res.json()
    expect(body.error).toBe("Unable to generate PDF")
    expect(JSON.stringify(body)).not.toContain("connection failure")
    expect(renderHtmlToPdfBuffer).not.toHaveBeenCalled()
  })

  it("still generates a PDF when the quote genuinely has zero items", async () => {
    mockCreateClient.mockReturnValue(supabaseFor(async () => ({ data: [], error: null })))
    const res = await pdfRequest()
    expect(res.status).toBe(200)
    const renderedHtml = (global as { __quotePdfHtml?: string }).__quotePdfHtml || ""
    expect(renderedHtml).toContain("Description")
    expect(renderedHtml).not.toContain(DESCRIPTION)
  })
})
