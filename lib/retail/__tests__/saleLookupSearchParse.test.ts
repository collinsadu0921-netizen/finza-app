import { readFileSync } from "fs"
import { join } from "path"
import {
  buildSalesHistoryTextSearchOrParts,
  findSalesByPaymentReference,
  isPartialHyphenatedUuidLookup,
  normalizeSaleUuidFromLookupInput,
  parseSaleAmountSearch,
  parseSaleHistoryDateSearch,
  saleLookupIlikePattern,
  shouldFlushSaleHistorySearchImmediately,
  SALE_HISTORY_SEARCH_DEBOUNCE_MS,
  type SalesHistoryReferenceSale,
} from "@/lib/retail/saleLookupSearchParse"

const repoRoot = join(__dirname, "../../..")

describe("saleLookupSearchParse", () => {
  it("normalizes hyphenated and compact UUIDs", () => {
    const a = "550E8400-E29B-41D4-A716-446655440000"
    expect(normalizeSaleUuidFromLookupInput(a)).toBe("550e8400-e29b-41d4-a716-446655440000")
    expect(normalizeSaleUuidFromLookupInput("550E8400E29B41D4A716446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000"
    )
  })

  it("treats partial hyphenated UUID as incomplete (not exact lookup)", () => {
    expect(normalizeSaleUuidFromLookupInput("550e8400-e29b")).toBeNull()
    expect(isPartialHyphenatedUuidLookup("550e8400-e29b")).toBe(true)
    expect(isPartialHyphenatedUuidLookup("550e8400-e29b-41d4-a716-446655440000")).toBe(false)
    expect(shouldFlushSaleHistorySearchImmediately("550e8400-e29b")).toBe(false)
    expect(shouldFlushSaleHistorySearchImmediately("550e8400-e29b-41d4-a716-446655440000")).toBe(true)
  })

  it("does not include id.ilike in text search OR parts", () => {
    const parts = buildSalesHistoryTextSearchOrParts("550e8400-e29b")
    expect(parts.some((p) => p.startsWith("id.ilike."))).toBe(false)
    expect(parts).toEqual([
      'momo_transaction_id.ilike."%550e8400-e29b%"',
      'hubtel_transaction_id.ilike."%550e8400-e29b%"',
      'description.ilike."%550e8400-e29b%"',
      'payment_reference.ilike."%550e8400-e29b%"',
      'payment_lines_search.ilike."%550e8400-e29b%"',
    ])
    expect(parts.some((part) => part.includes(".cs."))).toBe(false)
    const ordinary = buildSalesHistoryTextSearchOrParts("Ada")
    expect(ordinary.some((p) => p.startsWith("id.ilike."))).toBe(false)
    expect(ordinary[0]).toContain('momo_transaction_id.ilike."%Ada%"')
  })

  it("flushes immediately only for complete UUIDs during rapid entry", () => {
    const typed = ["5", "55", "550e8400", "550e8400-e29b", "550e8400-e29b-41d4-a716-446655440000"]
    const flushFlags = typed.map(shouldFlushSaleHistorySearchImmediately)
    expect(flushFlags).toEqual([false, false, false, false, true])
    expect(SALE_HISTORY_SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(200)
  })

  it("parses calendar date bounds", () => {
    const d = parseSaleHistoryDateSearch("2026-04-17")
    expect(d).not.toBeNull()
    expect(d!.start).toBe("2026-04-17T00:00:00.000Z")
    expect(d!.end.startsWith("2026-04-18")).toBe(true)
  })

  it("parses strict amounts", () => {
    expect(parseSaleAmountSearch("120.50")).toBe(120.5)
    expect(parseSaleAmountSearch("120,50")).toBe(120.5)
    expect(parseSaleAmountSearch("2024-01-01")).toBeNull()
  })

  it("searches the sale reference and each split payment-line reference as text", () => {
    const card = buildSalesHistoryTextSearchOrParts("STAGE-CARD-SPLIT-001")
    const momo = buildSalesHistoryTextSearchOrParts("STAGE-MOMO-SPLIT-001")
    expect(card).toContain('payment_reference.ilike."%STAGE-CARD-SPLIT-001%"')
    expect(card).toContain('payment_lines_search.ilike."%STAGE-CARD-SPLIT-001%"')
    expect(momo).toContain('payment_lines_search.ilike."%STAGE-MOMO-SPLIT-001%"')
    expect(card.join(",")).not.toContain(".cs.")
    expect(momo.join(",")).not.toContain(".cs.")
  })

  it("does not build a PostgREST JSON filter from malformed search input", () => {
    const safePart = /^[a-z0-9_]+\.ilike\."%[^"]*%"$/
    for (const raw of ['{"reference":"x"}', "a,b(c)", 'quote"slash\\', "   ", "%_%"]) {
      expect(() => buildSalesHistoryTextSearchOrParts(raw)).not.toThrow()
      const parts = buildSalesHistoryTextSearchOrParts(raw)
      expect(parts.join(",")).not.toContain(".cs.")
      expect(parts.every((part) => safePart.test(part))).toBe(true)
    }
    expect(buildSalesHistoryTextSearchOrParts("%_%")).toEqual([])
  })

  it("strips ilike wildcards from pattern", () => {
    expect(saleLookupIlikePattern("a%b_c")).toBe("abc")
  })
})

describe("payment reference search", () => {
  const splitLines = JSON.stringify([
    { method: "cash", amount: 4 },
    { method: "card", amount: 3, reference: "STAGE-CARD-SPLIT-002" },
    { method: "momo", amount: 3, reference: "STAGE-MOMO-SPLIT-002" },
  ])
  const sales: SalesHistoryReferenceSale[] = [
    {
      id: "card-sale",
      businessId: "biz-a",
      storeId: "store-a",
      paymentReference: "STAGE-CARD-002",
      paymentLines: JSON.stringify([{ method: "card", amount: 10, reference: "STAGE-CARD-002" }]),
    },
    {
      id: "momo-sale",
      businessId: "biz-a",
      storeId: "store-a",
      paymentReference: "STAGE-MOMO-002",
      paymentLines: JSON.stringify([{ method: "momo", amount: 10, reference: "STAGE-MOMO-002" }]),
    },
    {
      id: "split-sale",
      businessId: "biz-a",
      storeId: "store-a",
      paymentReference: null,
      paymentLines: splitLines,
    },
    {
      id: "other-store-card",
      businessId: "biz-a",
      storeId: "store-b",
      paymentReference: "STAGE-CARD-002",
      paymentLines: JSON.stringify([{ method: "card", amount: 10, reference: "STAGE-CARD-002" }]),
    },
    {
      id: "other-business",
      businessId: "biz-b",
      storeId: "store-a",
      paymentReference: "STAGE-CARD-002",
      paymentLines: JSON.stringify([{ method: "card", amount: 10, reference: "STAGE-CARD-002" }]),
    },
  ]
  const storeA = { businessId: "biz-a", storeId: "store-a" }

  it("finds a single card reference", () => {
    expect(findSalesByPaymentReference(sales, "STAGE-CARD-002", storeA).map((sale) => sale.id)).toEqual([
      "card-sale",
    ])
  })

  it("finds a single MoMo reference", () => {
    expect(findSalesByPaymentReference(sales, "STAGE-MOMO-002", storeA).map((sale) => sale.id)).toEqual([
      "momo-sale",
    ])
  })

  it("finds the same split sale from either line reference", () => {
    expect(findSalesByPaymentReference(sales, "STAGE-CARD-SPLIT-002", storeA).map((sale) => sale.id)).toEqual([
      "split-sale",
    ])
    expect(findSalesByPaymentReference(sales, "STAGE-MOMO-SPLIT-002", storeA).map((sale) => sale.id)).toEqual([
      "split-sale",
    ])
  })

  it("returns no sale for an unknown reference", () => {
    expect(findSalesByPaymentReference(sales, "STAGE-MISSING", storeA)).toEqual([])
  })

  it("does not return another business", () => {
    expect(findSalesByPaymentReference(sales, "STAGE-CARD-002", { businessId: "biz-b", storeId: "store-a" }).map((sale) => sale.id)).toEqual([
      "other-business",
    ])
    expect(findSalesByPaymentReference(sales, "STAGE-CARD-002", storeA).map((sale) => sale.id)).not.toContain(
      "other-business"
    )
  })

  it("does not let a manager search outside the assigned store", () => {
    const managerA = findSalesByPaymentReference(sales, "STAGE-CARD-002", storeA).map((sale) => sale.id)
    expect(managerA).toEqual(["card-sale"])
    expect(managerA).not.toContain("other-store-card")
  })

  it("returns no sale for malformed input instead of throwing", () => {
    expect(findSalesByPaymentReference(sales, '{"reference":"', storeA)).toEqual([])
    expect(findSalesByPaymentReference(sales, '%_%",()', storeA)).toEqual([])
  })
})

describe("sales-history list UUID search safety", () => {
  it("removes id.ilike on UUID column; keeps business/store scoping and exact eq path", () => {
    const route = readFileSync(join(repoRoot, "app/api/sales-history/list/route.ts"), "utf8")
    expect(route).not.toMatch(/id\.ilike/)
    expect(route).toContain('eq("id", uuidNorm)')
    expect(route).toContain('eq("business_id", businessId)')
    expect(route).toMatch(/store_id/)
    expect(route).toContain("buildSalesHistoryTextSearchOrParts")
    expect(route).toContain("normalizeSaleUuidFromLookupInput")
    expect(route).not.toContain("payment_lines.cs")
  })

  it("Sales History UI debounces ordinary typing and flushes full UUID immediately", () => {
    const page = readFileSync(join(repoRoot, "components/retail/sales-history/RetailSalesHistoryPage.tsx"), "utf8")
    expect(page).toContain("debouncedSaleSearch")
    expect(page).toContain("shouldFlushSaleHistorySearchImmediately")
    expect(page).toContain("SALE_HISTORY_SEARCH_DEBOUNCE_MS")
    expect(page).toMatch(/debouncedSaleSearch/)
  })
})
