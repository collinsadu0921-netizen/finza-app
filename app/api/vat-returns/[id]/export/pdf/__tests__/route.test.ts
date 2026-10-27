import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceWorkspaceAccess", () => ({
  enforceServiceWorkspaceAccess: jest.fn(() => Promise.resolve(null)),
}))

import { GET } from "../route"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

const pdfParse = require("pdf-parse")

const VAT_RETURN_ID = "11111111-1111-4111-8111-111111111111"

function filing(overrides: Record<string, unknown> = {}) {
  return {
    id: VAT_RETURN_ID,
    business_id: "22222222-2222-4222-8222-222222222222",
    period_start_date: "2026-10-01",
    period_end_date: "2026-10-31",
    status: "paid",
    total_taxable_sales: 1015.83,
    total_output_nhil: 25.4,
    total_output_getfund: 25.4,
    total_output_covid: 0,
    total_output_vat: 152.37,
    total_output_tax: 203.17,
    total_taxable_purchases: 0,
    total_input_nhil: 0,
    total_input_getfund: 0,
    total_input_covid: 0,
    total_input_vat: 0,
    total_input_tax: 0,
    net_vat_payable: 203.17,
    net_vat_refund: 0,
    output_adjustment: 0,
    input_adjustment: 0,
    adjustment_reason: null,
    payment_journal_entry_id: "33333333-3333-4333-8333-333333333333",
    payment_date: "2026-10-27",
    payment_reference: "GRA-PAY-1",
    payment_account_id: null,
    payment_posted_at: null,
    payment_amount: 203.17,
    ...overrides,
  }
}

function mockSupabase(row: ReturnType<typeof filing>) {
  ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
    },
    from: jest.fn((table: string) => {
      if (table === "vat_returns") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              is: jest.fn(() => ({
                maybeSingle: jest.fn(async () => ({ data: row, error: null })),
              })),
            })),
          })),
        }
      }
      if (table === "businesses") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(async () => ({
                data: {
                  name: "Finza VAT E2E Business",
                  tax_id: "C0001234567",
                  address_country: "Ghana",
                },
                error: null,
              })),
            })),
          })),
        }
      }
      return {}
    }),
  })
}

async function render(row: ReturnType<typeof filing>) {
  mockSupabase(row)
  const response = await GET(
    new NextRequest(`http://localhost/api/vat-returns/${VAT_RETURN_ID}/export/pdf`),
    { params: Promise.resolve({ id: VAT_RETURN_ID }) }
  )
  const buffer = Buffer.from(await response.arrayBuffer())
  return { response, buffer, parsed: await pdfParse(buffer) }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(enforceServiceWorkspaceAccess as jest.Mock).mockResolvedValue(null)
})

describe("GET VAT 3 PDF", () => {
  it("downloads a PDF with period dates and recorded-payment status", async () => {
    const { response, buffer, parsed } = await render(filing())

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/pdf")
    expect(response.headers.get("content-disposition")).toContain(
      "gra-vat3-2026-10-01-2026-10-31.pdf"
    )
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF")
    expect(parsed.numpages).toBe(1)

    expect(parsed.text).toContain("PAID - PAYMENT RECORDED")
    expect(parsed.text).toContain("Payment recorded 2026-10-27")
    expect(parsed.text).toContain("GRA-PAY-1")
    expect(parsed.text).toContain("33333333-3333-4333-8333-333333333333")
    expect(parsed.text).toContain("203.17")
    expect(parsed.text).toContain("152.37")
    expect(parsed.text).toContain("25.40")
    expect(parsed.text).not.toContain("PAID - NO PAYMENT JOURNAL")
  })

  it("does not imply settlement when paid status has no linked journal", async () => {
    const { parsed } = await render(
      filing({
        payment_journal_entry_id: null,
        payment_date: "2026-10-27",
        payment_reference: null,
        payment_amount: null,
      })
    )

    expect(parsed.text).toContain("PAID - NO PAYMENT JOURNAL")
    expect(parsed.text).toContain(
      "not evidence that the tax liability was settled in the ledger"
    )
    expect(parsed.text).not.toContain("Payment recorded 2026")
  })

  it("renders a long multi-page fixture without recursive footer failure", async () => {
    const reason = "Long adjustment note for VAT PDF pagination. ".repeat(2500)
    const { response, parsed } = await render(
      filing({
        output_adjustment: 1,
        input_adjustment: 0,
        adjustment_reason: reason,
        payment_journal_entry_id: null,
        payment_amount: null,
      })
    )

    expect(response.status).toBe(200)
    expect(parsed.numpages).toBeGreaterThan(1)
    expect(parsed.text).toContain("PAID - NO PAYMENT JOURNAL")
    expect(parsed.text).toContain("Ghana Revenue Authority — VAT 3 Return")
    expect(parsed.text).toContain("Net VAT Payable")
    expect(parsed.text).toContain("203.17")
    expect(parsed.text).not.toContain("Maximum call stack size exceeded")
  })
})
