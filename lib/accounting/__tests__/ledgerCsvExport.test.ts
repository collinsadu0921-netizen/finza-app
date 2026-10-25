import { describe, it, expect } from "@jest/globals"
import { buildLedgerCsv, type LedgerCsvEntry } from "@/lib/accounting/ledgerCsvExport"

const entries: LedgerCsvEntry[] = [
  {
    date: "2026-10-24",
    reference_type: "manual",
    description: "Manual, with comma and \"quote\"",
    journal_entry_lines: [
      {
        debit: 0,
        credit: 1,
        description: "Line one",
        accounts: { code: "1000", name: "Cash" },
      },
      {
        debit: 1,
        credit: 0,
        description: "Line\ntwo",
        accounts: { code: "5100", name: "Operating Expenses" },
      },
    ],
  },
  {
    date: "2026-10-25",
    reference_type: "reversal",
    description: "Reversal",
    journal_entry_lines: [
      {
        debit: 1000,
        credit: 0,
        description: null,
        accounts: { code: "1000", name: "Cash" },
      },
    ],
  },
]

describe("buildLedgerCsv", () => {
  it("starts with a UTF-8 BOM and uses a readable cedi column header", () => {
    const csv = buildLedgerCsv(entries, {
      currencySymbol: "₵",
      typeLabel: (type) => (type === "manual" ? "Manual Entry" : "Reversal"),
    })

    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('"Debit (₵)"')
    expect(csv).toContain('"Credit (₵)"')
  })

  it("keeps debit and credit as numeric values instead of currency strings", () => {
    const csv = buildLedgerCsv(entries, {
      currencySymbol: "₵",
      typeLabel: (type) => (type === "manual" ? "Manual Entry" : "Reversal"),
    })

    expect(csv).toContain('"1000.00",""')
    expect(csv).toContain('"","1.00"')
    expect(csv).not.toContain("₵1.00")
    expect(csv).not.toContain("₵1,000.00")
  })

  it("preserves every entry and line and escapes commas, quotes, and line breaks", () => {
    const csv = buildLedgerCsv(entries, {
      currencySymbol: "₵",
      typeLabel: (type) => (type === "manual" ? "Manual Entry" : "Reversal"),
    })

    expect(csv).toContain('"Manual, with comma and ""quote"""')
    expect(csv).toContain('"Line\ntwo"')
    expect(csv).toContain('"Reversal"')
    expect(csv).toContain('"Operating Expenses"')
    expect(csv.split("\n").length).toBe(5) // header + 4 line rows
  })
})
