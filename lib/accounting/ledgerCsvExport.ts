/**
 * Journal Entries CSV builder for the Service/Accounting ledger screen.
 * Pure so encoding, numeric formatting, and escaping can be tested.
 */

export type LedgerCsvLine = {
  debit: number | string | null
  credit: number | string | null
  description: string | null
  accounts: {
    code: string
    name: string
  }
}

export type LedgerCsvEntry = {
  date: string
  reference_type: string | null
  description: string | null
  journal_entry_lines: LedgerCsvLine[]
}

function formatCsvDate(dateString: string): string {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return dateString
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export function buildLedgerCsv(
  entries: LedgerCsvEntry[],
  options: {
    currencySymbol: string
    typeLabel: (referenceType: string | null) => string
  }
): string {
  const debitHeader = options.currencySymbol
    ? `Debit (${options.currencySymbol})`
    : "Debit"
  const creditHeader = options.currencySymbol
    ? `Credit (${options.currencySymbol})`
    : "Credit"

  const rows: string[][] = [
    [
      "Date",
      "Period",
      "Type",
      "Journal Description",
      "Account Code",
      "Account Name",
      "Line Description",
      debitHeader,
      creditHeader,
    ],
  ]

  for (const entry of entries) {
    const period = entry.date.substring(0, 7)
    const type = options.typeLabel(entry.reference_type)
    for (const line of entry.journal_entry_lines) {
      const debit = Number(line.debit || 0)
      const credit = Number(line.credit || 0)
      rows.push([
        formatCsvDate(entry.date),
        period,
        type,
        entry.description ?? "",
        line.accounts.code,
        line.accounts.name,
        line.description ?? "",
        debit > 0 ? debit.toFixed(2) : "",
        credit > 0 ? credit.toFixed(2) : "",
      ])
    }
  }

  return (
    "\uFEFF" +
    rows
      .map((row) => row.map((cell) => escapeCsvCell(String(cell))).join(","))
      .join("\n")
  )
}
