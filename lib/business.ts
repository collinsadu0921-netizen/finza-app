import { SupabaseClient } from "@supabase/supabase-js"
import {
  requireBusinessScopeForUser,
  resolveBusinessScopeForUser,
  type BusinessScopeDiagnostics,
  type ResolveBusinessScopeOptions,
  type ResolveBusinessScopeResult,
} from "./business/resolveBusinessScope"

export type {
  BusinessScopeDiagnostics,
  ResolveBusinessScopeOptions,
  ResolveBusinessScopeResult,
}

export { requireBusinessScopeForUser, resolveBusinessScopeForUser }

// ─── localStorage helpers (client-side only) ──────────────────────────────────

export const WORKSPACE_STORAGE_KEY = "finza_selected_business_id"
const WORKSPACE_KEY = WORKSPACE_STORAGE_KEY

let lastSyncedBusinessId: string | null | undefined
let activeBusinessSyncChain: Promise<void> = Promise.resolve()

export function getSelectedBusinessId(): string | null {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(WORKSPACE_KEY)
  } catch {
    return null
  }
}

/**
 * Mirror the browser workspace selection into the server-validated
 * active-business cookie. The API verifies ownership/membership before setting
 * the cookie; a forged ID is rejected and does not become server context.
 */
function syncActiveBusinessToServer(id: string | null): void {
  if (typeof window === "undefined") return
  if (lastSyncedBusinessId === id) return
  lastSyncedBusinessId = id

  // Serialize writes so a slow older response cannot overwrite a newer
  // workspace selection in the browser cookie.
  activeBusinessSyncChain = activeBusinessSyncChain
    .catch(() => undefined)
    .then(async () => {
      try {
        const response = await fetch("/api/business/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          keepalive: true,
          body: JSON.stringify(id ? { business_id: id } : { clear: true }),
        })
        if (!response.ok) {
          if (lastSyncedBusinessId === id) lastSyncedBusinessId = undefined
          if (response.status === 403 || response.status === 404) {
            try {
              localStorage.removeItem(WORKSPACE_KEY)
            } catch {}
          }
        }
      } catch {
        if (lastSyncedBusinessId === id) lastSyncedBusinessId = undefined
      }
    })
}

export function setSelectedBusinessId(id: string | null): void {
  if (typeof window === "undefined") return
  try {
    const current = localStorage.getItem(WORKSPACE_KEY)
    if (id) localStorage.setItem(WORKSPACE_KEY, id)
    else localStorage.removeItem(WORKSPACE_KEY)
    if (id !== current) {
      window.dispatchEvent(
        new CustomEvent("finza:business-changed", { detail: { businessId: id } })
      )
    }
    syncActiveBusinessToServer(id)
  } catch {}
}

export function clearSelectedBusinessId(): void {
  setSelectedBusinessId(null)
}

/** Await the server cookie write before navigating into a workspace. */
export async function ensureSelectedBusinessIdSynced(id: string | null): Promise<void> {
  if (lastSyncedBusinessId !== id) syncActiveBusinessToServer(id)
  await activeBusinessSyncChain
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
  // Server-side: use the request-scoped, server-validated active-business
  // cookie via the resolver registered in instrumentation.ts. Never fall back
  // to "newest business" on the server.
  if (typeof window === "undefined") {
    const resolver = (
      globalThis as typeof globalThis & {
        __finzaResolveActiveBusiness?: (
          supabase: SupabaseClient,
          userId: string
        ) => Promise<unknown>
      }
    ).__finzaResolveActiveBusiness

    if (typeof resolver === "function") {
      return (await resolver(supabase, userId)) as Awaited<
        ReturnType<typeof getCurrentBusinessFromClientPreference>
      >
    }

    return null
  }

  return getCurrentBusinessFromClientPreference(supabase, userId)
}

async function getCurrentBusinessFromClientPreference(
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

/**
 * Client-side business resolution for list pages: URL param → localStorage workspace → server fallback.
 */
export async function resolvePreferredBusinessForUser(
  supabase: SupabaseClient,
  userId: string,
  requestedBusinessId?: string | null
): Promise<ResolveBusinessScopeResult> {
  const fromRequest =
    typeof requestedBusinessId === "string" ? requestedBusinessId.trim() : ""
  const fromStorage = getSelectedBusinessId()
  const explicit = fromRequest || fromStorage || null
  return resolveBusinessScopeForUser(supabase, userId, explicit)
}
