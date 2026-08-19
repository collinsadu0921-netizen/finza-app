import { createHash, randomBytes } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

export const PRACTICE_STAFF_ROLES = ["partner", "senior", "junior", "readonly"] as const
export type PracticeStaffRole = (typeof PRACTICE_STAFF_ROLES)[number]

export const INVITATION_EXPIRY_DAYS = 7

export const INVITATION_SESSION_KEY = "finza_practice_invitation_token"

export type StaffInvitationStatus = "pending" | "accepted" | "revoked" | "expired"

export type SafeStaffInvitation = {
  id: string
  firm_id: string
  email_normalized: string
  role: PracticeStaffRole
  status: StaffInvitationStatus
  expires_at: string
  created_at: string
  accepted_at: string | null
  revoked_at: string | null
}

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidPracticeStaffRole(role: string): role is PracticeStaffRole {
  return (PRACTICE_STAFF_ROLES as readonly string[]).includes(role)
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url")
  return { token, tokenHash: hashInvitationToken(token) }
}

export function invitationExpiresAt(from = new Date()): Date {
  const d = new Date(from)
  d.setUTCDate(d.getUTCDate() + INVITATION_EXPIRY_DAYS)
  return d
}

export function practiceStaffRoleLabel(role: PracticeStaffRole): string {
  switch (role) {
    case "partner":
      return "Partner"
    case "senior":
      return "Senior"
    case "junior":
      return "Junior"
    case "readonly":
      return "Readonly"
    default:
      return role
  }
}

export function practiceStaffRoleDescription(role: PracticeStaffRole): string {
  switch (role) {
    case "partner":
      return "Full firm management"
    case "senior":
      return "Client work and review within assigned scope"
    case "junior":
      return "Client work within assigned scope"
    case "readonly":
      return "View access within assigned scope"
    default:
      return ""
  }
}

export function buildInvitationAcceptancePath(token: string): string {
  return `/accounting/invitations/accept?token=${encodeURIComponent(token)}`
}

export function toSafeStaffInvitation(row: Record<string, unknown>): SafeStaffInvitation {
  return {
    id: String(row.id),
    firm_id: String(row.firm_id),
    email_normalized: String(row.email_normalized),
    role: row.role as PracticeStaffRole,
    status: row.status as StaffInvitationStatus,
    expires_at: String(row.expires_at),
    created_at: String(row.created_at),
    accepted_at: row.accepted_at ? String(row.accepted_at) : null,
    revoked_at: row.revoked_at ? String(row.revoked_at) : null,
  }
}

export async function findPendingInvitationByTokenHash(
  admin: SupabaseClient,
  tokenHash: string
) {
  const { data, error } = await admin
    .from("accounting_firm_staff_invitations")
    .select(
      "id, firm_id, email_normalized, role, status, expires_at, accepted_at, revoked_at, accounting_firms(name, onboarding_status)"
    )
    .eq("token_hash", tokenHash)
    .eq("status", "pending")
    .maybeSingle()

  if (error) throw error
  return data
}

export async function isExistingFirmMember(
  supabase: SupabaseClient,
  firmId: string,
  emailNormalized: string
): Promise<boolean> {
  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("id")
    .eq("email", emailNormalized)
    .limit(1)

  if (usersErr) {
    console.error("isExistingFirmMember users lookup:", usersErr)
    return false
  }

  const userId = users?.[0]?.id
  if (!userId) return false

  const { data: member, error: memberErr } = await supabase
    .from("accounting_firm_users")
    .select("id")
    .eq("firm_id", firmId)
    .eq("user_id", userId)
    .maybeSingle()

  if (memberErr) {
    console.error("isExistingFirmMember membership lookup:", memberErr)
    return false
  }

  return !!member?.id
}
