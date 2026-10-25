export const VAT_TAX_ACCOUNTS = [
  {
    code: "2100",
    name: "VAT Payable",
    outputKey: "total_output_vat",
    inputKey: "total_input_vat",
  },
  {
    code: "2110",
    name: "NHIL Payable",
    outputKey: "total_output_nhil",
    inputKey: "total_input_nhil",
  },
  {
    code: "2120",
    name: "GETFund Payable",
    outputKey: "total_output_getfund",
    inputKey: "total_input_getfund",
  },
  {
    code: "2130",
    name: "COVID Levy Payable",
    outputKey: "total_output_covid",
    inputKey: "total_input_covid",
  },
] as const

export type VatPaymentFilingFields = {
  total_output_vat: number
  total_input_vat: number
  total_output_nhil: number
  total_input_nhil: number
  total_output_getfund: number
  total_input_getfund: number
  total_output_covid: number
  total_input_covid: number
  net_vat_payable: number
}

export type VatLedgerTaxBalance = {
  code: string
  amount: number
}

export type VatReconciliationAccount = {
  code: string
  name: string
  filing: number
  ledger: number
  difference: number
}

export type VatReconciliationResult = {
  ok: boolean
  filingTotal: number
  ledgerTotal: number
  difference: number
  netPayable: number
  filingMatchesNetPayable: boolean
  accounts: VatReconciliationAccount[]
}

export function roundMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function amount(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function computeFilingTaxAmounts(
  filing: VatPaymentFilingFields
): Record<string, number> {
  return Object.fromEntries(
    VAT_TAX_ACCOUNTS.map((account) => [
      account.code,
      roundMoney(
        amount(filing[account.outputKey]) - amount(filing[account.inputKey])
      ),
    ])
  )
}

export function reconcileVatFilingToLedger(
  filing: VatPaymentFilingFields,
  ledgerBalances: VatLedgerTaxBalance[]
): VatReconciliationResult {
  const filingAmounts = computeFilingTaxAmounts(filing)
  const ledgerByCode = new Map(
    ledgerBalances.map((row) => [String(row.code), roundMoney(amount(row.amount))])
  )

  const accounts = VAT_TAX_ACCOUNTS.map((account) => {
    const filingAmount = filingAmounts[account.code] ?? 0
    const ledgerAmount = ledgerByCode.get(account.code) ?? 0
    return {
      code: account.code,
      name: account.name,
      filing: filingAmount,
      ledger: ledgerAmount,
      difference: roundMoney(filingAmount - ledgerAmount),
    }
  })

  const filingTotal = roundMoney(
    accounts.reduce((sum, row) => sum + row.filing, 0)
  )
  const ledgerTotal = roundMoney(
    accounts.reduce((sum, row) => sum + row.ledger, 0)
  )
  const difference = roundMoney(filingTotal - ledgerTotal)
  const netPayable = roundMoney(amount(filing.net_vat_payable))
  const filingMatchesNetPayable =
    Math.abs(roundMoney(filingTotal - netPayable)) <= 0.01
  const accountsMatch = accounts.every(
    (row) => Math.abs(row.difference) <= 0.01
  )

  return {
    ok: filingMatchesNetPayable && accountsMatch,
    filingTotal,
    ledgerTotal,
    difference,
    netPayable,
    filingMatchesNetPayable,
    accounts,
  }
}

export type VatPaymentState =
  | "unpaid"
  | "paid_recorded"
  | "paid_without_payment"

export function vatPaymentState(row: {
  status?: string | null
  payment_journal_entry_id?: string | null
}): VatPaymentState {
  if (row.status !== "paid") return "unpaid"
  return row.payment_journal_entry_id
    ? "paid_recorded"
    : "paid_without_payment"
}

export type VatPaymentErrorPayload = {
  status: number
  body: Record<string, unknown>
}

const ERROR_STATUS: Record<string, number> = {
  VAT_PAYMENT_NOT_FOUND: 404,
  VAT_PAYMENT_NOT_AUTHORIZED: 403,
  VAT_PAYMENT_INVALID_STATUS: 409,
  VAT_PAYMENT_LEGACY_PAID_WITHOUT_JOURNAL: 409,
  VAT_PAYMENT_RECONCILIATION_MISMATCH: 409,
  VAT_PAYMENT_FILING_INCONSISTENT: 409,
  VAT_PAYMENT_NEGATIVE_COMPONENT: 409,
  VAT_PAYMENT_NOT_PAYABLE: 409,
  VAT_PAYMENT_INVALID_DATE: 400,
  VAT_PAYMENT_INVALID_ACCOUNT: 400,
  VAT_PAYMENT_INVALID_REFERENCE: 400,
  VAT_PAYMENT_PERIOD_NOT_FOUND: 400,
  VAT_PAYMENT_PERIOD_LOCKED: 400,
  VAT_PAYMENT_ACCOUNT_MISSING: 400,
}

function parseDetails(details: unknown): Record<string, unknown> {
  if (!details) return {}
  if (typeof details === "object") return details as Record<string, unknown>
  if (typeof details !== "string") return {}
  try {
    const parsed = JSON.parse(details)
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function mapVatPaymentRpcError(error: {
  message?: string | null
  details?: unknown
  hint?: string | null
  code?: string | null
}): VatPaymentErrorPayload {
  const rawMessage = String(error?.message || "").trim()
  const code = /VAT_PAYMENT_[A-Z_]+/.exec(rawMessage)?.[0] || "VAT_PAYMENT_FAILED"
  const details = parseDetails(error?.details)

  const message =
    typeof details.message === "string" && details.message.trim()
      ? details.message
      : rawMessage && rawMessage !== code
        ? rawMessage
        : "VAT payment could not be posted."

  const body: Record<string, unknown> = {
    ...details,
    error: code,
    message,
  }

  if (error?.hint) body.hint = error.hint

  return {
    status: ERROR_STATUS[code] ?? 500,
    body,
  }
}
