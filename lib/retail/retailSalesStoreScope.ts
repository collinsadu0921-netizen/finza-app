/**
 * Retail sales-history store scope.
 * Owners and admins may view every store. Managers and cashiers are locked
 * to the store on public.users. A manager with no store is not company-wide.
 */

export type RetailSalesStoreScope =
  | { ok: true; storeId: string | null }
  | { ok: false; status: 403; error: string }

export function resolveRetailSalesStoreScope(input: {
  role: string
  assignedStoreId: string | null
  requestedStoreId: string | null
}): RetailSalesStoreScope {
  if (input.role === "owner" || input.role === "admin" || input.role === "employee") {
    const requested = input.requestedStoreId
    return {
      ok: true,
      storeId: requested && requested !== "all" ? requested : null,
    }
  }

  if (input.role === "manager" || input.role === "cashier") {
    if (!input.assignedStoreId) {
      return {
        ok: false,
        status: 403,
        error:
          input.role === "manager"
            ? "Store manager must be assigned to a store"
            : "Cashier must be assigned to a store",
      }
    }
    return { ok: true, storeId: input.assignedStoreId }
  }

  const requested = input.requestedStoreId
  return {
    ok: true,
    storeId: requested && requested !== "all" ? requested : null,
  }
}
