import { validateHubtelIntegrationSaveInput } from "../hubtelIntegrationService"

describe("validateHubtelIntegrationSaveInput", () => {
  it("requires Collection Account Number", () => {
    expect(() =>
      validateHubtelIntegrationSaveInput(
        {
          collectionAccountNumber: "",
          environment: "live",
          invoiceCheckoutEnabled: true,
          apiId: "id",
          apiKey: "key",
        },
        null
      )
    ).toThrow(/Collection Account Number/)
  })

  it("requires API ID on first setup", () => {
    expect(() =>
      validateHubtelIntegrationSaveInput(
        {
          collectionAccountNumber: "123456",
          environment: "live",
          invoiceCheckoutEnabled: true,
          apiKey: "key",
        },
        null
      )
    ).toThrow(/API ID/)
  })

  it("requires API Key on first setup", () => {
    expect(() =>
      validateHubtelIntegrationSaveInput(
        {
          collectionAccountNumber: "123456",
          environment: "live",
          invoiceCheckoutEnabled: true,
          apiId: "id",
        },
        null
      )
    ).toThrow(/API Key/)
  })

  it("allows blank API Key when existing key is configured", () => {
    expect(() =>
      validateHubtelIntegrationSaveInput(
        {
          collectionAccountNumber: "123456",
          environment: "live",
          invoiceCheckoutEnabled: true,
          apiId: "new-id",
        },
        { api_id_configured: true, api_key_configured: true }
      )
    ).not.toThrow()
  })

  it("does not mention manual_wallet or MTN in validation errors", () => {
    try {
      validateHubtelIntegrationSaveInput(
        {
          collectionAccountNumber: "",
          environment: "live",
          invoiceCheckoutEnabled: true,
        },
        null
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      expect(msg).not.toMatch(/manual_wallet|MTN|paystack/i)
    }
  })
})

describe("Hubtel integration GET response shape", () => {
  it("safe view fields do not include api_key or secrets", () => {
    const safe = {
      configured: true,
      api_id_configured: true,
      api_key_configured: true,
      collection_account_number: "123456",
      business_display_name: "Acme",
      invoice_checkout_enabled: true,
    }
    const json = JSON.stringify(safe)
    expect(json).not.toContain("key-secret")
    expect(json).not.toContain("super-secret-api-key-value")
  })
})
