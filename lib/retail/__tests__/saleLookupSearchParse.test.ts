import { readFileSync } from "fs"
import { join } from "path"
import {
  buildSalesHistoryTextSearchOrParts,
  isPartialHyphenatedUuidLookup,
  normalizeSaleUuidFromLookupInput,
  parseSaleAmountSearch,
  parseSaleHistoryDateSearch,
  saleLookupIlikePattern,
  shouldFlushSaleHistorySearchImmediately,
  SALE_HISTORY_SEARCH_DEBOUNCE_MS,
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
      "momo_transaction_id.ilike.%550e8400-e29b%",
      "hubtel_transaction_id.ilike.%550e8400-e29b%",
      "description.ilike.%550e8400-e29b%",
    ])
    const ordinary = buildSalesHistoryTextSearchOrParts("Ada")
    expect(ordinary.some((p) => p.startsWith("id.ilike."))).toBe(false)
    expect(ordinary[0]).toContain("momo_transaction_id.ilike.%Ada%")
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

  it("strips ilike wildcards from pattern", () => {
    expect(saleLookupIlikePattern("a%b_c")).toBe("abc")
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
  })

  it("Sales History UI debounces ordinary typing and flushes full UUID immediately", () => {
    const page = readFileSync(join(repoRoot, "components/retail/sales-history/RetailSalesHistoryPage.tsx"), "utf8")
    expect(page).toContain("debouncedSaleSearch")
    expect(page).toContain("shouldFlushSaleHistorySearchImmediately")
    expect(page).toContain("SALE_HISTORY_SEARCH_DEBOUNCE_MS")
    expect(page).toMatch(/debouncedSaleSearch/)
  })
})
