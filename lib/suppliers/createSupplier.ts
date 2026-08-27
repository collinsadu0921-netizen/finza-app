export type SupplierRecord = {
  id: string
  business_id: string
  name: string
  phone: string | null
  email: string | null
  location_line: string | null
  tax_id: string | null
  status: string
}

export type SupplierFormValues = {
  name: string
  phone?: string
  email?: string
  location_line?: string
  tax_id?: string
}

export type CreateSupplierResult =
  | { ok: true; supplier: SupplierRecord; name_matches: Array<{ id: string; name: string }> }
  | { ok: false; error: string; status: number }

export type UpdateSupplierResult =
  | { ok: true; supplier: SupplierRecord }
  | { ok: false; error: string; status: number }

function asOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

export function parseSupplierRecord(payload: unknown): SupplierRecord | null {
  if (!payload || typeof payload !== "object") return null
  const row = payload as Record<string, unknown>
  const id = asOptionalText(row.id)
  const businessId = asOptionalText(row.business_id)
  const name = asOptionalText(row.name)
  if (!id || !businessId || !name) return null
  return {
    id,
    business_id: businessId,
    name,
    phone: asOptionalText(row.phone),
    email: asOptionalText(row.email),
    location_line: asOptionalText(row.location_line),
    tax_id: asOptionalText(row.tax_id),
    status: asOptionalText(row.status) || "active",
  }
}

export function toBillSupplierHydrate(supplier: Pick<SupplierRecord, "name" | "phone" | "email">) {
  return {
    name: supplier.name || "",
    phone: supplier.phone || "",
    email: supplier.email || "",
  }
}

export async function createSupplierRecord(
  businessId: string,
  values: SupplierFormValues,
  fetchImpl: typeof fetch = fetch
): Promise<CreateSupplierResult> {
  const scopedId = businessId.trim()
  if (!scopedId) {
    return { ok: false, error: "Business is required", status: 400 }
  }
  const name = values.name.trim()
  if (!name) {
    return { ok: false, error: "Supplier name is required", status: 400 }
  }

  let response: Response
  try {
    response = await fetchImpl("/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: scopedId,
        name,
        phone: values.phone?.trim() || null,
        email: values.email?.trim() || null,
        location_line: values.location_line?.trim() || null,
        tax_id: values.tax_id?.trim() || null,
      }),
    })
  } catch {
    return { ok: false, error: "Could not create supplier", status: 0 }
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    return { ok: false, error: "Could not create supplier", status: response.status }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error || "Could not create supplier")
        : "Could not create supplier"
    return { ok: false, error: message, status: response.status }
  }

  const supplier = parseSupplierRecord(
    payload && typeof payload === "object" ? (payload as { supplier?: unknown }).supplier : null
  )
  if (!supplier) {
    return { ok: false, error: "Could not create supplier", status: response.status }
  }

  const matchesRaw =
    payload && typeof payload === "object" && Array.isArray((payload as { name_matches?: unknown }).name_matches)
      ? ((payload as { name_matches: Array<{ id?: unknown; name?: unknown }> }).name_matches)
      : []
  const name_matches = matchesRaw
    .map((row) => ({
      id: asOptionalText(row.id) || "",
      name: asOptionalText(row.name) || "",
    }))
    .filter((row) => row.id && row.name)

  return { ok: true, supplier, name_matches }
}

export async function updateSupplierRecord(
  supplierId: string,
  businessId: string,
  values: SupplierFormValues & { status?: "active" | "blocked" },
  fetchImpl: typeof fetch = fetch
): Promise<UpdateSupplierResult> {
  const id = supplierId.trim()
  const scopedId = businessId.trim()
  if (!id || !scopedId) {
    return { ok: false, error: "Supplier and business are required", status: 400 }
  }
  const name = values.name.trim()
  if (!name) {
    return { ok: false, error: "Supplier name is required", status: 400 }
  }

  let response: Response
  try {
    response = await fetchImpl(`/api/suppliers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: scopedId,
        name,
        phone: values.phone?.trim() || null,
        email: values.email?.trim() || null,
        location_line: values.location_line?.trim() || null,
        tax_id: values.tax_id?.trim() || null,
        ...(values.status ? { status: values.status } : {}),
      }),
    })
  } catch {
    return { ok: false, error: "Could not update supplier", status: 0 }
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    return { ok: false, error: "Could not update supplier", status: response.status }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error || "Could not update supplier")
        : "Could not update supplier"
    return { ok: false, error: message, status: response.status }
  }

  const supplier = parseSupplierRecord(
    payload && typeof payload === "object" ? (payload as { supplier?: unknown }).supplier : null
  )
  if (!supplier) {
    return { ok: false, error: "Could not update supplier", status: response.status }
  }
  return { ok: true, supplier }
}
