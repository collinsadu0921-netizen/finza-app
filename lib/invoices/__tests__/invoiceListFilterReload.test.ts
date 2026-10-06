import {
  emptyInvoiceListPagination,
  invoiceListQueryKey,
  shouldSkipDuplicateInvoiceListLoad,
} from "../invoiceListClient"

describe("invoice list filter reload helpers", () => {
  const baseKey = {
    businessId: "biz-x",
    statusFilter: "all",
    approvalFilter: "all",
    customerFilter: "all",
    startDate: "",
    endDate: "",
    searchQuery: "",
    page: 1,
  }

  it("changes the query key when status becomes overdue", () => {
    expect(invoiceListQueryKey({ ...baseKey, statusFilter: "overdue" })).not.toBe(
      invoiceListQueryKey(baseKey)
    )
  })

  it("skips only the duplicate mount load, not a later Overdue filter", () => {
    const mountKey = invoiceListQueryKey(baseKey)
    expect(shouldSkipDuplicateInvoiceListLoad(mountKey, mountKey)).toBe(true)
    expect(
      shouldSkipDuplicateInvoiceListLoad(
        mountKey,
        invoiceListQueryKey({ ...baseKey, statusFilter: "overdue" })
      )
    ).toBe(false)
    expect(shouldSkipDuplicateInvoiceListLoad(null, invoiceListQueryKey(baseKey))).toBe(false)
  })

  it("clears pagination after a failed filter fetch", () => {
    expect(emptyInvoiceListPagination(25)).toEqual({
      page: 1,
      pageSize: 25,
      totalCount: 0,
      totalPages: 0,
    })
  })
})
