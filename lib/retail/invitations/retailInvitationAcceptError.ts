/**
 * Public responses for Retail invitation acceptance.
 * Invalid, expired, and wrong-email invitations stay specific.
 * Database and profile-setup failures stay generic and do not echo SQL text.
 */

export function retailInvitationPublicError(message: string): { error: string; status: number } {
  const text = message.toLowerCase()
  if (text.includes("email_mismatch")) {
    return { error: "This signed-in account does not match the invitation.", status: 403 }
  }
  if (text.includes("expired")) {
    return { error: "This invitation has expired.", status: 410 }
  }
  if (text.includes("not_pending") || text.includes("race") || text.includes("revoked")) {
    return { error: "This invitation can no longer be used.", status: 409 }
  }
  if (isRetailInvitationSetupFailure(text)) {
    return {
      error: "We could not finish setting up this account. Please try again.",
      status: 500,
    }
  }
  if (text.includes("retail_invitation_invalid") || text.includes("invalid")) {
    return { error: "This invitation link is not valid.", status: 400 }
  }
  return {
    error: "We could not finish setting up this account. Please try again.",
    status: 500,
  }
}

function isRetailInvitationSetupFailure(text: string): boolean {
  return (
    text.includes("profile_setup") ||
    text.includes("violat") ||
    text.includes("constraint") ||
    text.includes("duplicate key") ||
    text.includes("foreign key") ||
    text.includes("23503") ||
    text.includes("23505")
  )
}
