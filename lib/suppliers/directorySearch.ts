export type SupplierSearchRow = {
  name?: string | null
  phone?: string | null
  email?: string | null
}

export function supplierMatchesDirectorySearch(
  supplier: SupplierSearchRow,
  query: string
): boolean {
  const term = query.trim().toLowerCase()
  if (!term) return true
  const fields = [supplier.name, supplier.phone, supplier.email]
  return fields.some((value) => (value || "").toLowerCase().includes(term))
}
