import {
  isServiceManualAccountPostable,
  mapServiceManualRpcError,
  validateServiceManualAccounts,
  validateServiceManualJournalInput,
} from "../manualJournal"

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111"
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222"
const ACCOUNT_FOREIGN = "33333333-3333-4333-8333-333333333333"
const BIZ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const validInput = {
  entry_date: "2026-08-20",
  description: "Accrue unbilled service revenue",
  reference: "ACC-001",
  lines: [
    { account_id: ACCOUNT_A, debit: 100, credit: 0, memo: "Debit" },
    { account_id: ACCOUNT_B, debit: 0, credit: 100, memo: "Credit" },
  ],
}

describe("Service manual journal validation", () => {
  it("accepts a balanced two-line entry", () => {
    const result = validateServiceManualJournalInput(validInput)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.totalDebit).toBe(100)
    expect(result.totalCredit).toBe(100)
    expect(result.reference).toBe("ACC-001")
  })

  it("rejects an unbalanced entry", () => {
    const result = validateServiceManualJournalInput({
      ...validInput,
      lines: [
        { account_id: ACCOUNT_A, debit: 100, credit: 0 },
        { account_id: ACCOUNT_B, debit: 0, credit: 99.99 },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SERVICE_MANUAL_UNBALANCED")
  })

  it("rejects a zero-value line", () => {
    const result = validateServiceManualJournalInput({
      ...validInput,
      lines: [
        { account_id: ACCOUNT_A, debit: 0, credit: 0 },
        { account_id: ACCOUNT_B, debit: 0, credit: 0 },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SERVICE_MANUAL_AMOUNT_INVALID")
  })

  it("rejects a negative amount", () => {
    const result = validateServiceManualJournalInput({
      ...validInput,
      lines: [
        { account_id: ACCOUNT_A, debit: -1, credit: 0 },
        { account_id: ACCOUNT_B, debit: 0, credit: -1 },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SERVICE_MANUAL_AMOUNT_INVALID")
  })

  it("rejects a line with both debit and credit", () => {
    const result = validateServiceManualJournalInput({
      ...validInput,
      lines: [
        { account_id: ACCOUNT_A, debit: 100, credit: 100 },
        { account_id: ACCOUNT_B, debit: 0, credit: 0 },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SERVICE_MANUAL_AMOUNT_INVALID")
  })

  it("rejects fewer than two lines", () => {
    const result = validateServiceManualJournalInput({
      ...validInput,
      lines: [{ account_id: ACCOUNT_A, debit: 100, credit: 0 }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SERVICE_MANUAL_LINES_INVALID")
  })
})

describe("Service manual account validation", () => {
  const account = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: ACCOUNT_A,
    business_id: BIZ,
    code: "5000",
    name: "Cost of Sales",
    type: "expense",
    sub_type: null,
    is_system: true,
    is_postable: true,
    deleted_at: null,
    ...overrides,
  })

  it("accepts active postable accounts for the same business", () => {
    const result = validateServiceManualAccounts({
      businessId: BIZ,
      lines: [
        { account_id: ACCOUNT_A, debit: 100, credit: 0, memo: null },
        { account_id: ACCOUNT_B, debit: 0, credit: 100, memo: null },
      ],
      accounts: [
        account({ id: ACCOUNT_A }),
        account({ id: ACCOUNT_B, code: "4000", name: "Service Revenue", type: "income" }),
      ] as never,
    })
    expect(result.ok).toBe(true)
  })

  it("rejects a foreign-business account", () => {
    const result = validateServiceManualAccounts({
      businessId: BIZ,
      lines: [{ account_id: ACCOUNT_FOREIGN, debit: 100, credit: 0, memo: null }],
      accounts: [account({ id: ACCOUNT_FOREIGN, business_id: "other" })] as never,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SERVICE_MANUAL_ACCOUNT_INVALID")
  })

  it("rejects an inactive account", () => {
    const result = validateServiceManualAccounts({
      businessId: BIZ,
      lines: [{ account_id: ACCOUNT_A, debit: 100, credit: 0, memo: null }],
      accounts: [account({ deleted_at: "2026-01-01T00:00:00Z" })] as never,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SERVICE_MANUAL_ACCOUNT_INACTIVE")
  })

  it("rejects a control account", () => {
    const result = validateServiceManualAccounts({
      businessId: BIZ,
      lines: [{ account_id: ACCOUNT_A, debit: 100, credit: 0, memo: null }],
      accounts: [account({ code: "2100", name: "VAT Payable", type: "liability" })] as never,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SERVICE_MANUAL_ACCOUNT_NOT_POSTABLE")
  })

  it("classifies a system control code as non-postable even if the flag is stale", () => {
    expect(
      isServiceManualAccountPostable(
        {
          business_id: BIZ,
          code: "2100",
          is_system: true,
          is_postable: true,
          deleted_at: null,
        },
        BIZ
      )
    ).toBe(false)
  })
})

describe("Service manual RPC error mapping", () => {
  it("maps permission, period and account errors to clear HTTP responses", () => {
    expect(mapServiceManualRpcError("SERVICE_MANUAL_FORBIDDEN: no").status).toBe(403)
    expect(mapServiceManualRpcError("SERVICE_MANUAL_PERIOD_NOT_OPEN: locked").code).toBe("PERIOD_NOT_OPEN")
    expect(mapServiceManualRpcError("SERVICE_MANUAL_ACCOUNT_INVALID: foreign").code).toBe("ACCOUNT_INVALID")
    expect(mapServiceManualRpcError("SERVICE_MANUAL_UNBALANCED: totals").status).toBe(400)
  })
})
