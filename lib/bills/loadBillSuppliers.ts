/**
 * Canonical supplier-list loader for Create/Edit Supplier Bill.
 * Uses GET /api/suppliers and the { suppliers: [...] } contract.
 */

export type BillSupplierOption = {
  id: string
  name: string
  phone: string | null
  email: string | null
  status: string
}

export type LoadBillSuppliersOk = {
  ok: true
  suppliers: BillSupplierOption[]
}

export type LoadBillSuppliersErr = {
  ok: false
  error: string
  suppliers: []
}

export type LoadBillSuppliersResult = LoadBillSuppliersOk | LoadBillSuppliersErr

function asOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

export function parseSupplierListResponse(payload: unknown): BillSupplierOption[] | null {
  if (!payload || typeof payload !== "object") return null
  const suppliers = (payload as { suppliers?: unknown }).suppliers
  if (!Array.isArray(suppliers)) return null

  const mapped: BillSupplierOption[] = []
  for (const row of suppliers) {
    if (!row || typeof row !== "object") continue
    const id = asOptionalText((row as { id?: unknown }).id)
    const name = asOptionalText((row as { name?: unknown }).name)
    if (!id || !name) continue
    mapped.push({
      id,
      name,
      phone: asOptionalText((row as { phone?: unknown }).phone),
      email: asOptionalText((row as { email?: unknown }).email),
      status: asOptionalText((row as { status?: unknown }).status) || "active",
    })
  }
  return mapped
}

export function supplierSelectLabel(supplier: Pick<BillSupplierOption, "name" | "status">): string {
  return `${supplier.name}${supplier.status === "blocked" ? " (blocked)" : ""}`
}

export function billSupplierSelectOptions(
  suppliers: BillSupplierOption[]
): Array<{ value: string; label: string }> {
  return [
    { value: "", label: "Type manually (or select supplier)" },
    ...suppliers.map((supplier) => ({
      value: supplier.id,
      label: supplierSelectLabel(supplier),
    })),
  ]
}

export function applyBillSupplierSelection(
  selectedId: string,
  suppliers: BillSupplierOption[]
): {
  selectedId: string
  supplier_id: string | null
  hydrate: { name: string; phone: string; email: string } | null
} {
  const id = selectedId.trim()
  if (!id) {
    return { selectedId: "", supplier_id: null, hydrate: null }
  }
  const selected = suppliers.find((supplier) => supplier.id === id)
  if (!selected) {
    return { selectedId: id, supplier_id: id, hydrate: null }
  }
  return {
    selectedId: id,
    supplier_id: id,
    hydrate: {
      name: selected.name || "",
      phone: selected.phone || "",
      email: selected.email || "",
    },
  }
}

export async function loadBillSuppliers(
  businessId?: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<LoadBillSuppliersResult> {
  const params = new URLSearchParams()
  const scopedId = typeof businessId === "string" ? businessId.trim() : ""
  if (scopedId) params.set("business_id", scopedId)

  const qs = params.toString()
  let response: Response
  try {
    response = await fetchImpl(qs ? `/api/suppliers?${qs}` : "/api/suppliers")
  } catch {
    return { ok: false, error: "Could not load suppliers", suppliers: [] }
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    return { ok: false, error: "Could not load suppliers", suppliers: [] }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error || "Could not load suppliers")
        : "Could not load suppliers"
    return { ok: false, error: message, suppliers: [] }
  }

  const suppliers = parseSupplierListResponse(payload)
  if (!suppliers) {
    return { ok: false, error: "Could not load suppliers", suppliers: [] }
  }

  return { ok: true, suppliers }
}
