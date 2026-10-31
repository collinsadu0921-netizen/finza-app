import {
  normalizeMethodType,
  paymentDestinationKey,
  validateStaffPaymentMethodCreate,
  validateStaffPaymentMethodFields,
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
  it("requires bank name, valid account number and account holder name for bank", () => {
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "bank",
        bank_name: "",
        account_number: "1234567890",
        account_name: "Jane Doe",
      }).ok
    ).toBe(false)
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "bank",
        bank_name: "GCB",
        account_number: "",
        account_name: "Jane Doe",
      }).ok
    ).toBe(false)
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "bank",
        bank_name: "GCB",
        account_number: "999",
        account_name: "Jane Doe",
      }).ok
    ).toBe(false)
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "bank",
        bank_name: "GCB",
        account_number: "1234567890",
        account_name: "",
      }).ok
    ).toBe(false)
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "bank",
        bank_name: "GCB",
        account_number: "1234567890",
        account_name: "Jane Doe",
      }).ok
    ).toBe(true)
  })

  it("requires MoMo provider, valid number and account holder name for momo", () => {
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "momo",
        momo_provider: "",
        momo_number: "0241234567",
        account_name: "Kwame Mensah",
      }).ok
    ).toBe(false)
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "momo",
        momo_provider: "MTN",
        momo_number: "",
        account_name: "Kwame Mensah",
      }).ok
    ).toBe(false)
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "momo",
        momo_provider: "MTN",
        momo_number: "024xxx",
        account_name: "Kwame Mensah",
      }).ok
    ).toBe(false)
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "momo",
        momo_provider: "MTN",
        momo_number: "0241234567",
        account_name: "",
      }).ok
    ).toBe(false)
    expect(
      validateStaffPaymentMethodCreate({
        method_type: "momo",
        momo_provider: "MTN",
        momo_number: "0241234567",
        account_name: "Kwame Mensah",
      }).ok
    ).toBe(true)
  })

  it("accepts +233 and Telecel provider formats", () => {
    const r = validateStaffPaymentMethodCreate({
      method_type: "momo",
      momo_provider: "Telecel",
      momo_number: "+233241234567",
      account_name: "Ama Serwaa",
    })
    expect(r.ok).toBe(true)
  })

  it("can skip destination checks when only updating non-destination fields", () => {
    const r = validateStaffPaymentMethodCreate(
      {
        method_type: "bank",
        bank_name: "Legacy Bank",
        account_number: "BATCH001",
        account_name: null,
      },
      { validateDestination: false, requireAccountName: false }
    )
    expect(r.ok).toBe(true)
  })

  it("allows cash without payout details", () => {
    const r = validateStaffPaymentMethodCreate({ method_type: "cash" })
    expect(r.ok).toBe(true)
  })
})

describe("paymentDestinationKey", () => {
  it("matches identical destinations despite spacing and case", () => {
    const a = paymentDestinationKey({
      method_type: "momo",
      momo_provider: "MTN",
      momo_number: "024 123 4567",
      account_name: "Ama  Serwaa",
    })
    const b = paymentDestinationKey({
      method_type: "MOMO",
      momo_provider: "mtn",
      momo_number: "0241234567",
      account_name: "ama serwaa",
    })
    expect(a).toBe(b)
  })

  it("distinguishes different destinations", () => {
    expect(
      paymentDestinationKey({
        method_type: "bank",
        bank_code: "GH050100",
        account_number: "1234567890",
        account_name: "Ama",
      })
    ).not.toBe(
      paymentDestinationKey({
        method_type: "bank",
        bank_code: "GH050100",
        account_number: "1234567891",
        account_name: "Ama",
      })
    )
  })
})

describe("validateStaffPaymentMethodFields", () => {
  it("returns field-level messages for a missing bank account holder name", () => {
    const result = validateStaffPaymentMethodFields({
      method_type: "bank",
      bank_name: "GCB",
      account_number: "1234567890",
      account_name: "",
    })
    expect(result.ok).toBe(false)
    expect(result.errors.account_name).toContain("account holder")
  })

  it("returns field-level messages for an invalid MoMo number", () => {
    const result = validateStaffPaymentMethodFields({
      method_type: "momo",
      momo_provider: "MTN",
      momo_number: "12345",
      account_name: "Kwame Mensah",
    })
    expect(result.ok).toBe(false)
    expect(result.errors.momo_number).toContain("valid Ghana")
  })

  it("accepts a complete Mobile Money destination", () => {
    const result = validateStaffPaymentMethodFields({
      method_type: "momo",
      momo_provider: "VOD",
      momo_number: "0201234567",
      account_name: "Ama Serwaa",
    })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual({})
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
