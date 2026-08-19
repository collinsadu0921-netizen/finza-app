import {
  isPracticeSignupIntent,
  PRACTICE_HOME_PATH,
  resolvePracticePostAuthPath,
  SERVICE_BUSINESS_SETUP_PATH,
  SIGNUP_INTENT_SERVICE,
} from "@/lib/auth/signupWorkspace"
import {
  mergeAccessibleBusinesses,
  resolveBusinessDashboardRedirect,
  type AuthCallbackAccessibleBusiness,
  type AuthCallbackMembershipRow,
} from "@/lib/auth/callbackPostAuthRouting"

export type PostAuthDestinationInput = {
  signupIntent: string | undefined | null
  hasFirmMembership: boolean
  firmOnboardingComplete?: boolean
  ownedBusinesses: AuthCallbackAccessibleBusiness[]
  membershipRows: AuthCallbackMembershipRow[]
  trialIntent: boolean
  trialWorkspace: string | null
  trialPlan: string | null
}

/**
 * Deterministic post-auth landing path.
 *
 * Precedence:
 * 1. Practice signup intent → Practice setup / onboarding / dashboard (even if Service businesses exist)
 * 2. Service trial intent with no businesses → business-setup
 * 3. Existing accessible businesses → Service/Retail dashboards or workspace selector
 * 4. Default → business-setup
 */
export function resolvePostAuthDestination(input: PostAuthDestinationInput): string {
  const signupIntent = input.signupIntent ?? SIGNUP_INTENT_SERVICE

  if (isPracticeSignupIntent(signupIntent)) {
    return resolvePracticePostAuthPath({
      hasFirmMembership: input.hasFirmMembership,
      onboardingComplete: input.firmOnboardingComplete,
    })
  }

  const businesses = mergeAccessibleBusinesses(input.ownedBusinesses, input.membershipRows)

  if (businesses.length > 0) {
    return resolveBusinessDashboardRedirect(businesses, false)
  }

  if (input.trialIntent && input.trialWorkspace === "service" && input.trialPlan) {
    return SERVICE_BUSINESS_SETUP_PATH
  }

  return SERVICE_BUSINESS_SETUP_PATH
}

/** Practice users with completed onboarding should land on the modern dashboard. */
export function practiceHomeWhenReady(onboardingComplete: boolean | undefined): string {
  if (onboardingComplete === false) return resolvePracticePostAuthPath({ hasFirmMembership: true, onboardingComplete: false })
  return PRACTICE_HOME_PATH
}
