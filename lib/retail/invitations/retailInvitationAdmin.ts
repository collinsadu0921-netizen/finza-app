import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import { getPlatformAnnouncementBroadcastFrom } from "@/lib/email/platformAnnouncementBroadcast"
import {
  generateRetailInvitationToken,
  hashRetailInvitationToken,
  isPlausibleRetailInviteEmail,
  normalizeRetailInviteEmail,
  retailInvitationExpiresAt,
  buildRetailInvitePath,
} from "@/lib/retail/invitations/retailInvitationToken"

export const RETAIL_INVITATION_PAGE_SIZE_DEFAULT = 20
export const RETAIL_INVITATION_PAGE_SIZE_MAX = 50

const LIST_COLUMNS =
  "id, email_normalized, business_name, token_version, status, expires_at, invited_by_user_id, created_at, updated_at, accepted_at, accepted_by_user_id, accepted_business_id, revoked_at, internal_note, last_email_provider_status, last_email_provider_id, last_email_error, last_email_attempted_at"

export type RetailInvitationStatus = "pending" | "accepted" | "revoked" | "expired"

export type RetailInvitationListRow = {
  id: string
  email_normalized: string
  business_name: string
  token_version: number
  status: RetailInvitationStatus
  expires_at: string
  invited_by_user_id: string
  created_at: string
  updated_at: string
  accepted_at: string | null
  accepted_by_user_id: string | null
  accepted_business_id: string | null
  revoked_at: string | null
  internal_note: string | null
  last_email_provider_status: "accepted" | "rejected" | "not_attempted" | null
  last_email_provider_id: string | null
  last_email_error: string | null
  last_email_attempted_at: string | null
}

export type EmailProviderOutcome =
  | { provider_status: "accepted"; provider_id: string }
  | { provider_status: "rejected"; error: string }
  | { provider_status: "not_attempted"; error: string }

function requestIdOrNull(requestId: string | null | undefined): string | null {
  const trimmed = requestId?.trim()
  return trimmed ? trimmed.slice(0, 200) : null
}

export async function writeRetailOnboardingAudit(
  admin: SupabaseClient,
  input: {
    actorUserId: string | null
    action:
      | "invitation_created"
      | "invitation_email_requested"
      | "invitation_rotated"
      | "invitation_revoked"
      | "invitation_expired"
      | "invitation_accepted"
      | "retail_business_created"
    invitationId?: string | null
    businessId?: string | null
    reason?: string | null
    requestId?: string | null
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  const metadata = input.metadata ?? {}
  const { error } = await admin.from("retail_onboarding_audit_events").insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    invitation_id: input.invitationId ?? null,
    business_id: input.businessId ?? null,
    reason: input.reason ?? null,
    request_id: requestIdOrNull(input.requestId),
    metadata,
  })
  if (error) throw new Error(error.message)
}

/** Marks pending invitations past expires_at as expired. Does not log tokens. */
export async function materializeExpiredRetailInvitations(
  admin: SupabaseClient,
  actorUserId: string | null,
  requestId: string | null
): Promise<number> {
  const nowIso = new Date().toISOString()
  const { data, error } = await admin
    .from("retail_invitations")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lte("expires_at", nowIso)
    .select("id, token_version")
  if (error) throw new Error(error.message)
  const rows = data ?? []
  for (const row of rows) {
    await writeRetailOnboardingAudit(admin, {
      actorUserId,
      action: "invitation_expired",
      invitationId: String(row.id),
      requestId,
      metadata: { token_version: row.token_version },
    })
  }
  return rows.length
}

export async function listRetailInvitations(
  admin: SupabaseClient,
  input: { status: RetailInvitationStatus | "all"; page: number; pageSize: number }
): Promise<{ rows: RetailInvitationListRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page)
  const pageSize = Math.min(RETAIL_INVITATION_PAGE_SIZE_MAX, Math.max(1, input.pageSize))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = admin
    .from("retail_invitations")
    .select(LIST_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
  if (input.status !== "all") query = query.eq("status", input.status)

  const { data, error, count } = await query.range(from, to)
  if (error) throw new Error(error.message)
  return {
    rows: (data ?? []) as RetailInvitationListRow[],
    total: count ?? 0,
    page,
    pageSize,
  }
}

