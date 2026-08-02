import type { SupabaseClient } from "@supabase/supabase-js"

let cachedUserId: string | null = null
let cachedIsFirmUser: boolean | null = null
let inflight: Promise<boolean> | null = null

/** Test-only reset */
export function clearAccountantFirmUserSessionCache(): void {
  cachedUserId = null
  cachedIsFirmUser = null
  inflight = null
}

/**
 * Session-scoped cache: one accounting_firm_users lookup per authenticated user
 * until logout or user identity change.
 */
export async function resolveIsAccountantFirmUser(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  if (cachedUserId === userId && cachedIsFirmUser !== null) {
    return cachedIsFirmUser
  }

  if (cachedUserId !== userId) {
    cachedUserId = userId
    cachedIsFirmUser = null
    inflight = null
  }

  if (inflight) {
    return inflight
  }

  inflight = (async () => {
    const { data: firmUsers } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("user_id", userId)
      .limit(1)

    const isFirm = !!(firmUsers && firmUsers.length > 0)
    cachedIsFirmUser = isFirm
    return isFirm
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}
