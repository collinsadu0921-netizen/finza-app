/**
 * Public signup workspace selection (Service vs Finza Practice).
 * URL canonical value: `service` | `practice` → maps to auth signup_intent.
 */

export type SignupWorkspaceChoice = "service" | "practice"

export const SIGNUP_INTENT_SERVICE = "business_owner" as const
export const SIGNUP_INTENT_PRACTICE = "accounting_firm" as const

export type SignupIntent = typeof SIGNUP_INTENT_SERVICE | typeof SIGNUP_INTENT_PRACTICE

const PRACTICE_ALIASES = new Set(["practice", "accounting", "accountant", "firm"])

/** Parse URL/workspace param into a canonical signup workspace choice, or null if unset/invalid. */
export function parseSignupWorkspaceParam(raw: string | null | undefined): SignupWorkspaceChoice | null {
  const normalized = (raw ?? "").trim().toLowerCase()
  if (normalized === "service") return "service"
  if (PRACTICE_ALIASES.has(normalized)) return "practice"
  return null
}

export function isPracticeWorkspaceParam(raw: string | null | undefined): boolean {
  return parseSignupWorkspaceParam(raw) === "practice"
}

export function signupIntentForWorkspace(workspace: SignupWorkspaceChoice): SignupIntent {
  return workspace === "practice" ? SIGNUP_INTENT_PRACTICE : SIGNUP_INTENT_SERVICE
}

export function isPracticeSignupIntent(intent: string | null | undefined): boolean {
  return intent === SIGNUP_INTENT_PRACTICE
}

/** Canonical Practice home after onboarding. */
export const PRACTICE_HOME_PATH = "/accounting/dashboard"

export const PRACTICE_FIRM_SETUP_PATH = "/accounting/firm/setup"

export const PRACTICE_FIRM_ONBOARDING_PATH = "/accounting/firm/onboarding"

export const SERVICE_BUSINESS_SETUP_PATH = "/business-setup"

/**
 * Post-auth destination for a Practice user based on firm membership and onboarding.
 */
export function resolvePracticePostAuthPath(opts: {
  hasFirmMembership: boolean
  onboardingComplete?: boolean
}): string {
  if (!opts.hasFirmMembership) return PRACTICE_FIRM_SETUP_PATH
  if (opts.onboardingComplete === false) return PRACTICE_FIRM_ONBOARDING_PATH
  return PRACTICE_HOME_PATH
}

/** Immediate post-email-signup destination when a session exists (no confirmation email). */
export function resolveImmediatePostSignupPath(signupIntent: SignupIntent): string {
  return signupIntent === SIGNUP_INTENT_PRACTICE
    ? PRACTICE_FIRM_SETUP_PATH
    : SERVICE_BUSINESS_SETUP_PATH
}
