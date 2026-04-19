import type { SupabaseClient } from "@supabase/supabase-js"
import { canEditBusinessWideSensitiveSettings } from "@/lib/retail/retailSensitiveSettingsEditors"
import { getUserRole } from "@/lib/userRoles"

export async function assertBusinessPaymentWriteAccess(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const role = await getUserRole(supabase, userId, businessId)
  if (!canEditBusinessWideSensitiveSettings(role)) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: only business owners and admins can change payment settings.",
    }
  }
  return { ok: true }
}
