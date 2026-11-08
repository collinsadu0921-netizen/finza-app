import { describe, expect, it, jest } from "@jest/globals"
import { getTaxControlAccountCodes } from "../taxControlAccounts"

function client(options: {
  mappings?: Array<{ control_key: string; account_code: string }>
  accounts?: Array<{ account_code: string; is_active: boolean }>
  mappingError?: { message: string } | null
  accountsError?: { message: string } | null
}) {
  const controlMapEq = jest.fn(() => ({
    in: jest.fn(() =>
      Promise.resolve({
        data: options.mappings ?? [],
        error: options.mappingError ?? null,
      })
    ),
  }))
  const accountsEq = jest.fn(() => ({
    in: jest.fn(() =>
      Promise.resolve({
        data: options.accounts ?? [],
        error: options.accountsError ?? null,
      })
    ),
  }))

  const from = jest.fn((table: string) => {
    if (table === "chart_of_accounts_control_map") {
      return { select: jest.fn(() => ({ eq: controlMapEq })) }
    }
    if (table === "chart_of_accounts") {
      return { select: jest.fn(() => ({ eq: accountsEq })) }
    }
    throw new Error(`unexpected table ${table}`)
  })

  return { supabase: { from } as any, controlMapEq, accountsEq }
}

const allDefaultsActive = [
  { account_code: "2100", is_active: true, account_type: "liability" },
  { account_code: "2110", is_active: true, account_type: "liability" },
  { account_code: "2120", is_active: true, account_type: "liability" },
  { account_code: "2130", is_active: true, account_type: "liability" },
]

describe("getTaxControlAccountCodes", () => {
  it("falls back to the standard 2100-2130 accounts when no mapping exists", async () => {
    const { supabase } = client({ accounts: allDefaultsActive })

    const codes = await getTaxControlAccountCodes(supabase, "biz-1")

    expect(codes).toEqual({
      vat: "2100",
      nhil: "2110",
      getfund: "2120",
      covid: "2130",
    })
  })

  it("honours an explicit mapping instead of the default", async () => {
    const { supabase } = client({
      mappings: [{ control_key: "VAT_PAYABLE", account_code: "2200" }],
      accounts: [...allDefaultsActive, { account_code: "2200", is_active: true, account_type: "liability" }],
    })

    const codes = await getTaxControlAccountCodes(supabase, "biz-1")

    expect(codes.vat).toBe("2200")
    expect(codes.nhil).toBe("2110")
  })

  it("does not silently replace an explicit but inactive mapping", async () => {
    const { supabase } = client({
      mappings: [{ control_key: "VAT_PAYABLE", account_code: "2200" }],
      accounts: [...allDefaultsActive, { account_code: "2200", is_active: false, account_type: "liability" }],
    })

    const codes = await getTaxControlAccountCodes(supabase, "biz-1")

    expect(codes.vat).toBeNull()
    expect(codes.nhil).toBe("2110")
  })

  it("rejects an explicit mapping to a non-liability account", async () => {
    const { supabase } = client({
      mappings: [{ control_key: "VAT_PAYABLE", account_code: "2200" }],
      accounts: [
        ...allDefaultsActive,
        { account_code: "2200", is_active: true, account_type: "asset" },
      ],
    })

    const codes = await getTaxControlAccountCodes(supabase, "biz-1")

    expect(codes.vat).toBeNull()
    expect(codes.nhil).toBe("2110")
  })

  it("returns null when a default account is inactive", async () => {
    const { supabase } = client({
      accounts: [
        { account_code: "2100", is_active: false, account_type: "liability" },
        { account_code: "2110", is_active: true, account_type: "liability" },
        { account_code: "2120", is_active: true, account_type: "liability" },
        { account_code: "2130", is_active: true, account_type: "liability" },
      ],
    })

    const codes = await getTaxControlAccountCodes(supabase, "biz-1")

    expect(codes.vat).toBeNull()
    expect(codes.nhil).toBe("2110")
  })

  it("scopes both queries to the requested business", async () => {
    const { supabase, controlMapEq, accountsEq } = client({
      accounts: allDefaultsActive,
    })

    await getTaxControlAccountCodes(supabase, "biz-1")

    expect(controlMapEq).toHaveBeenCalledWith("business_id", "biz-1")
    expect(accountsEq).toHaveBeenCalledWith("business_id", "biz-1")
  })

  it("throws when the mapping query fails", async () => {
    const { supabase } = client({
      mappingError: { message: "db down" },
    })

    await expect(getTaxControlAccountCodes(supabase, "biz-1")).rejects.toThrow(
      "Failed to fetch tax control account mappings"
    )
  })

  it("throws when account validation fails", async () => {
    const { supabase } = client({
      accountsError: { message: "db down" },
    })

    await expect(getTaxControlAccountCodes(supabase, "biz-1")).rejects.toThrow(
      "Failed to validate tax control accounts"
    )
  })
})

