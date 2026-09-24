import { resolvePostAuthDestination } from "../resolvePostAuthDestination"
import {
  SIGNUP_INTENT_PRACTICE,
  SIGNUP_INTENT_RETAIL_INVITATION,
  SIGNUP_INTENT_SERVICE,
  PRACTICE_HOME_PATH,
} from "../signupWorkspace"

describe("resolvePostAuthDestination", () => {
  it("Practice intent with no firm → firm setup even when Service businesses exist", () => {
    expect(
      resolvePostAuthDestination({
        signupIntent: SIGNUP_INTENT_PRACTICE,
        hasFirmMembership: false,
        ownedBusinesses: [{ id: "b1", industry: "service" }],
        membershipRows: [],
        trialIntent: false,
        trialWorkspace: null,
        trialPlan: null,
      })
    ).toBe("/accounting/firm/setup")
  })

  it("Practice intent with completed firm → dashboard", () => {
    expect(
      resolvePostAuthDestination({
        signupIntent: SIGNUP_INTENT_PRACTICE,
        hasFirmMembership: true,
        firmOnboardingComplete: true,
        ownedBusinesses: [{ id: "b1", industry: "service" }],
        membershipRows: [],
        trialIntent: false,
        trialWorkspace: null,
        trialPlan: null,
      })
    ).toBe(PRACTICE_HOME_PATH)
  })

  it("Service intent with one business → service dashboard", () => {
    expect(
      resolvePostAuthDestination({
        signupIntent: SIGNUP_INTENT_SERVICE,
        hasFirmMembership: false,
        ownedBusinesses: [{ id: "b1", industry: "service" }],
        membershipRows: [],
        trialIntent: false,
        trialWorkspace: null,
        trialPlan: null,
      })
    ).toBe("/service/dashboard")
  })

  it("Service intent with no businesses and trial → business-setup", () => {
    expect(
      resolvePostAuthDestination({
        signupIntent: SIGNUP_INTENT_SERVICE,
        hasFirmMembership: false,
        ownedBusinesses: [],
        membershipRows: [],
        trialIntent: true,
        trialWorkspace: "service",
        trialPlan: "starter",
      })
    ).toBe("/business-setup")
  })

  it("Service intent with firm membership and no businesses → Practice dashboard", () => {
    expect(
      resolvePostAuthDestination({
        signupIntent: SIGNUP_INTENT_SERVICE,
        hasFirmMembership: true,
        firmOnboardingComplete: true,
        ownedBusinesses: [],
        membershipRows: [],
        trialIntent: false,
        trialWorkspace: null,
        trialPlan: null,
      })
    ).toBe(PRACTICE_HOME_PATH)
  })

  it("existing business_owner with a pending Retail invitation opens Retail acceptance", () => {
    expect(
      resolvePostAuthDestination({
        signupIntent: SIGNUP_INTENT_SERVICE,
        hasFirmMembership: false,
        ownedBusinesses: [],
        membershipRows: [],
        trialIntent: false,
        trialWorkspace: null,
        trialPlan: null,
        hasPendingRetailInvitation: true,
      })
    ).toBe("/retail/invite/resume")
  })

  it("business_owner with no pending Retail invitation still opens Service setup", () => {
    expect(
      resolvePostAuthDestination({
        signupIntent: SIGNUP_INTENT_SERVICE,
        hasFirmMembership: false,
        ownedBusinesses: [],
        membershipRows: [],
        trialIntent: false,
        trialWorkspace: null,
        trialPlan: null,
        hasPendingRetailInvitation: false,
      })
    ).toBe("/business-setup")
  })

  it("Retail invitation with no businesses stays off Service setup", () => {
    expect(
      resolvePostAuthDestination({
        signupIntent: SIGNUP_INTENT_RETAIL_INVITATION,
        hasFirmMembership: false,
        ownedBusinesses: [],
        membershipRows: [],
        trialIntent: false,
        trialWorkspace: null,
        trialPlan: null,
      })
    ).toBe("/retail/invite/resume")
  })

  it("Retail invitation with an existing Service business keeps that dashboard", () => {
    expect(
      resolvePostAuthDestination({
        signupIntent: SIGNUP_INTENT_RETAIL_INVITATION,
        hasFirmMembership: false,
        ownedBusinesses: [{ id: "b1", industry: "service" }],
        membershipRows: [],
        trialIntent: false,
        trialWorkspace: null,
        trialPlan: null,
      })
    ).toBe("/service/dashboard")
  })

  it("Service intent with no businesses → business-setup", () => {
    expect(
      resolvePostAuthDestination({
        signupIntent: SIGNUP_INTENT_SERVICE,
        hasFirmMembership: false,
        ownedBusinesses: [],
        membershipRows: [],
        trialIntent: false,
        trialWorkspace: null,
        trialPlan: null,
      })
    ).toBe("/business-setup")
  })
})
