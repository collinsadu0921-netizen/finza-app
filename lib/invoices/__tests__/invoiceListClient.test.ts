import {
  buildInvoiceListHref,
  findBusinessWithMostInvoices,
  hasActiveInvoiceListFilters,
  invoiceListHrefNeedsUpdate,
  normalizeInvoiceListHref,
  shouldResetInvoiceListPage,
  syncInvoiceListUrlBusinessId,
  SERVICE_INVOICES_LIST_PATH,
} from "../invoiceListClient"

const PATH = SERVICE_INVOICES_LIST_PATH

describe("buildInvoiceListHref", () => {
  it("includes business_id only when page is 1", () => {
    expect(
      buildInvoiceListHref(PATH, { businessId: "biz-x", page: 1 })
    ).toBe(`${PATH}?business_id=biz-x`)
  })

  it("adds page param when page > 1", () => {
    expect(
      buildInvoiceListHref(PATH, { businessId: "biz-x", page: 2 })
    ).toBe(`${PATH}?business_id=biz-x&page=2`)
  })

  it("removes page param when returning to page 1", () => {
    expect(
      buildInvoiceListHref(PATH, {
        businessId: "biz-x",
        page: 1,
        preserveSearch: "business_id=biz-x&page=2",
      })
    ).toBe(`${PATH}?business_id=biz-x`)
  })

  it("includes status when filter is not all", () => {
    expect(
      buildInvoiceListHref(PATH, {
        businessId: "biz-x",
        page: 1,
        statusFilter: "sent",
      })
    ).toBe(`${PATH}?business_id=biz-x&status=sent`)
  })
})

describe("invoiceListHrefNeedsUpdate", () => {
  it("returns false when URL already matches target", () => {
    const current = "business_id=biz-x"
    const target = `${PATH}?business_id=biz-x`
    expect(invoiceListHrefNeedsUpdate(PATH, current, target)).toBe(false)
  })

  it("returns false when only param order differs", () => {
    const current = "page=2&business_id=biz-x"
    const target = `${PATH}?business_id=biz-x&page=2`
    expect(invoiceListHrefNeedsUpdate(PATH, current, target)).toBe(false)
  })

  it("returns true when business_id differs", () => {
    expect(
      invoiceListHrefNeedsUpdate(
        PATH,
        "business_id=old",
        `${PATH}?business_id=new`
      )
    ).toBe(true)
  })

  it("returns true when page param should be added", () => {
    expect(
      invoiceListHrefNeedsUpdate(
        PATH,
        "business_id=biz-x",
        `${PATH}?business_id=biz-x&page=2`
      )
    ).toBe(true)
  })
})

describe("normalizeInvoiceListHref", () => {
  it("omits trailing ? when search is empty", () => {
    expect(normalizeInvoiceListHref(PATH, "")).toBe(PATH)
  })
})

describe("syncInvoiceListUrlBusinessId", () => {
  const replaceState = jest.fn()
  let href = "http://localhost/service/invoices"

  beforeEach(() => {
    replaceState.mockClear()
    href = "http://localhost/service/invoices"
    Object.defineProperty(global, "window", {
      configurable: true,
      value: {
        history: { replaceState },
        get location() {
          return { href }
        },
      },
    })
  })

  afterEach(() => {
    // @ts-expect-error cleanup test global
    delete global.window
  })

  it("sets business_id in the URL when missing", () => {
    syncInvoiceListUrlBusinessId("biz-123")
    expect(replaceState).toHaveBeenCalledWith(
      {},
      "",
      "/service/invoices?business_id=biz-123"
    )
  })

  it("no-ops when business_id already matches", () => {
    href = "http://localhost/service/invoices?business_id=biz-123"
    syncInvoiceListUrlBusinessId("biz-123")
    expect(replaceState).not.toHaveBeenCalled()
  })
})

describe("findBusinessWithMostInvoices", () => {
  it("returns the business with the highest invoice count", async () => {
    const counts: Record<string, number> = { a: 2, b: 7, c: 3 }
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            is: jest.fn(async (_col: string, _val: null) => ({
              count: counts.a,
              error: null,
            })),
          })),
        })),
      })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient

    ;(supabase.from as jest.Mock).mockImplementation(() => ({
      select: jest.fn((_cols: string, _opts: unknown) => ({
        eq: jest.fn((_col: string, id: string) => ({
          is: jest.fn(async () => ({
            count: counts[id] ?? 0,
            error: null,
          })),
        })),
      })),
    }))

    const result = await findBusinessWithMostInvoices(supabase, ["a", "b", "c"])
    expect(result).toBe("b")
  })

  it("returns null when no business has invoices", async () => {
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            is: jest.fn(async () => ({ count: 0, error: null })),
          })),
        })),
      })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient

    const result = await findBusinessWithMostInvoices(supabase, ["a", "b"])
    expect(result).toBeNull()
  })
})

describe("shouldResetInvoiceListPage", () => {
  it("returns true when page is beyond totalPages with non-zero totalCount", () => {
    expect(
      shouldResetInvoiceListPage(0, { totalCount: 10, totalPages: 1 }, 3)
    ).toBe(true)
  })

  it("returns false when rows exist", () => {
    expect(
      shouldResetInvoiceListPage(5, { totalCount: 10, totalPages: 1 }, 1)
    ).toBe(false)
  })

  it("returns false when totalCount is zero", () => {
    expect(
      shouldResetInvoiceListPage(0, { totalCount: 0, totalPages: 1 }, 5)
    ).toBe(false)
  })
})

describe("hasActiveInvoiceListFilters", () => {
  it("detects active filters", () => {
    expect(
      hasActiveInvoiceListFilters({
        statusFilter: "sent",
        customerFilter: "all",
        startDate: "",
        endDate: "",
        searchInput: "",
      })
    ).toBe(true)
  })

  it("returns false when no filters active", () => {
    expect(
      hasActiveInvoiceListFilters({
        statusFilter: "all",
        customerFilter: "all",
        startDate: "",
        endDate: "",
        searchInput: "",
      })
    ).toBe(false)
  })
})