export async function createRetailInvitation(
  admin: SupabaseClient,
  input: {
    email: string
    businessName: string
    note: string | null
    actorUserId: string
    requestId: string | null
    appOrigin: string
  }
): Promise<{ invitation: RetailInvitationListRow; activationUrl: string }> {
  const email = normalizeRetailInviteEmail(input.email)
  if (!isPlausibleRetailInviteEmail(email)) {
    throw new Error("Enter a valid email address.")
  }
  const businessName = input.businessName.trim()
  if (businessName.length < 1 || businessName.length > 200) {
    throw new Error("Business name must be between 1 and 200 characters.")
  }

  const { token, tokenHash } = generateRetailInvitationToken()
  const { data, error } = await admin
    .from("retail_invitations")
    .insert({
      email_normalized: email,
      business_name: businessName,
      token_hash: tokenHash,
      token_version: 1,
      status: "pending",
      expires_at: retailInvitationExpiresAt(),
      invited_by_user_id: input.actorUserId,
      internal_note: input.note?.trim() ? input.note.trim().slice(0, 2000) : null,
      last_email_provider_status: "not_attempted",
    })
    .select(LIST_COLUMNS)
    .single()

  if (error) {
    if (error.code === "23505") {
      throw new Error("A pending invitation already exists for this email. Rotate or revoke it first.")
    }
    throw new Error(error.message)
  }

  await writeRetailOnboardingAudit(admin, {
    actorUserId: input.actorUserId,
    action: "invitation_created",
    invitationId: String(data.id),
    requestId: input.requestId,
    metadata: { token_version: 1 },
  })

  const activationUrl = `${input.appOrigin.replace(/\/$/, "")}${buildRetailInvitePath(token)}`
  return { invitation: data as RetailInvitationListRow, activationUrl }
}

/**
 * Resend rotates the token. The previous link stops working because the raw token cannot be recovered.
 * The old row is revoked and a new pending row is inserted in two writes. If the insert fails, the
 * revoked row remains revoked and no second active token exists.
 */
export async function rotateRetailInvitation(
  admin: SupabaseClient,
  input: { invitationId: string; actorUserId: string; requestId: string | null; appOrigin: string }
): Promise<{ invitation: RetailInvitationListRow; activationUrl: string }> {
  const { data: current, error: loadError } = await admin
    .from("retail_invitations")
    .select("id, email_normalized, business_name, status, internal_note, token_version")
    .eq("id", input.invitationId)
    .maybeSingle()
  if (loadError) throw new Error(loadError.message)
  if (!current) throw new Error("Invitation not found.")
  if (current.status !== "pending") throw new Error("Only a pending invitation can be resent.")

  const revoked = await admin
    .from("retail_invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", current.id)
    .eq("status", "pending")
    .select("id")
  if (revoked.error) throw new Error(revoked.error.message)
  if (!revoked.data || revoked.data.length === 0) {
    throw new Error("This invitation is no longer pending.")
  }

  await writeRetailOnboardingAudit(admin, {
    actorUserId: input.actorUserId,
    action: "invitation_rotated",
    invitationId: String(current.id),
    requestId: input.requestId,
    reason: "resend_rotates_token",
    metadata: { previous_token_version: current.token_version },
  })

  const created = await createRetailInvitation(admin, {
    email: String(current.email_normalized),
    businessName: String(current.business_name),
    note: current.internal_note ? String(current.internal_note) : null,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
    appOrigin: input.appOrigin,
  })

  await writeRetailOnboardingAudit(admin, {
    actorUserId: input.actorUserId,
    action: "invitation_rotated",
    invitationId: created.invitation.id,
    requestId: input.requestId,
    reason: "replacement_for_resend",
    metadata: { replaced_invitation_id: current.id, token_version: created.invitation.token_version },
  })

  return created
}

export async function revokeRetailInvitation(
  admin: SupabaseClient,
  input: { invitationId: string; actorUserId: string; requestId: string | null; confirm: boolean }
): Promise<void> {
  if (!input.confirm) throw new Error("Confirmation is required to revoke an invitation.")
  const { data, error } = await admin
    .from("retail_invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", input.invitationId)
    .eq("status", "pending")
    .select("id, token_version")
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error("Only a pending invitation can be revoked.")
  await writeRetailOnboardingAudit(admin, {
    actorUserId: input.actorUserId,
    action: "invitation_revoked",
    invitationId: input.invitationId,
    requestId: input.requestId,
    metadata: { token_version: data[0].token_version },
  })
}

export async function sendRetailInvitationEmail(
  admin: SupabaseClient,
  input: {
    invitationId: string
    activationUrl: string
    actorUserId: string
    requestId: string | null
  }
): Promise<EmailProviderOutcome> {
  const { data: row, error } = await admin
    .from("retail_invitations")
    .select("id, email_normalized, business_name, status")
    .eq("id", input.invitationId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!row || row.status !== "pending") throw new Error("Only a pending invitation can be emailed.")

  const outcome = await deliverRetailInvitationEmail({
    to: String(row.email_normalized),
    businessName: String(row.business_name),
    activationUrl: input.activationUrl,
  })

  await admin
    .from("retail_invitations")
    .update({
      last_email_provider_status: outcome.provider_status,
      last_email_provider_id: outcome.provider_status === "accepted" ? outcome.provider_id : null,
      last_email_error: outcome.provider_status === "accepted" ? null : outcome.error,
      last_email_attempted_at: new Date().toISOString(),
    })
    .eq("id", row.id)

  await writeRetailOnboardingAudit(admin, {
    actorUserId: input.actorUserId,
    action: "invitation_email_requested",
    invitationId: String(row.id),
    requestId: input.requestId,
    metadata: {
      provider_status: outcome.provider_status,
      provider_id: outcome.provider_status === "accepted" ? outcome.provider_id : null,
    },
  })

  return outcome
}

