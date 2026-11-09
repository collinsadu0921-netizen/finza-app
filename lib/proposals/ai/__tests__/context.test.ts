import { describe, expect, it, jest } from "@jest/globals"
import { loadProposalAiContext } from "../context"

function query(result: { data: unknown; error: null }) {
  const chain: Record<string, unknown> = {}
  chain.select = jest.fn(() => chain)
  chain.eq = jest.fn(() => chain)
  chain.is = jest.fn(() => chain)
  chain.order = jest.fn(() => chain)
  chain.limit = jest.fn(() => chain)
  chain.maybeSingle = jest.fn(async () => result)
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

function makeSupabase() {
  return {
    from: jest.fn((table: string) => {
      if (table === "businesses") {
        return query({
          data: {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "Acme Studio",
            legal_name: "Acme Studio Limited",
            trading_name: "Acme Studio",
            logo_url: "https://example.com/logo.png",
            address_street: "14 Independence Avenue",
            address_city: "Accra",
            address_region: "Greater Accra",
            address_country: "Ghana",
            phone: "+233300000000",
            email: "hello@acme.example",
            website: "https://acme.example",
            tin: "C0012345678",
            default_currency: "GHS",
            industry: "service",
            archived_at: null,
          },
          error: null,
        })
      }
      if (table === "proposals") {
        return query({
          data: {
            id: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
            business_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            customer_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            title: "Cleaning proposal",
            status: "draft",
            template_id: "premium_v1",
            pricing_mode: "fixed",
            pricing_payload: { amount: 27000 },
            currency_code: null,
            expires_at: null,
            sections: [{ type: "paragraph", text: "Hello" }],
          },
          error: null,
        })
      }
      if (table === "customers") {
        return query({
          data: [
            {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              name: "ABC Company",
              email: "finance@abc.example",
              phone: null,
              whatsapp_phone: "+233200000000",
            },
          ],
          error: null,
        })
      }
      if (table === "products_services") {
        return query({
          data: [
            { id: "ps1", name: "Office cleaning", unit_price: 4500 },
            { id: "ps2", name: "Window cleaning", unit_price: 900 },
          ],
          error: null,
        })
      }
      if (table === "service_catalog") {
        return query({
          data: [
            { id: "sc1", name: "Office cleaning", default_price: 4500 },
            { id: "sc2", name: "Deep cleaning", default_price: 12000 },
          ],
          error: null,
        })
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

describe("loadProposalAiContext", () => {
  it("loads saved company, customer, currency and service context", async () => {
    const result = await loadProposalAiContext(makeSupabase() as never, {
      businessId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      proposalId: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.context.business).toMatchObject({
      legalName: "Acme Studio Limited",
      tradingName: "Acme Studio",
      logoUrl: "https://example.com/logo.png",
      address: "14 Independence Avenue, Accra, Greater Accra, Ghana",
      tin: "C0012345678",
      defaultCurrency: "GHS",
    })
    expect(result.context.proposal.currencyCode).toBe("GHS")
    expect(result.context.selectedCustomer?.name).toBe("ABC Company")
    expect(result.context.services.map((service) => service.name)).toEqual([
      "Office cleaning",
      "Window cleaning",
      "Deep cleaning",
    ])
    expect(result.context.services.find((service) => service.name === "Office cleaning")?.source).toBe(
      "products_services"
    )
  })

  it("returns not found instead of exposing another tenant's proposal", async () => {
    const supabase = makeSupabase()
    jest.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "businesses") return query({ data: null, error: null })
      return query({ data: null, error: null })
    })
    const result = await loadProposalAiContext(supabase as never, {
      businessId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      proposalId: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
    })
    expect(result).toMatchObject({ ok: false, status: 404 })
  })
})
