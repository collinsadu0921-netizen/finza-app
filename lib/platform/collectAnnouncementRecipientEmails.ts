import type { SupabaseClient } from "@supabase/supabase-js"
import type { PlatformAnnouncementAudienceScope } from "@/lib/platform/announcementsTypes"

const PAGE = 300

function isValidEmail(e: string): boolean {
  const t = e.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)
}

function addEmail(set: Set<string>, raw: string | null | undefined) {
  const t = (raw || "").trim().toLowerCase()
  if (t && isValidEmail(t)) set.add(t)
}

/**
 * Resolves recipient emails for a one-shot broadcast by audience_scope.
 * - Business workspaces: business profile email + owner user email (deduped).
 * - accounting_workspace_only: emails of users linked to accounting_firm_users.
 *
 * Scans up to maxBusinessesScan business rows (paged) to avoid unbounded reads.
 */
export async function collectAnnouncementRecipientEmails(
  admin: SupabaseClient,
  audience: PlatformAnnouncementAudienceScope,
  opts?: { maxBusinessesScan?: number }
): Promise<{ emails: string[]; businessesScanned: number; truncated: boolean }> {
  const maxBusinessesScan = Math.max(100, Math.min(opts?.maxBusinessesScan ?? 4000, 50_000))
  const emails = new Set<string>()
  let businessesScanned = 0
  let truncated = false

  if (audience === "accounting_workspace_only") {
    const firmUserIds = new Set<string>()
    for (let offset = 0; ; offset += PAGE) {
      const { data: rows, error } = await admin
        .from("accounting_firm_users")
        .select("user_id")
        .range(offset, offset + PAGE - 1)
      if (error) break
      const chunk = rows ?? []
      if (chunk.length === 0) break
      for (const r of chunk as { user_id: string }[]) {
        if (r.user_id) firmUserIds.add(r.user_id)
      }
      if (chunk.length < PAGE) break
    }
    const ids = [...firmUserIds]
    for (let i = 0; i < ids.length; i += PAGE) {
      const slice = ids.slice(i, i + PAGE)
      const { data: users } = await admin.from("users").select("email").in("id", slice)
      for (const u of users ?? []) addEmail(emails, (u as { email?: string }).email)
    }
    const list = [...emails].sort()
    return { emails: list, businessesScanned: 0, truncated: false }
  }

  for (let offset = 0; businessesScanned < maxBusinessesScan; offset += PAGE) {
    let q = admin
      .from("businesses")
      .select("id, owner_id, email, industry")
      .is("archived_at", null)
      .range(offset, offset + PAGE - 1)

    if (audience === "service_workspace_only") {
      q = q.eq("industry", "service")
    } else if (audience === "retail_workspace_only") {
      q = q.eq("industry", "retail")
    }

    const { data: rows, error } = await q
    if (error) {
      console.error("[collectAnnouncementRecipientEmails]", error)
      break
    }
    const chunk = rows ?? []
    if (chunk.length === 0) break

    businessesScanned += chunk.length
    const ownerIds = [...new Set(chunk.map((r: { owner_id?: string }) => r.owner_id).filter(Boolean))] as string[]

    const ownerEmailById = new Map<string, string>()
    for (let i = 0; i < ownerIds.length; i += PAGE) {
      const slice = ownerIds.slice(i, i + PAGE)
      const { data: users } = await admin.from("users").select("id, email").in("id", slice)
      for (const u of users ?? []) {
        const row = u as { id: string; email?: string | null }
        if (row.id && row.email) ownerEmailById.set(row.id, String(row.email))
      }
    }

    for (const r of chunk as { owner_id?: string; email?: string | null }[]) {
      addEmail(emails, r.email)
      if (r.owner_id) addEmail(emails, ownerEmailById.get(r.owner_id))
    }

    if (chunk.length < PAGE) break
    if (businessesScanned >= maxBusinessesScan) {
      truncated = true
      break
    }
  }

  const list = [...emails].sort()
  return { emails: list, businessesScanned, truncated }
}
