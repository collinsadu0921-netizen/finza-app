/**
 * Staging-only recipient gate. Production returns immediately and is unchanged.
 * Error codes never include the recipient address.
 */

export type EmailEnv = Record<string, string | undefined>

export type StagingEmailDecision =
  | { deliver: true }
  | { deliver: false; code: "staging_email_disabled" | "staging_email_recipient_not_allowlisted" | "staging_email_mode_invalid" }

export function decideStagingEmailDelivery(env: EmailEnv, recipient: string | undefined): StagingEmailDecision {
  if (env.FINZA_DEPLOYMENT_ENV !== "staging") return { deliver: true }

  const mode = (env.FINZA_STAGING_EMAIL_MODE || "").trim()
  if (mode === "disabled") return { deliver: false, code: "staging_email_disabled" }
  if (mode !== "allowlist") return { deliver: false, code: "staging_email_mode_invalid" }

  const allowed = (env.FINZA_STAGING_EMAIL_ALLOWLIST || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.includes("@") && item !== "*" && !item.startsWith("@"))
  const target = (recipient || "").trim().toLowerCase()
  if (!target || !allowed.includes(target)) {
    return { deliver: false, code: "staging_email_recipient_not_allowlisted" }
  }
  return { deliver: true }
}
