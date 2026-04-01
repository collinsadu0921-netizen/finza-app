import { SupabaseClient } from "@supabase/supabase-js"
import { getUserRole } from "./userRoles"

// ─── localStorage helpers (client-side only) ──────────────────────────────────

const WORKSPACE_KEY = "finza_selected_business_id"

export function getSelectedBusinessId(): string | null {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(WORKSPACE_KEY)
  } catch {
    return null
  }
}

export function setSelectedBusinessId(id: string | null): void {
  if (typeof window === "undefined") return
  try {
    if (id) localStorage.setItem(WORKSPACE_KEY, id)
    else localStorage.removeItem(WORKSPACE_KEY)
  } catch {}
}

export function clearSelectedBusinessId(): void {
  setSelectedBusinessId(null)
}

// ─── Get ALL businesses a user has access to ─────────────────────────────────

export async function getAllUserBusinesses(
  supabase: SupabaseClient,
  userId: string
): Promise<Array<any & { _role: string }>> {
  const results: Array<any & { _role: string }> = []
  const seenIds = new Set<string>()

  // 1. Businesses the user owns
  const { data: owned } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })

  for (const b of owned ?? []) {
    if (!seenIds.has(b.id)) {
      seenIds.add(b.id)
      results.push({ ...b, _role: "owner" })
    }
  }

  // 2. Businesses where user is a team member
  const { data: memberOf } = await supabase
    .from("business_users")
    .select("role, business_id, businesses(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  for (const bu of memberOf ?? []) {
    const b = Array.isArray(bu.businesses) ? bu.businesses[0] : bu.businesses
    if (b && b.archived_at == null && !seenIds.has(b.id)) {
      seenIds.add(b.id)
      results.push({ ...b, _role: bu.role || "member" })
    }
  }

  return results
}

// ─── Get one business (respects localStorage workspace preference) ────────────

export async function getCurrentBusiness(
  supabase: SupabaseClient,
  userId: string
) {
  // On client side, honour a previously selected workspace
  const preferredId = getSelectedBusinessId()
  if (preferredId) {
    const { data: preferred } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", preferredId)
      .is("archived_at", null)
      .maybeSingle()

    if (preferred) {
      // Verify the user actually has access to this business
      const isOwner = preferred.owner_id === userId
      if (isOwner) return preferred

      const { data: bu } = await supabase
        .from("business_users")
        .select("id")
        .eq("business_id", preferredId)
        .eq("user_id", userId)
        .maybeSingle()
      if (bu) return preferred

      // No access — clear stale preference and fall through
      clearSelectedBusinessId()
    } else {
      // Business no longer exists — clear stale preference
      clearSelectedBusinessId()
    }
  }

  // First, try to get business where user is owner (exclude archived)
  const { data: ownerBusiness, error: ownerError } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!ownerError && ownerBusiness) {
    return ownerBusiness
  }

  // If not owner, check business_users table (exclude archived businesses)
  const { data: businessUsers, error: buError } = await supabase
    .from("business_users")
    .select("business_id, businesses(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (!buError && businessUsers && businessUsers.length > 0) {
    const firstNonArchived = businessUsers.find((bu: any) => {
      const b = Array.isArray(bu.businesses) ? bu.businesses[0] : bu.businesses
      return b && b.archived_at == null
    })
    if (firstNonArchived) {
      const business = Array.isArray(firstNonArchived.businesses)
        ? firstNonArchived.businesses[0]
        : firstNonArchived.businesses
      return business as any
    }
  }

  // If no business found via either method, return null
  if (!ownerError && !ownerBusiness && (buError || !businessUsers?.length)) {
    return null
  }

  // Fallback error handling
  if (ownerError) {
    const { data, error } = await supabase
      .from("businesses")
      .select("*")
      .eq("owner_id", userId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      const errMsg = (error as { message?: string }).message
      const errCode = (error as { code?: string }).code

      if (!errMsg && !errCode) return null

      console.error("Error fetching business:", {
        message: errMsg,
        code: errCode,
        details: (error as { details?: string }).details,
        hint: (error as { hint?: string }).hint,
      })

      if (errCode === "PGRST116" || errMsg?.includes("multiple")) {
        const { data: businessesData, error: businessesError } = await supabase
          .from("businesses")
          .select("*")
          .eq("owner_id", userId)
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(1)

        if (businessesError) {
          const enhancedError = new Error(
            `Failed to fetch business: ${(businessesError as { message?: string }).message || (businessesError as { code?: string }).code || "Unknown error"}`
          ) as any
          enhancedError.code = (businessesError as { code?: string }).code
          enhancedError.details = (businessesError as { details?: string }).details
          enhancedError.hint = (businessesError as { hint?: string }).hint
          enhancedError.originalError = businessesError
          throw enhancedError
        }

        return businessesData && businessesData.length > 0 ? businessesData[0] : null
      }

      const enhancedError = new Error(
        `Failed to fetch business: ${errMsg || errCode || "Unknown error"}`
      ) as any
      enhancedError.code = errCode
      enhancedError.details = (error as { details?: string }).details
      enhancedError.hint = (error as { hint?: string }).hint
      enhancedError.originalError = error
      throw enhancedError
    }

    return data
  }

  return null
}

/** Result of {@link resolveBusinessScopeForUser}. */
export type ResolveBusinessScopeResult =
  | { ok: true; businessId: string }
  | { ok: false; status: number; error: string }

/**
 * Resolves which business an API route should use. When the client sends
 * `business_id` (aligned with localStorage workspace selection), validates
 * membership and uses it; otherwise falls back to {@link getCurrentBusiness}
 * (server cannot read localStorage, so multi-business users need the param).
 */
export async function resolveBusinessScopeForUser(
  supabase: SupabaseClient,
  userId: string,
  requestedBusinessId: string | null | undefined
): Promise<ResolveBusinessScopeResult> {
  const trimmed =
    typeof requestedBusinessId === "string" ? requestedBusinessId.trim() : ""
  const explicit = trimmed.length > 0 ? trimmed : null

  if (explicit) {
    const role = await getUserRole(supabase, userId, explicit)
    if (!role) {
      return { ok: false, status: 403, error: "Forbidden" }
    }
    const { data: b } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", explicit)
      .is("archived_at", null)
      .maybeSingle()
    if (!b) {
      return { ok: false, status: 404, error: "Business not found" }
    }
    return { ok: true, businessId: b.id }
  }

  const business = await getCurrentBusiness(supabase, userId)
  if (!business) {
    return { ok: false, status: 404, error: "Business not found" }
  }
  return { ok: true, businessId: business.id }
}
