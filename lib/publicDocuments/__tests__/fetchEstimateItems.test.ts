import { buildEstimateFinancialDocumentHtmlForPdf } from "@/lib/documents/buildEstimateFinancialDocumentHtmlForPdf"
import {
  ESTIMATE_ITEM_SELECT_CURRENT,
  ESTIMATE_ITEM_SELECT_LEGACY,
  estimateItemForPdf,
  estimateItemForPublicJson,
  fetchNormalizedEstimateItems,
  isEstimateItemSchemaMismatch,
  normalizeEstimateItemRow,
} from "../fetchEstimateItems"

const QUO_0010_DESCRIPTION =
  "Move-in cleaning of a three bedroom apartment at haatso, (living room, 2 washrooms, kitchen, corridor, terrazzo floors, tiles, )"

const legacyRow = {
  id: "line-1",
  description: QUO_0010_DESCRIPTION,
  quantity: 1,
  price: 2200,
  discount_amount: 220,
  total: 1980,
  created_at: "2026-09-01T00:00:00Z",
}

const currentRow = {
  id: "line-1",
  description: QUO_0010_DESCRIPTION,
  qty: 1,
  unit_price: 2200,
  discount_amount: 220,
  line_total: 1980,
  created_at: "2026-09-01T00:00:00Z",
}

function fakeClient(handler: (columns: string) => { data: unknown; error: unknown }) {
  const selects: string[] = []
  const client = {
    selects,
    from() {
      return {
        select(columns: string) {
          selects.push(columns)
          return {
            eq() {
              return {
                order: async () => handler(columns),
              }
            },
          }
        },
      }
    },
  }
  return client as typeof client & { from: () => unknown }
}

function quoteHtml(items: unknown[]) {
  return buildEstimateFinancialDocumentHtmlForPdf({
    estimate: {
      estimate_number: "QUO-0010",
      currency_code: "GHS",
      currency_symbol: "GH₵",
      issue_date: "2026-09-01",
      subtotal: 1980,
      total_tax_amount: 0,
      total_amount: 1980,
    },
    business: { name: "Cleaning Co", default_currency: "GHS" },
    customer: { id: "c1", name: "Customer" },
    items,
  })
}

describe("estimate item schema loader", () => {
  it("normalizes legacy quantity, price, and total", () => {
    const item = normalizeEstimateItemRow(legacyRow)
    expect(item).toMatchObject({
      description: QUO_0010_DESCRIPTION,
      quantity: 1,
      unitPrice: 2200,
      discountAmount: 220,
      lineTotal: 1980,
    })
  })

  it("normalizes current qty, unit_price, and line_total", () => {
    const item = normalizeEstimateItemRow(currentRow)
    expect(item).toMatchObject({
      description: QUO_0010_DESCRIPTION,
      quantity: 1,
      unitPrice: 2200,
      discountAmount: 220,
      lineTotal: 1980,
    })
  })

  it("puts the description and amounts into the document HTML", () => {
    const item = normalizeEstimateItemRow(legacyRow)
    const html = quoteHtml([estimateItemForPdf(item)])
    expect(html).toContain(QUO_0010_DESCRIPTION)
    expect(html).toContain("2,200.00")
    expect(html).toContain("220.00")
    expect(html).toContain("1,980.00")
  })

  it("public browser JSON and PDF input share the same normalized line", () => {
    const item = normalizeEstimateItemRow(currentRow)
    const json = estimateItemForPublicJson(item)
    const pdf = estimateItemForPdf(item)
    expect(json.description).toBe(pdf.description)
    expect(json.quantity).toBe(pdf.quantity)
    expect(json.price).toBe(pdf.price)
    expect(json.discount_amount).toBe(pdf.discount_amount)
    expect(json.total).toBe(pdf.total)
    expect(quoteHtml([pdf])).toContain(QUO_0010_DESCRIPTION)
  })

  it("falls back to the legacy select only after a missing-column error", async () => {
    const client = fakeClient((columns) => {
      if (columns === ESTIMATE_ITEM_SELECT_CURRENT) {
        return { data: null, error: { code: "42703", message: "column qty does not exist" } }
      }
      return { data: [legacyRow], error: null }
    })
    const result = await fetchNormalizedEstimateItems(client as never, "est-1")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.columnVariant).toBe("legacy")
      expect(result.items[0].description).toBe(QUO_0010_DESCRIPTION)
      expect(result.items[0].lineTotal).toBe(1980)
    }
    expect(client.selects).toEqual([ESTIMATE_ITEM_SELECT_CURRENT, ESTIMATE_ITEM_SELECT_LEGACY])
  })

  it("does not treat an arbitrary database error as a schema mismatch", async () => {
    const client = fakeClient(() => ({
      data: null,
      error: { code: "08006", message: "connection failure" },
    }))
    const result = await fetchNormalizedEstimateItems(client as never, "est-1")
    expect(isEstimateItemSchemaMismatch({ code: "08006", message: "connection failure" })).toBe(false)
    expect(result).toEqual({ ok: false, error: "connection failure" })
    expect(client.selects).toEqual([ESTIMATE_ITEM_SELECT_CURRENT])
  })

  it("fails when both compatible selects fail", async () => {
    const client = fakeClient(() => ({
      data: null,
      error: { code: "PGRST204", message: "Could not find the column" },
    }))
    const result = await fetchNormalizedEstimateItems(client as never, "est-1")
    expect(result.ok).toBe(false)
    expect(client.selects).toHaveLength(2)
  })

  it("treats a successful empty result as a quote with no lines", async () => {
    const client = fakeClient(() => ({ data: [], error: null }))
    const result = await fetchNormalizedEstimateItems(client as never, "est-1")
    expect(result).toEqual({ ok: true, items: [], columnVariant: "current" })
  })
})
