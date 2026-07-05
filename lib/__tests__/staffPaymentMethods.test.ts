import {
  normalizeMethodType,
  validateStaffPaymentMethodCreate,
  resolveNetSalaryExportPayoutFields,
} from "@/lib/staffPaymentMethods"

describe("normalizeMethodType", () => {
  it("accepts canonical method types", () => {
    expect(normalizeMethodType("BANK")).toBe("bank")
    expect(normalizeMethodType("MoMo")).toBe("momo")
    expect(normalizeMethodType("cash")).toBe("cash")
  })
  it("rejects unknown", () => {
    expect(normalizeMethodType("stripe")).toBeNull()
  })
})

describe("validateStaffPaymentMethodCreate", () => {
  it("requires bank name and account number for bank", () => {
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "bank",
        bank_name: "",
        account_number: "123",
      }).ok
    ).toBe(false)
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "bank",
        bank_name: "GCB",
        account_number: "",
      }).ok
    ).toBe(false)
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "bank",
        bank_name: "GCB",
        account_number: "999",
      }).ok
    ).toBe(true)
  })

  it("requires MoMo provider and number for momo", () => {
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "momo",
        momo_provider: "",
        momo_number: "02",
      }).ok
    ).toBe(false)
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "momo",
        momo_provider: "MTN",
        momo_number: "",
      }).ok
    ).toBe(false)
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "momo",
        momo_provider: "MTN",
        momo_number: "024xxx",
      }).ok
    ).toBe(true)
  })

  it("allows cash without payout details", () => {
    const r = validateStaffPaymentMethodCreate({ method_type: "cash" })
    expect(r.ok).toBe(true)
  })
})

describe("resolveNetSalaryExportPayoutFields", () => {
  const legacy = { bank_name: "Legacy Bank", bank_account: "111", phone: "0550000000" }

  it("falls back to legacy staff bank when no default method", () => {
    const r = resolveNetSalaryExportPayoutFields(legacy, null)
    expect(r.bankName).toBe("Legacy Bank")
    expect(r.bankAccountNumber).toBe("111")
    expect(r.accountName).toBe("")
    expect(r.momoProvider).toBe("")
    expect(r.momoNumber).toBe("0550000000")
  })

  it("prefers default bank payment method over legacy staff fields", () => {
    const r = resolveNetSalaryExportPayoutFields(
      { bank_name: "Legacy Bank", bank_account: "111", phone: "" },
      {
        method_type: "bank",
        bank_name: "Stanbic",
        account_number: "222",
        account_name: "Jane Doe",
      }
    )
    expect(r.bankName).toBe("Stanbic")
    expect(r.bankAccountNumber).toBe("222")
    expect(r.accountName).toBe("Jane Doe")
    expect(r.momoProvider).toBe("")
    expect(r.momoNumber).toBe("")
  })

  it("uses default MoMo method and leaves bank columns empty", () => {
    const r = resolveNetSalaryExportPayoutFields(
      { bank_name: "Legacy Bank", bank_account: "111", phone: "055" },
      {
        method_type: "momo",
        momo_provider: "MTN",
        momo_number: "024",
        account_name: "Kwame Mensah",
      }
    )
    expect(r.bankName).toBe("")
    expect(r.bankAccountNumber).toBe("")
    expect(r.momoProvider).toBe("MTN")
    expect(r.momoNumber).toBe("024")
    expect(r.accountName).toBe("Kwame Mensah")
  })

  it("fills MoMo number from legacy phone when method number empty", () => {
    const r = resolveNetSalaryExportPayoutFields(
      { bank_name: "", bank_account: "", phone: "055999" },
      {
        method_type: "momo",
        momo_provider: "Vodafone",
        momo_number: "",
      }
    )
    expect(r.momoNumber).toBe("055999")
  })
})
