import { fetchGeneralLedgerForAccount } from "@/lib/accounting/fetchGeneralLedgerForAccount"
import type { GeneralLedgerAccountRow } from "@/lib/accounting/resolveGeneralLedgerAccount"

describe("general ledger payroll payment references", () => {
  it("enriches payroll_payment lines with the stored provider reference", async () => {
    const account: GeneralLedgerAccountRow = {
      id: "acct-2240",
      code: "2240",
      name: "Net Salaries Payable",
      type: "liability",
    }

    const paymentQuery = {
      select: jest.fn(() => paymentQuery),
      eq: jest.fn(() => paymentQuery),
      in: jest.fn(() => paymentQuery),
      is: jest.fn().mockResolvedValue({
        data: [{ id: "payment-1", reference: "finza-ps-fbaec591573945629e5efc28f00b60e8" }],
        error: null,
      }),
    }

    const supabase = {
      rpc: jest.fn().mockResolvedValue({
        data: [
          {
            entry_date: "2026-10-29",
            journal_entry_id: "journal-1",
            journal_entry_description: "Payroll salary payment - Sep 2026",
            reference_type: "payroll_payment",
            reference_id: "payment-1",
            line_id: "line-1",
            line_description: "Payroll salary disbursement (clear net salaries payable)",
            debit: 900.02,
            credit: 0,
            running_balance: 900.02,
          },
        ],
        error: null,
      }),
      from: jest.fn(() => paymentQuery),
    }

    const block = await fetchGeneralLedgerForAccount(
      supabase as never,
      "biz-1",
      account,
      "2026-10-01",
      "2026-10-31"
    )

    expect(block.lines).toHaveLength(1)
    expect(block.lines[0].payment_reference).toBe(
      "finza-ps-fbaec591573945629e5efc28f00b60e8"
    )
    expect(paymentQuery.in).toHaveBeenCalledWith("id", ["payment-1"])
  })

  it("leaves non-payroll lines without a payment reference and skips the lookup", async () => {
    const account: GeneralLedgerAccountRow = {
      id: "acct-4000",
      code: "4000",
      name: "Service Revenue",
      type: "income",
    }
    const supabase = {
      rpc: jest.fn().mockResolvedValue({
        data: [
          {
            entry_date: "2026-10-05",
            journal_entry_id: "journal-2",
            journal_entry_description: "Invoice",
            reference_type: "invoice",
            reference_id: "invoice-1",
            line_id: "line-2",
            line_description: "Revenue",
            debit: 0,
            credit: 100,
            running_balance: 100,
          },
        ],
        error: null,
      }),
      from: jest.fn(),
    }

    const block = await fetchGeneralLedgerForAccount(
      supabase as never,
      "biz-1",
      account,
      "2026-10-01",
      "2026-10-31"
    )

    expect(block.lines[0].payment_reference).toBeNull()
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
