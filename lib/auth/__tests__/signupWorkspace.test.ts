import {
  parseSignupWorkspaceParam,
  signupIntentForNewAccount,
  signupIntentForWorkspace,
  SIGNUP_INTENT_RETAIL_INVITATION,
  resolveImmediatePostSignupPath,
  resolvePracticePostAuthPath,
  SIGNUP_INTENT_PRACTICE,
  SIGNUP_INTENT_SERVICE,
  PRACTICE_HOME_PATH,
} from "../signupWorkspace"

describe("signupWorkspace", () => {
  describe("parseSignupWorkspaceParam", () => {
    it("parses service and practice", () => {
      expect(parseSignupWorkspaceParam("service")).toBe("service")
      expect(parseSignupWorkspaceParam("practice")).toBe("practice")
    })

    it("accepts practice aliases", () => {
      expect(parseSignupWorkspaceParam("accounting")).toBe("practice")
      expect(parseSignupWorkspaceParam("accountant")).toBe("practice")
      expect(parseSignupWorkspaceParam("firm")).toBe("practice")
    })

    it("returns null for invalid or empty", () => {
      expect(parseSignupWorkspaceParam("")).toBeNull()
      expect(parseSignupWorkspaceParam("retail")).toBeNull()
    })
  })

  describe("signupIntentForWorkspace", () => {
    it("maps practice to accounting_firm", () => {
      expect(signupIntentForWorkspace("practice")).toBe(SIGNUP_INTENT_PRACTICE)
    })

    it("maps service to business_owner", () => {
      expect(signupIntentForWorkspace("service")).toBe(SIGNUP_INTENT_SERVICE)
    })
  })

  describe("signupIntentForNewAccount", () => {
    it("uses the Retail invitation intent instead of Service", () => {
      expect(signupIntentForNewAccount({ retailInvitation: true, workspace: null })).toBe(
        SIGNUP_INTENT_RETAIL_INVITATION
      )
      expect(signupIntentForNewAccount({ retailInvitation: true, workspace: "service" })).toBe(
        SIGNUP_INTENT_RETAIL_INVITATION
      )
    })

    it("keeps Service and Practice when there is no Retail invitation", () => {
      expect(signupIntentForNewAccount({ retailInvitation: false, workspace: null })).toBe(SIGNUP_INTENT_SERVICE)
      expect(signupIntentForNewAccount({ retailInvitation: false, workspace: "service" })).toBe(SIGNUP_INTENT_SERVICE)
      expect(signupIntentForNewAccount({ retailInvitation: false, workspace: "practice" })).toBe(SIGNUP_INTENT_PRACTICE)
    })
  })

  describe("resolveImmediatePostSignupPath", () => {
    it("routes practice to firm setup", () => {
      expect(resolveImmediatePostSignupPath(SIGNUP_INTENT_PRACTICE)).toBe("/accounting/firm/setup")
    })

    it("routes service to business-setup", () => {
      expect(resolveImmediatePostSignupPath(SIGNUP_INTENT_SERVICE)).toBe("/business-setup")
    })
  })

  describe("resolvePracticePostAuthPath", () => {
    it("no firm → setup", () => {
      expect(resolvePracticePostAuthPath({ hasFirmMembership: false })).toBe("/accounting/firm/setup")
    })

    it("firm incomplete onboarding → onboarding page", () => {
      expect(
        resolvePracticePostAuthPath({ hasFirmMembership: true, onboardingComplete: false })
      ).toBe("/accounting/firm/onboarding")
    })

    it("firm complete → dashboard", () => {
      expect(
        resolvePracticePostAuthPath({ hasFirmMembership: true, onboardingComplete: true })
      ).toBe(PRACTICE_HOME_PATH)
    })
  })
})
