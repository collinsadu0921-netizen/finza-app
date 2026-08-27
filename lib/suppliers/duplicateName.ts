export type NamedSupplier = {
  id: string
  name: string
}

export function normalizeSupplierName(name: string): string {
  return name.trim().toLowerCase()
}

/** Case-insensitive exact name match within the same already-scoped list. */
export function findExactNameDuplicates<T extends NamedSupplier>(
  name: string,
  suppliers: T[],
  excludeId?: string | null
): T[] {
  const target = normalizeSupplierName(name)
  if (!target) return []
  return suppliers.filter((supplier) => {
    if (excludeId && supplier.id === excludeId) return false
    return normalizeSupplierName(supplier.name) === target
  })
}

export function duplicateNameWarning(name: string): string {
  return `A supplier named ${name.trim()} already exists.`
}
