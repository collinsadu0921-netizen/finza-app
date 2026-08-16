import { computeLoanOutstandingFromLedger } from "@/lib/service/accounting/loanOutstanding"
import {
  accountFitsEligibility,
  validateServiceIntent,
  type AccountForValidation,
} from "@/lib/service/accounting/intentTypes"

describe("loanOutstanding subledger", () => {
  it("computes per-loan outstanding independently on shared GL account", () => {
    const loanA = [
      { entry_kind: "drawdown" as const, amount: 100_000 },
      { entry_kind: "repayment" as const, amount: 20_000 },
    ]
    const loanB = [
      { entry_kind: "drawdown" as const, amount: 50_000 },
      { entry_kind: "repayment" as const, amount: 5_000 },
    ]

    expect(computeLoanOutstandingFromLedger(loanA)).toBe(80_000)
    expect(computeLoanOutstandingFromLedger(loanB)).toBe(45_000)
    expect(
      computeLoanOutstandingFromLedger(loanA) +
        computeLoanOutstandingFromLedger(loanB)
    ).toBe(125_000)
  })

  it("handles additional drawdown and reversals", () => {
    const rows = [
      { entry_kind: "drawdown" as const, amount: 100_000 },
      { entry_kind: "drawdown" as const, amount: 10_000 },
      { entry_kind: "repayment" as const, amount: 30_000 },
      { entry_kind: "reversal_repayment" as const, amount: 5_000 },
    ]
    expect(computeLoanOutstandingFromLedger(rows)).toBe(85_000)
  })

  it("never returns negative outstanding", () => {
    expect(
      computeLoanOutstandingFromLedger([
        { entry_kind: "repayment", amount: 50_000 },
      ])
    ).toBe(0)
  })
})

describe("validateServiceIntent loan eligibility", () => {
  const accounts: AccountForValidation[] = [
    { id: "bank", type: "asset", sub_type: "bank" },
    { id: "momo", type: "asset", sub_type: "mobile_money" },
    { id: "loan", type: "liability", sub_type: "loan" },
    { id: "ap", type: "liability", sub_type: "payable" },
    { id: "exp", type: "expense", sub_type: null },
  ]

  it("accepts liability with loan subtype for drawdown", () => {
    const err = validateServiceIntent(
      {
        intent_type: "LOAN_DRAWDOWN",
        entry_date: "2026-01-15",
        amount: 1000,
        bank_or_cash_account_id: "momo",
        loan_account_id: "loan",
      },
      accounts
    )
    expect(err).toBeNull()
  })

  it("rejects accounts payable as loan account", () => {
    const err = validateServiceIntent(
      {
        intent_type: "LOAN_DRAWDOWN",
        entry_date: "2026-01-15",
        amount: 1000,
        bank_or_cash_account_id: "bank",
        loan_account_id: "ap",
      },
      accounts
    )
    expect(err).toMatch(/loan/)
  })

  it("requires loan_id for repayment", () => {
    const err = validateServiceIntent(
      {
        intent_type: "LOAN_REPAYMENT",
        entry_date: "2026-01-15",
        amount: 500,
        bank_or_cash_account_id: "bank",
        loan_account_id: "loan",
        loan_id: "",
      } as any,
      accounts
    )
    expect(err).toMatch(/loan_id/)
  })

  it("accepts mobile money for operational funding", () => {
    expect(
      accountFitsEligibility(
        { id: "momo", type: "asset", sub_type: "mobile_money" },
        { type: "asset", subType: "operational_funding" }
      )
    ).toBe(true)
  })
})
