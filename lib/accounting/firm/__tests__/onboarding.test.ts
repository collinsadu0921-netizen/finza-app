import { checkFirmOnboardingForAction } from "../onboarding"

describe("checkFirmOnboardingForAction", () => {
  it("blocks action when onboarding status cannot be read", async () => {
    const supabase = {
      from: jest.fn(() => {
        throw new Error("connection lost")
      }),
    } as never

    const result = await checkFirmOnboardingForAction(supabase, "user-1", null, "firm-1")
    expect(result.isComplete).toBe(false)
    expect(result.error).toMatch(/Firm onboarding must be completed/)
  })

  it("fails closed when firm membership lookup throws", async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "accounting_firm_users") {
          return {
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.reject(new Error("db down")),
                }),
              }),
            }),
          }
        }
        throw new Error("unexpected table")
      }),
    } as never

    const result = await checkFirmOnboardingForAction(supabase, "user-1", null, null)
    expect(result.isComplete).toBe(false)
    expect(result.error).toMatch(/Could not verify firm onboarding/)
  })

  it("returns incomplete when onboarding status is not completed", async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "accounting_firms") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { onboarding_status: "pending" }, error: null }),
              }),
            }),
          }
        }
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }
      }),
    } as never

    const result = await checkFirmOnboardingForAction(supabase, "user-1", null, "firm-1")
    expect(result.isComplete).toBe(false)
    expect(result.error).toMatch(/Firm onboarding must be completed/)
  })
})
