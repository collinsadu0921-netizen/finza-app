/**
 * Tenant-scoped supplier link for service bills.
 * Does not create suppliers and does not change tax/posting.
 */

export type BillSupplierLinkOk = {
  ok: true
  supplier_id: string | null
  name: string | null
  phone: string | null
  email: string | null
}

export type BillSupplierLinkErr = {
  ok: false
  error: string
  status: number
}

export type BillSupplierLinkResult = BillSupplierLinkOk | BillSupplierLinkErr

export function hydrateBillSupplierSelection(supplierId: unknown): string {
  if (typeof supplierId !== "string") return ""
  return supplierId.trim()
}

export function billSupplierIdPayload(selectedId: string): string | null {
  const id = selectedId.trim()
  return id.length > 0 ? id : null
}

function asOptionalId(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const id = String(value).trim()
  return id.length > 0 ? id : null
}

export async function resolveBillSupplierLink(
  supabase: { from: (table: string) => any },
  businessId: string,
  supplierId: unknown
): Promise<BillSupplierLinkResult> {
  const id = asOptionalId(supplierId)
  if (!id) {
    return { ok: true, supplier_id: null, name: null, phone: null, email: null }
  }

  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, phone, email")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle()

  if (error || !data) {
    return {
      ok: false,
      error: "Selected supplier not found for this business",
      status: 400,
    }
  }

  return {
    ok: true,
    supplier_id: data.id,
    name: data.name ?? null,
    phone: data.phone ?? null,
    email: data.email ?? null,
  }
}
