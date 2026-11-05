import {
  buildPaystackRecipientInput,
  destinationFingerprint,
  normalizeGhanaMomoNumber,
  normalizeGhanaMomoProvider,
  resolvePaystackDestination,
} from "@/lib/payroll/paystack/destination"

const bankItem = {
  destination_method_type: "bank",
  destination_bank_name: "GCB Bank",
  destination_bank_code: "GH050100",
  destination_account_number: "1234567890",
  destination_account_name: "Ama Mensah",
}

const momoItem = {
  destination_method_type: "momo",
  destination_momo_provider: "MTN",
  destination_momo_number: "0241234567",
  destination_account_name: "Ama Mensah",
}

describe("Paystack payout destinations", () => {
  it("resolves a Ghana bank account to a ghipss recipient", () => {
    const resolved = resolvePaystackDestination({
      businessId: "biz-1",
      staffId: "staff-1",
      destination: bankItem,
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.type).toBe("ghipss")
    expect(resolved.bank_code).toBe("GH050100")
    expect(resolved.account_number).toBe("1234567890")
    expect(buildPaystackRecipientInput(resolved)).toEqual(
      expect.objectContaining({
        type: "ghipss",
        name: "Ama Mensah",
        account_number: "1234567890",
        bank_code: "GH050100",
        currency: "GHS",
      })
    )
  })

  it("resolves MTN Mobile Money and normalizes the number", () => {
    expect(normalizeGhanaMomoProvider("MTN")).toEqual({ code: "MTN", label: "MTN Mobile Money" })
    expect(normalizeGhanaMomoProvider("Telecel")).toEqual({
      code: "VOD",
      label: "Telecel Cash (Vodafone)",
    })
    expect(normalizeGhanaMomoProvider("AirtelTigo")).toEqual({
      code: "ATL",
      label: "AirtelTigo Money",
    })
    expect(normalizeGhanaMomoNumber("+233 24 123 4567")).toBe("0241234567")
    expect(normalizeGhanaMomoNumber("233241234567")).toBe("0241234567")

    const resolved = resolvePaystackDestination({
      businessId: "biz-1",
      staffId: "staff-1",
      destination: momoItem,
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.type).toBe("mobile_money")
    expect(buildPaystackRecipientInput(resolved)).toEqual(
      expect.objectContaining({
        type: "mobile_money",
        account_number: "0241234567",
        bank_code: "MTN",
        currency: "GHS",
      })
    )
  })

  it("fails closed when required destination data is missing", () => {
    expect(
      resolvePaystackDestination({
        businessId: "biz-1",
        staffId: "staff-1",
        destination: { ...bankItem, destination_bank_code: null },
      })
    ).toEqual(expect.objectContaining({ ok: false, code: "PAYSTACK_DESTINATION_BANK_CODE_MISSING" }))

    expect(
      resolvePaystackDestination({
        businessId: "biz-1",
        staffId: "staff-1",
        destination: { ...momoItem, destination_account_name: null },
      })
    ).toEqual(expect.objectContaining({ ok: false, code: "PAYSTACK_DESTINATION_ACCOUNT_NAME_MISSING" }))

    expect(
      resolvePaystackDestination({
        businessId: "biz-1",
        staffId: "staff-1",
        destination: { destination_method_type: "cash" },
      })
    ).toEqual(expect.objectContaining({ ok: false, code: "PAYSTACK_DESTINATION_UNSUPPORTED" }))
  })

  it("uses a stable tenant/staff/destination fingerprint", () => {
    const base = {
      business_id: "biz-1",
      staff_id: "staff-1",
      method_type: "bank",
      bank_code: "GH050100",
      account_number: "1234567890",
      account_name: "Ama Mensah",
    }
    expect(destinationFingerprint(base)).toBe(destinationFingerprint({ ...base }))
    expect(destinationFingerprint(base)).not.toBe(
      destinationFingerprint({ ...base, account_number: "0987654321" })
    )
  })
})
