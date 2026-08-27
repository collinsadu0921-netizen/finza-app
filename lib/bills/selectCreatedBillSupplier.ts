import type { BillSupplierOption } from "./loadBillSuppliers"
import { applyBillSupplierSelection } from "./loadBillSuppliers"

export function mergeCreatedBillSupplier(
  created: BillSupplierOption,
  current: BillSupplierOption[]
): BillSupplierOption[] {
  if (current.some((supplier) => supplier.id === created.id)) {
    return current.map((supplier) => (supplier.id === created.id ? created : supplier))
  }
  return [...current, created].sort((a, b) => a.name.localeCompare(b.name))
}

export function selectCreatedBillSupplier(
  created: BillSupplierOption,
  current: BillSupplierOption[]
) {
  const suppliers = mergeCreatedBillSupplier(created, current)
  return {
    suppliers,
    ...applyBillSupplierSelection(created.id, suppliers),
  }
}
