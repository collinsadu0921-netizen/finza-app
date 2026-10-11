import { decideStagingEmailDelivery } from "../stagingEmailPolicy"

describe("decideStagingEmailDelivery", () => {
  it("does not filter recipients outside staging", () => {
    expect(decideStagingEmailDelivery({ FINZA_DEPLOYMENT_ENV: "production" }, "customer@example.com")).toEqual({
      deliver: true,
    })
    expect(decideStagingEmailDelivery({}, "customer@example.com")).toEqual({ deliver: true })
  })

  it("blocks every recipient when staging email is disabled", () => {
    expect(
      decideStagingEmailDelivery(
        { FINZA_DEPLOYMENT_ENV: "staging", FINZA_STAGING_EMAIL_MODE: "disabled" },
        "customer@example.com"
      )
    ).toEqual({ deliver: false, code: "staging_email_disabled" })
  })

  it("allows only exact allowlisted addresses", () => {
    const env = {
      FINZA_DEPLOYMENT_ENV: "staging",
      FINZA_STAGING_EMAIL_MODE: "allowlist",
      FINZA_STAGING_EMAIL_ALLOWLIST: "Tester@Example.invalid",
    }
    expect(decideStagingEmailDelivery(env, "tester@example.invalid")).toEqual({ deliver: true })
    const blocked = decideStagingEmailDelivery(env, "customer@finza.africa")
    expect(blocked).toEqual({ deliver: false, code: "staging_email_recipient_not_allowlisted" })
    if (!blocked.deliver) expect(blocked.code).not.toContain("customer")
  })

  it("fails closed when staging has no email mode", () => {
    expect(decideStagingEmailDelivery({ FINZA_DEPLOYMENT_ENV: "staging" }, "tester@example.invalid")).toEqual({
      deliver: false,
      code: "staging_email_mode_invalid",
    })
  })
})