export async function deliverRetailInvitationEmail(input: {
  to: string
  businessName: string
  activationUrl: string
}): Promise<EmailProviderOutcome> {
  const subject = `Your Finza Retail invitation for ${input.businessName}`
  const text = [
    `Finza invited you to set up ${input.businessName} on Retail.`,
    "",
    "Open this link to sign in or create your account, then confirm the business:",
    input.activationUrl,
    "",
    "This link works once and expires. If you were not expecting it, you can ignore this email.",
  ].join("\n")
  const html = `<p>Finza invited you to set up <strong>${escapeHtml(input.businessName)}</strong> on Retail.</p>
<p><a href="${escapeHtml(input.activationUrl)}">Open your Retail invitation</a></p>
<p>This link works once and expires. The provider accepting this message does not by itself mean it reached the inbox.</p>`

  const result = await sendTransactionalEmail({
    to: input.to,
    subject,
    html,
    text,
    fromOverride: getPlatformAnnouncementBroadcastFrom(),
  })
  if (result.success) {
    return { provider_status: "accepted", provider_id: result.id }
  }
  if (result.reason === "no_api_key") {
    return { provider_status: "not_attempted", error: "Email provider is not configured." }
  }
  return { provider_status: "rejected", error: result.reason }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export type RetailInvitePreview =
  | { state: "ready"; businessName: string | null; emailMatches: boolean | null }
  | { state: "expired" | "revoked" | "accepted" | "invalid" }

export async function previewRetailInvitation(
  admin: SupabaseClient,
  token: string,
  signedInEmail: string | null
): Promise<RetailInvitePreview> {
  const tokenHash = hashRetailInvitationToken(token)
  const { data, error } = await admin
    .from("retail_invitations")
    .select("id, status, expires_at, email_normalized, business_name, token_version")
    .eq("token_hash", tokenHash)
    .maybeSingle()
  if (error || !data) return { state: "invalid" }

  if (data.status === "pending" && new Date(String(data.expires_at)).getTime() <= Date.now()) {
    await admin.from("retail_invitations").update({ status: "expired" }).eq("id", data.id).eq("status", "pending")
    await writeRetailOnboardingAudit(admin, {
      actorUserId: null,
      action: "invitation_expired",
      invitationId: String(data.id),
      metadata: { token_version: data.token_version, source: "preview" },
    })
    return { state: "expired" }
  }

  if (data.status === "expired") return { state: "expired" }
  if (data.status === "revoked") return { state: "revoked" }
  if (data.status === "accepted") return { state: "accepted" }
  if (data.status !== "pending") return { state: "invalid" }

  if (!signedInEmail) {
    return { state: "ready", businessName: null, emailMatches: null }
  }
  const matches = normalizeRetailInviteEmail(signedInEmail) === String(data.email_normalized)
  if (!matches) {
    return { state: "ready", businessName: null, emailMatches: false }
  }
  return { state: "ready", businessName: String(data.business_name), emailMatches: true }
}

export async function pendingRetailInvitationForEmail(
  admin: SupabaseClient,
  email: string
): Promise<{ id: string; businessName: string } | null> {
  const normalized = normalizeRetailInviteEmail(email)
  const { data, error } = await admin
    .from("retail_invitations")
    .select("id, business_name, status, expires_at")
    .eq("email_normalized", normalized)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  if (new Date(String(data.expires_at)).getTime() <= Date.now()) return null
  return { id: String(data.id), businessName: String(data.business_name) }
}

export async function acceptRetailInvitationById(
  admin: SupabaseClient,
  input: { invitationId: string; userId: string; email: string; requestId: string | null }
): Promise<string> {
  const normalized = normalizeRetailInviteEmail(input.email)
  const { data: row, error: readError } = await admin
    .from("retail_invitations")
    .select("token_hash, status, email_normalized")
    .eq("id", input.invitationId)
    .maybeSingle()
  if (readError || !row || row.email_normalized !== normalized || row.status !== "pending") {
    throw new Error("retail_invitation_not_pending")
  }
  const { data, error } = await admin.rpc("accept_retail_invitation", {
    p_token_hash: row.token_hash,
    p_user_id: input.userId,
    p_email_normalized: normalized,
    p_request_id: requestIdOrNull(input.requestId),
  })
  if (error) throw new Error(error.message || "retail_invitation_invalid")
  if (!data || typeof data !== "string") throw new Error("retail_invitation_invalid")
  return data
}

export async function acceptRetailInvitation(
  admin: SupabaseClient,
  input: { token: string; userId: string; email: string; requestId: string | null }
): Promise<string> {
  const tokenHash = hashRetailInvitationToken(input.token)
  const { data, error } = await admin.rpc("accept_retail_invitation", {
    p_token_hash: tokenHash,
    p_user_id: input.userId,
    p_email_normalized: normalizeRetailInviteEmail(input.email),
    p_request_id: requestIdOrNull(input.requestId),
  })
  if (error) {
    const message = error.message || "retail_invitation_invalid"
    throw new Error(message)
  }
  if (!data || typeof data !== "string") {
    throw new Error("retail_invitation_invalid")
  }
  return data
}
