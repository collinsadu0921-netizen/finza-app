import { toLegacyHubtelSettings, toLegacyMomoSettings } from "../legacySync"

describe("toLegacyMomoSettings", () => {
  it("maps canonical fields to businesses.momo_settings shape", () => {
    expect(
      toLegacyMomoSettings({
        api_user: "  u1 ",
        callback_url: " https://cb ",
        api_key: " k1 ",
        primary_subscription_key: " pk1 ",
      })
    ).toEqual({
      api_user: "u1",
      api_key: "k1",
      primary_key: "pk1",
      callback_url: "https://cb",
    })
  })
})

describe("toLegacyHubtelSettings", () => {
  it("maps api_secret to legacy secret field", () => {
    expect(
      toLegacyHubtelSettings({
        pos_key: " pos ",
        api_secret: " sec ",
        merchant_account_number: " m ",
      })
    ).toEqual({
      pos_key: "pos",
      secret: "sec",
      merchant_account_number: "m",
    })
  })
})
