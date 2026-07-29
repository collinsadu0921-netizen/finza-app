/**
 * Client-side helpers for invoice material picker load states.
 * Keeps new/edit invoice pages aligned without duplicating messaging.
 */

import type { BillableMaterialListItem } from "@/lib/service/materialBillableList"

export type MaterialsPickerUiState =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "tier-blocked"
  | "trial-readonly"
  | "auth"
  | "business-missing"
  | "error"

export type BillableMaterialsFetchResult =
  | {
      ok: true
      state: "ready" | "empty"
      materials: BillableMaterialListItem[]
      businessId: string
      eligibility?: {
        active: number
        billable: number
        withSellingPrice: number
      }
    }
  | {
      ok: false
      state: Exclude<MaterialsPickerUiState, "idle" | "loading" | "ready" | "empty">
      materials: []
      businessId: string | null
      code: string | null
      message: string
      status: number
    }

export function buildBillableMaterialsListUrl(businessId: string, q?: string): string {
  const params = new URLSearchParams()
  const trimmed = businessId.trim()
  if (trimmed) params.set("business_id", trimmed)
  if (q?.trim()) params.set("q", q.trim())
  const qs = params.toString()
  return qs
    ? `/api/service/materials/billable-list?${qs}`
    : "/api/service/materials/billable-list"
}

export function serviceMaterialsSetupHref(businessId: string): string {
  const trimmed = businessId.trim()
  if (!trimmed) return "/service/materials"
  return `/service/materials?business_id=${encodeURIComponent(trimmed)}`
}

export function materialsPickerButtonLabel(state: MaterialsPickerUiState): string {
  switch (state) {
    case "loading":
      return "Loading materials…"
    case "tier-blocked":
      return "Professional plan required"
    case "trial-readonly":
      return "Subscription locked"
    case "auth":
      return "Sign in required"
    case "business-missing":
      return "Business required"
    case "error":
      return "Materials unavailable"
    case "empty":
      return "No billable materials"
    default:
      return "Add material"
  }
}

export function materialsPickerButtonDisabled(state: MaterialsPickerUiState): boolean {
  return state !== "ready"
}

export function interpretBillableMaterialsResponse(input: {
  status: number
  body: unknown
  requestedBusinessId: string
}): BillableMaterialsFetchResult {
  const { status, body, requestedBusinessId } = input
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const code = typeof payload.code === "string" ? payload.code : null
  const errorText =
    typeof payload.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : "Materials could not be loaded. Refresh the page or try again."

  if (status === 401) {
    return {
      ok: false,
      state: "auth",
      materials: [],
      businessId: null,
      code: code || "UNAUTHORIZED",
      message: "Your session expired. Sign in again to load materials.",
      status,
    }
  }

  if (status === 403 && code === "TIER_REQUIRED") {
    return {
      ok: false,
      state: "tier-blocked",
      materials: [],
      businessId: requestedBusinessId || null,
      code,
      message: "Invoice materials require the Professional plan or higher.",
      status,
    }
  }

  if (status === 403 && code === "TRIAL_EXPIRED_READ_ONLY") {
    return {
      ok: false,
      state: "trial-readonly",
      materials: [],
      businessId: requestedBusinessId || null,
      code,
      message:
        typeof payload.error === "string" && payload.error.trim()
          ? payload.error.trim()
          : "Your trial or subscription is read-only. Renew to add materials.",
      status,
    }
  }

  if (status === 403) {
    return {
      ok: false,
      state: "error",
      materials: [],
      businessId: requestedBusinessId || null,
      code: code || "FORBIDDEN_BUSINESS",
      message: errorText,
      status,
    }
  }

  if (status === 404) {
    return {
      ok: false,
      state: "business-missing",
      materials: [],
      businessId: null,
      code: code || "BUSINESS_NOT_FOUND",
      message: "Business not found for this workspace. Select a valid business and try again.",
      status,
    }
  }

  if (status < 200 || status >= 300) {
    return {
      ok: false,
      state: "error",
      materials: [],
      businessId: requestedBusinessId || null,
      code: code || "MATERIAL_LIST_FAILED",
      message: "Materials could not be loaded. Refresh the page or try again.",
      status,
    }
  }

  const materials = Array.isArray(payload.materials)
    ? (payload.materials as BillableMaterialListItem[])
    : []
  const businessId =
    typeof payload.businessId === "string" && payload.businessId.trim()
      ? payload.businessId.trim()
      : requestedBusinessId
  const eligibility =
    payload.eligibility && typeof payload.eligibility === "object"
      ? (payload.eligibility as {
          active: number
          billable: number
          withSellingPrice: number
        })
      : undefined

  if (materials.length === 0) {
    return {
      ok: true,
      state: "empty",
      materials: [],
      businessId,
      eligibility,
    }
  }

  return {
    ok: true,
    state: "ready",
    materials,
    businessId,
    eligibility,
  }
}

export async function fetchBillableMaterialsForInvoice(
  businessId: string,
  init?: RequestInit
): Promise<BillableMaterialsFetchResult> {
  const trimmed = businessId.trim()
  if (!trimmed) {
    return {
      ok: false,
      state: "business-missing",
      materials: [],
      businessId: null,
      code: "BUSINESS_NOT_FOUND",
      message: "Business not found for this workspace. Select a valid business and try again.",
      status: 0,
    }
  }

  try {
    const res = await fetch(buildBillableMaterialsListUrl(trimmed), {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers || {}),
      },
    })
    const body = await res.json().catch(() => ({}))
    return interpretBillableMaterialsResponse({
      status: res.status,
      body,
      requestedBusinessId: trimmed,
    })
  } catch {
    return {
      ok: false,
      state: "error",
      materials: [],
      businessId: trimmed,
      code: "MATERIAL_LIST_FAILED",
      message: "Materials could not be loaded. Refresh the page or try again.",
      status: 0,
    }
  }
}
