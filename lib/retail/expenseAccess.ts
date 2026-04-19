import type { SupabaseClient } from "@supabase/supabase-js"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { hasPermission, type CustomPermissions } from "@/lib/permissions"

export type RetailExpenseBusinessGate =
  | { ok: true; businessId: string; business: Record<string, unknown> }
  | { ok: false; status: number; error: string }

export async function gateRetailExpenseBusiness(
  supabase: SupabaseClient,
  userId: string
): Promise<RetailExpenseBusinessGate> {
  const business = await getCurrentBusiness(supabase, userId)
  if (!business) {
    return { ok: false, status: 404, error: "No store found for your account." }
  }
  if (String(business.industry ?? "").toLowerCase() !== "retail") {
    return {
      ok: false,
      status: 403,
      error: "Store expenses are only available when your active business is a retail store.",
    }
  }
  return { ok: true, businessId: business.id, business: business as unknown as Record<string, unknown> }
}

async function loadCustomPermissions(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<CustomPermissions | null> {
  const { data: buRow } = await supabase
    .from("business_users")
    .select("custom_permissions")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle()
  return (buRow?.custom_permissions as CustomPermissions) ?? null
}

/**
 * Retail expense UI/API permission: cashiers blocked; others need expenses.view / expenses.create.
 */
export async function assertRetailExpenseAction(
  supabase: SupabaseClient,
  userId: string,
  businessId: string,
  action: "view" | "create"
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const role = await getUserRole(supabase, userId, businessId)
  if (!role) {
    return { ok: false, status: 403, error: "You don’t have access to this store." }
  }
  if (role === "cashier") {
    return {
      ok: false,
      status: 403,
      error: "Store expenses aren’t available on cashier access. Ask a manager to record operating costs.",
    }
  }
  if (role === "owner" || role === "admin") {
    return { ok: true }
  }

  const custom = await loadCustomPermissions(supabase, userId, businessId)
  const perm = action === "create" ? "expenses.create" : "expenses.view"
  if (hasPermission(role, custom, perm)) {
    return { ok: true }
  }

  return {
    ok: false,
    status: 403,
    error:
      action === "create"
        ? "You don’t have permission to record expenses for this store."
        : "You don’t have permission to view expenses for this store.",
  }
}
