import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Resolve auth.users id by email by paging through Admin listUsers.
 * A bare listUsers() call only returns the first page (often ~50–1000 users),
 * so team invite flows that only scan that page miss existing accounts.
 */
export async function findAuthUserIdByEmail(
  admin: SupabaseClient,
  email: string
): Promise<string | null> {
  const needle = email.trim().toLowerCase()
  if (!needle) return null

  const perPage = 1000
  const maxPages = 200
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) {
      console.error("findAuthUserIdByEmail: listUsers failed:", error.message)
      return null
    }
    const users = data.users ?? []
    const hit = users.find((u) => (u.email ?? "").trim().toLowerCase() === needle)
    if (hit?.id) return hit.id
    if (users.length < perPage) break
  }
  return null
}

export function isLikelyDuplicateAuthUserError(message: string | undefined): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return (
    m.includes("already") ||
    m.includes("registered") ||
    m.includes("exists") ||
    m.includes("duplicate") ||
    m.includes("unique") ||
    m.includes("been taken")
  )
}
