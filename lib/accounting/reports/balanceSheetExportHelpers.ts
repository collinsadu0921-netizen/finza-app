/**
 * Shared Balance Sheet export helpers — all CSV/PDF/AFS exports use getBalanceSheetReport.
 */

import type { BalanceSheetReportInput, BalanceSheetReportResponse, BSLine } from "./getBalanceSheetReport"

export type BalanceSheetExportLine = {
  account_id?: string
  account_code: string
  account_name: string
  account_type: string
  amount: number
}

export type BalanceSheetExportView = {
  asOfDate: string
  totals: BalanceSheetReportResponse["totals"]
  /** Equity section subtotal (book equity + cumulative net income). */
  adjustedEquity: number
  equitySectionLabel: string
  cumulativeNetIncome: number
  assetLines: BalanceSheetExportLine[]
  liabilityLines: BalanceSheetExportLine[]
  equityLines: BalanceSheetExportLine[]
  rowCount: number
}

/** Map export query params to canonical BalanceSheetReportInput. */
export function parseBalanceSheetReportQuery(
  businessId: string,
  searchParams: {
    get: (key: string) => string | null
  }
): BalanceSheetReportInput {
  const rangeStart = searchParams.get("start_date")?.trim() ?? ""
  const rangeEnd = searchParams.get("end_date")?.trim() ?? ""
  const hasCustomRange =
    !!(
      rangeStart &&
      rangeEnd &&
      /^\d{4}-\d{2}-\d{2}$/.test(rangeStart) &&
      /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd)
    )

  const periodStart = searchParams.get("period_start")?.trim()

  return {
    businessId,
    period_id: searchParams.get("period_id") ?? undefined,
    period_start: periodStart || undefined,
    as_of_date: hasCustomRange ? undefined : searchParams.get("as_of_date")?.trim() || undefined,
    start_date: hasCustomRange ? rangeStart : undefined,
    end_date: hasCustomRange ? rangeEnd : undefined,
  }
}

function mapLine(line: BSLine, defaultType: string): BalanceSheetExportLine {
  return {
    account_id: line.account_id,
    account_code: line.account_code,
    account_name: line.account_name,
    account_type: defaultType,
    amount: line.amount,
  }
}

function linesFromSection(
  section: BalanceSheetReportResponse["sections"][number] | undefined,
  defaultType: string
): BalanceSheetExportLine[] {
  if (!section) return []
  return section.groups.flatMap((group) => group.lines.map((line) => mapLine(line, defaultType)))
}

/** Flatten canonical report sections for tabular CSV/PDF export. */
export function toBalanceSheetExportView(data: BalanceSheetReportResponse): BalanceSheetExportView {
  const assetsSection = data.sections.find((s) => s.key === "assets")
  const liabilitiesSection = data.sections.find((s) => s.key === "liabilities")
  const equitySection = data.sections.find((s) => s.key === "equity")

  const assetLines = linesFromSection(assetsSection, "asset")
  const liabilityLines = linesFromSection(liabilitiesSection, "liability")
  const equityLines = linesFromSection(equitySection, "equity")

  const syntheticLine = equityLines.find((l) => l.account_id === "__net_income__")
  const cumulativeNetIncome =
    syntheticLine?.amount ??
    Math.round(((equitySection?.subtotal ?? 0) - data.totals.equity) * 100) / 100

  return {
    asOfDate: data.as_of_date,
    totals: data.totals,
    adjustedEquity: equitySection?.subtotal ?? data.totals.equity + cumulativeNetIncome,
    equitySectionLabel: equitySection?.label ?? "Equity",
    cumulativeNetIncome,
    assetLines,
    liabilityLines,
    equityLines,
    rowCount: assetLines.length + liabilityLines.length + equityLines.length,
  }
}
