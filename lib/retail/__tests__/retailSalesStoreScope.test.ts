import { isAllowedRetailSalesReaderRole } from "@/lib/retail/requireRetailSalesReader"
import { resolveRetailSalesStoreScope } from "@/lib/retail/retailSalesStoreScope"
import { retailManagerRequiresAssignedStore } from "@/lib/staff/businessStaffPermissions"

describe("retail sales store scope", () => {
  it("lets an owner or admin view all stores", () => {
    expect(
      resolveRetailSalesStoreScope({
        role: "owner",
        assignedStoreId: null,
        requestedStoreId: "all",
      })
    ).toEqual({ ok: true, storeId: null })
    expect(
      resolveRetailSalesStoreScope({
        role: "admin",
        assignedStoreId: null,
        requestedStoreId: null,
      })
    ).toEqual({ ok: true, storeId: null })
    expect(isAllowedRetailSalesReaderRole("list", "owner")).toBe(true)
    expect(isAllowedRetailSalesReaderRole("list", "admin")).toBe(true)
  })

  it("locks a store-assigned manager to that store", () => {
    expect(
      resolveRetailSalesStoreScope({
        role: "manager",
        assignedStoreId: "store-1",
        requestedStoreId: "store-2",
      })
    ).toEqual({ ok: true, storeId: "store-1" })
  })

  it("rejects a manager with no store", () => {
    const scope = resolveRetailSalesStoreScope({
      role: "manager",
      assignedStoreId: null,
      requestedStoreId: null,
    })
    expect(scope.ok).toBe(false)
    if (!scope.ok) {
      expect(scope.status).toBe(403)
      expect(scope.error).toBe("Store manager must be assigned to a store")
    }
  })

  it("locks a cashier to their assigned store and denies an unassigned cashier", () => {
    expect(
      resolveRetailSalesStoreScope({
        role: "cashier",
        assignedStoreId: "store-1",
        requestedStoreId: "store-2",
      })
    ).toEqual({ ok: true, storeId: "store-1" })
    expect(
      resolveRetailSalesStoreScope({
        role: "cashier",
        assignedStoreId: null,
        requestedStoreId: "store-1",
      }).ok
    ).toBe(false)
    expect(isAllowedRetailSalesReaderRole("list", "cashier")).toBe(false)
    expect(isAllowedRetailSalesReaderRole("receipt", "cashier")).toBe(true)
  })

  it("denies a caller with no membership in the business", () => {
    expect(isAllowedRetailSalesReaderRole("list", null)).toBe(false)
    expect(isAllowedRetailSalesReaderRole("receipt", null)).toBe(false)
  })

  it("requires a store only for retail managers", () => {
    expect(retailManagerRequiresAssignedStore("retail")).toBe(true)
    expect(retailManagerRequiresAssignedStore("Retail")).toBe(true)
    expect(retailManagerRequiresAssignedStore("service")).toBe(false)
    expect(retailManagerRequiresAssignedStore("professional")).toBe(false)
  })
})
