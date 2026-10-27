import type { SupabaseClient } from "@supabase/supabase-js"

export type ResolvedAuditActor = {
  id: string
  name: string | null
  email: string | null
  /** Name when available, otherwise email. Null when neither is available. */
  label: string | null
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Resolve display labels for actors that already appear on records the caller
 * is authorized to view.
 *
 * Scope rules:
 * - `business_users` is queried only for the supplied business.
 * - `public.users` is queried only for the exact actor IDs supplied.
 * - No unrestricted auth-admin user listing is performed.
 *
 * Callers must pass only actor IDs taken from business-scoped drafts or audit
 * rows. This function does not verify authorization itself.
 */
export async function resolveAuditActors(
  admin: SupabaseClient,
  businessId: string,
  userIds: Array<string | null | undefined>
): Promise<Map<string, ResolvedAuditActor>> {
  const ids = [
    ...new Set(
      userIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0
      )
    ),
  ]
  const resolved = new Map<string, ResolvedAuditActor>()

  if (ids.length === 0) return resolved

  const [membersResult, usersResult] = await Promise.all([
    admin
      .from("business_users")
      .select("user_id,display_name,email")
      .eq("business_id", businessId)
      .in("user_id", ids),
    admin.from("users").select("id,full_name,email").in("id", ids),
  ])

  const members = new Map<string, { display_name: string | null; email: string | null }>()
  for (const row of membersResult.data ?? []) {
    const userId = typeof row.user_id === "string" ? row.user_id : null
    if (!userId) continue
    members.set(userId, {
      display_name: clean(row.display_name),
      email: clean(row.email),
    })
  }

  const users = new Map<string, { full_name: string | null; email: string | null }>()
  for (const row of usersResult.data ?? []) {
    const userId = typeof row.id === "string" ? row.id : null
    if (!userId) continue
    users.set(userId, {
      full_name: clean(row.full_name),
      email: clean(row.email),
    })
  }

  for (const id of ids) {
    const member = members.get(id)
    const user = users.get(id)
    const name = member?.display_name ?? user?.full_name ?? null
    const email = member?.email ?? user?.email ?? null
    resolved.set(id, {
      id,
      name,
      email,
      label: name ?? email ?? null,
    })
  }

  return resolved
}
