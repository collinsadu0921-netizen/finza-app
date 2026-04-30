import type { User } from "@supabase/supabase-js"

/**
 * Founder-only access for Akwasi and `/founder/*` internal routes.
 *
 * Access is granted when **any** of the following is true:
 *
 * 1. **FINZA_FOUNDER_USER_ID** (recommended): server env set to the Supabase `auth.users.id`
 *    UUID of the Finza founder. Compared to `user.id`.
 *
 * 2. **JWT app_metadata** (optional): Supabase Auth → set `app_metadata.finza_platform_owner === true`
 *    for the founder user (via Dashboard SQL or an Auth hook). This repo does not ship a separate
 *    "platform admin role" helper elsewhere; tenant roles (`owner`, `admin` on `business_users`)
 *    are business-scoped and are intentionally NOT used here.
 */
export function isFinzaFounderAccess(user: User | null | undefined): boolean {
  if (!user?.id) return false

  const envFounderId = process.env.FINZA_FOUNDER_USER_ID?.trim()
  if (envFounderId && envFounderId === user.id) return true

  const meta = user.app_metadata as Record<string, unknown> | undefined
  if (meta?.finza_platform_owner === true) return true

  return false
}
