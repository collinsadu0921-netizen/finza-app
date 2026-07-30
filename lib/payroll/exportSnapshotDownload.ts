import { createHash } from "crypto"
import { NextResponse } from "next/server"
import { escapeCsvValue, formatNumeric } from "@/lib/payroll/csvExport"
import {
  PAYROLL_EXPORT_PERIOD_HEADERS,
  payrollExportFilename,
  payrollExportPeriodValues,
  payrollPeriodCellValue,
  type PayrollRunExportMeta,
} from "@/lib/payroll/payrollExportMetadata"
import { GRA_DT107A_PAYE_HEADER_ROW } from "@/lib/payroll/graDt107aPayeExport"

export type PayrollExportMode = "preparation" | "audit"

export type PayrollExportType =
  | "gra_dt107a"
  | "payroll_register"
  | "paye_schedule"
  | "pension_tier1"
  | "pension_tier2"
  | "net_salary"
  | "obligations"

export type PayrollExportSnapshotRow = {
  id: string
  business_id: string
  payroll_run_id: string
  export_type: PayrollExportType
  snapshot_schema_version: string
  renderer_version: string
  template_version: string | null
  template_reference: string | null
  source_run_status: string
  source_payload: Record<string, unknown>
  source_payload_sha256: string
  row_count: number
  control_totals: Record<string, unknown>
  rendered_content: string | null
  rendered_content_sha256: string | null
  content_type: string | null
  filename: string | null
  materialized_at: string | null
  created_at: string
  created_by: string | null
}

type PayloadRow = Record<string, unknown>

const LEGACY_AUDIT_BANNER =
  "# LEGACY EXPORT - NO APPROVAL-TIME SNAPSHOT (immutable filing fields only; not for portal upload)"

export const PAYROLL_CSV_UTF8_BOM = "\uFEFF"

export const DT107A_AUDIT_BANNER =
  "# Finza DT 107A audit export - not for GRA portal upload"

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

/** Add UTF-8 BOM to final delivered CSV bytes without changing stored snapshot hashes. */
export function deliverPayrollCsvContent(content: string): {
  content: string
  contentSha256: string
  contentLength: number
} {
  const delivered = `${PAYROLL_CSV_UTF8_BOM}${content}`
  return {
    content: delivered,
    contentSha256: sha256Hex(delivered),
    contentLength: Buffer.byteLength(delivered, "utf8"),
  }
}

export function payrollCsvDownloadResponse(
  filename: string,
  contentWithoutBom: string
): {
  response: NextResponse
  contentSha256: string
  contentLength: number
} {
  const delivered = deliverPayrollCsvContent(contentWithoutBom)
  return {
    contentSha256: delivered.contentSha256,
    contentLength: delivered.contentLength,
    response: new NextResponse(delivered.content, {
      status: 200,
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(delivered.contentLength),
      },
    }),
  }
}

export function rawCsvResponse(filename: string, content: string): NextResponse {
  return payrollCsvDownloadResponse(filename, content).response
}

export function normalizePayrollExportMode(modeParam: string | null | undefined): PayrollExportMode {
  const raw = String(modeParam || "").trim().toLowerCase()
  if (raw === "audit") return "audit"
  // Public compatibility alias — never treat as a distinct export mode.
  if (raw === "gra-ready" || raw === "preparation" || raw === "") return "preparation"
  return "preparation"
}

export function isImmutablePayrollRunStatus(status: string | null | undefined): boolean {
  const s = String(status || "").toLowerCase()
  return s === "approved" || s === "locked" || s === "reversed"
}

export function rowsToCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCsvValue).join(",")).join("\n")
}

export function verifySnapshotContentHashes(snapshot: PayrollExportSnapshotRow): {
  ok: boolean
  errors: string[]
} {
  const errors: string[] = []
  if (snapshot.rendered_content != null && snapshot.rendered_content_sha256) {
    const renderedHash = sha256Hex(snapshot.rendered_content)
    if (renderedHash !== snapshot.rendered_content_sha256) {
      errors.push("rendered_content_sha256 mismatch")
    }
  }
  return { ok: errors.length === 0, errors }
}

function tryParseDetail(detail: unknown): Record<string, unknown> | null {
  if (detail == null) return null
  if (typeof detail === "object" && !Array.isArray(detail)) return detail as Record<string, unknown>
  try {
    const parsed = JSON.parse(String(detail))
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>
  } catch {
    /* ignore */
  }
  return null
}

const PAYROLL_EXPORT_ERROR_CODE_PATTERN =
  /\b(PAYROLL_EXPORT_PERMISSION_DENIED|PAYROLL_EXPORT_INVALID_MODE|PAYROLL_EXPORT_SNAPSHOT_NOT_FOUND|PAYROLL_EXPORT_SNAPSHOT_CORRUPTED|PAYROLL_EXPORT_SNAPSHOT_INTEGRITY_FAILED|PAYROLL_EXPORT_SNAPSHOT_IMMUTABLE|PAYROLL_EXPORT_SNAPSHOT_INVALID_SOURCE_STATUS|PAYROLL_EXPORT_EVENT_IMMUTABLE|PAYROLL_EXPORT_EVENT_RECORDING_FAILED|PAYROLL_RUN_REVERSED|PAYROLL_EXPORT_LEGACY_SNAPSHOT_MISSING)\b/

export function extractPayrollExportErrorCode(err: {
  message?: string | null
  details?: string | null
  hint?: string | null
} | null): string | null {
  const message = String(err?.message || "")
  const detail = tryParseDetail(err?.details) || tryParseDetail(err?.hint)
  if (detail?.code && typeof detail.code === "string") return detail.code
  const fromMsg = message.match(PAYROLL_EXPORT_ERROR_CODE_PATTERN)
  return fromMsg?.[1] ?? null
}

export function payrollExportErrorStatus(code: string): number {
  switch (code) {
    case "PAYROLL_EXPORT_PERMISSION_DENIED":
      return 403
    case "PAYROLL_RUN_REVERSED":
    case "PAYROLL_EXPORT_SNAPSHOT_INVALID_SOURCE_STATUS":
    case "PAYROLL_EXPORT_SNAPSHOT_IMMUTABLE":
    case "PAYROLL_EXPORT_EVENT_IMMUTABLE":
      return 409
    case "PAYROLL_EXPORT_SNAPSHOT_CORRUPTED":
    case "PAYROLL_EXPORT_SNAPSHOT_INTEGRITY_FAILED":
    case "PAYROLL_EXPORT_EVENT_RECORDING_FAILED":
      return 500
    default:
      return 400
  }
}

export function mapPayrollExportRpcError(err: {
  message?: string | null
  details?: string | null
  hint?: string | null
} | null): NextResponse {
  const message = String(err?.message || err?.details || "Payroll export failed")
  const code = extractPayrollExportErrorCode(err) || "PAYROLL_EXPORT_FAILED"
  return NextResponse.json({ error: message, code }, { status: payrollExportErrorStatus(code) })
}

export async function loadPayrollExportSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  businessId: string,
  payrollRunId: string,
  exportType: PayrollExportType,
  mode: PayrollExportMode
): Promise<
  | { snapshot: PayrollExportSnapshotRow }
  | { notFound: true }
  | { error: NextResponse }
> {
  const { data, error } = await supabase.rpc("get_payroll_export_snapshot_for_download", {
    p_business_id: businessId,
    p_payroll_run_id: payrollRunId,
    p_export_type: exportType,
    p_mode: mode,
  })

  if (error) {
    const code = extractPayrollExportErrorCode(error as { message?: string })
    if (
      code === "PAYROLL_EXPORT_SNAPSHOT_NOT_FOUND" ||
      code === "PAYROLL_EXPORT_LEGACY_SNAPSHOT_MISSING"
    ) {
      return { notFound: true }
    }
    return { error: mapPayrollExportRpcError(error as { message?: string; details?: string }) }
  }

  const rows = (Array.isArray(data) ? data : data ? [data] : []) as PayrollExportSnapshotRow[]
  const snapshot = rows[0]
  if (!snapshot) return { notFound: true }

  const verification = verifySnapshotContentHashes(snapshot)
  if (!verification.ok) {
    return {
      error: NextResponse.json(
        {
          error: `Payroll export snapshot failed hash verification (${verification.errors.join(", ")})`,
          code: "PAYROLL_EXPORT_SNAPSHOT_CORRUPTED",
        },
        { status: payrollExportErrorStatus("PAYROLL_EXPORT_SNAPSHOT_CORRUPTED") }
      ),
    }
  }

  return { snapshot }
}

function sortPayloadRows(rows: PayloadRow[]): PayloadRow[] {
  return [...rows].sort((a, b) => {
    const serialA = a.serial_number != null ? Number(a.serial_number) : Number.POSITIVE_INFINITY
    const serialB = b.serial_number != null ? Number(b.serial_number) : Number.POSITIVE_INFINITY
    if (serialA !== serialB) return serialA - serialB
    return String(a.staff_id ?? "").localeCompare(String(b.staff_id ?? ""))
  })
}

function payloadEntryRows(payload: Record<string, unknown>): PayloadRow[] {
  const entries = payload.entries
  if (Array.isArray(entries)) return entries as PayloadRow[]
  const rows = payload.rows
  if (Array.isArray(rows)) return rows as PayloadRow[]
  return []
}

function controlTotal(totals: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (totals[key] != null && totals[key] !== "") return Number(totals[key])
  }
  return 0
}

const PAYE_SCHEDULE_V2_TAX_HEADERS = [
  "Income Tax Method",
  "Income Tax Method Version",
  "Income Tax Regular Base",
  "Income Tax Regular Amount",
  "Income Tax Bonus Base",
  "Income Tax Bonus Amount",
  "Income Tax Overtime Base",
  "Income Tax Overtime Amount",
] as const

function payeScheduleV2TaxCells(row: PayloadRow): string[] {
  return [
    String(row.income_tax_method ?? ""),
    String(row.income_tax_method_version ?? ""),
    formatNumeric(row.income_tax_regular_base),
    formatNumeric(row.income_tax_regular_amount),
    formatNumeric(row.income_tax_bonus_base),
    formatNumeric(row.income_tax_bonus_amount),
    formatNumeric(row.income_tax_overtime_base),
    formatNumeric(row.income_tax_overtime_amount),
  ]
}

function runFromPayload(payload: Record<string, unknown>): PayrollRunExportMeta {
  const run = (payload.run || {}) as Record<string, unknown>
  return {
    payroll_month: run.payroll_month as string | null | undefined,
    pay_period_start: run.pay_period_start as string | null | undefined,
    pay_period_end: run.pay_period_end as string | null | undefined,
    payroll_frequency: run.payroll_frequency as string | null | undefined,
    run_type: run.run_type as string | null | undefined,
  }
}

function businessDisplayName(payload: Record<string, unknown>): string {
  const business = (payload.business || {}) as Record<string, unknown>
  return String(business.trading_name || business.legal_name || business.id || "")
}

function periodValuesFromPayload(payload: Record<string, unknown>): string[] {
  return payrollExportPeriodValues(runFromPayload(payload))
}

export function buildDt107aAuditMetadataLines(
  snapshot: PayrollExportSnapshotRow,
  payrollRun: Record<string, unknown>
): string[][] {
  const payload = snapshot.source_payload
  const run = (payload.run || {}) as Record<string, unknown>
  const business = (payload.business || {}) as Record<string, unknown>
  return [
    [DT107A_AUDIT_BANNER],
    ["Snapshot ID", snapshot.id],
    ["Source payload SHA256", snapshot.source_payload_sha256],
    ["Rendered content SHA256", snapshot.rendered_content_sha256 || ""],
    ["Snapshot schema version", snapshot.snapshot_schema_version],
    ["Renderer version", snapshot.renderer_version],
    ["Template version", snapshot.template_version || ""],
    ["Template reference", snapshot.template_reference || ""],
    ["Business name", businessDisplayName(payload)],
    ["Business TIN", String(business.tin || "")],
    ["Pay period label", payrollPeriodCellValue(runFromPayload(payload))],
    ["Period start", String(run.pay_period_start || run.payroll_month || "").slice(0, 10)],
    ["Period end", String(run.pay_period_end || run.pay_period_start || run.payroll_month || "").slice(0, 10)],
    ["Pay frequency", String(run.payroll_frequency || "monthly")],
    ["Run type", String(run.run_type || "regular")],
    ["Snapshot source run status", String(snapshot.source_run_status || run.source_status || "")],
    ["Current run status", String(payrollRun.status || "")],
    ["Approved at", String(run.approved_at || "")],
    ["Approved by", String(run.approved_by || "")],
    ["Calculation engine version", String(run.calculation_engine_version || "")],
    ["PAYE rate version", String(run.paye_rate_version || "")],
    ["Pension rate version", String(run.pension_rate_version || "")],
    ["Calculation jurisdiction", String(run.calculation_jurisdiction || "")],
    ["Statutory period basis", String(run.statutory_period_basis || "")],
    ["Reversed at", String(payrollRun.reversed_at || "")],
    ["Reversed by", String(payrollRun.reversed_by || "")],
    ["Reversal reason", String(payrollRun.reversal_reason || "")],
    ["Reversal journal ID", String(payrollRun.reversal_journal_id || "")],
    ["Correction of run ID", String(payrollRun.correction_of_run_id || "")],
    ["Corrected by run ID", String(payrollRun.corrected_by_run_id || "")],
    [],
  ]
}

function renderPayeSchedule(rendererVersion: string, payload: Record<string, unknown>): string[][] {
  const period = periodValuesFromPayload(payload)
  const rows = sortPayloadRows(payloadEntryRows(payload))

  if (rendererVersion === "paye-schedule-renderer-v1") {
    const out: string[][] = [
      [
        ...PAYROLL_EXPORT_PERIOD_HEADERS,
        "Staff ID",
        "TIN",
        "Employee Name",
        "Taxable Income",
        "PAYE Withheld",
      ],
    ]
    for (const row of rows) {
      out.push([
        ...period,
        String(row.staff_id ?? ""),
        String(row.filing_tin ?? ""),
        String(row.filing_employee_name ?? ""),
        formatNumeric(row.taxable_income),
        formatNumeric(row.paye),
      ])
    }
    return out
  }

  if (rendererVersion === "paye-schedule-renderer-v2") {
    const out: string[][] = [
      [
        ...PAYROLL_EXPORT_PERIOD_HEADERS,
        "Staff ID",
        "TIN",
        "Employee Name",
        "Taxable Income",
        "PAYE Withheld",
        ...PAYE_SCHEDULE_V2_TAX_HEADERS,
      ],
    ]
    for (const row of rows) {
      out.push([
        ...period,
        String(row.staff_id ?? ""),
        String(row.filing_tin ?? ""),
        String(row.filing_employee_name ?? ""),
        formatNumeric(row.taxable_income),
        formatNumeric(row.paye),
        ...payeScheduleV2TaxCells(row),
      ])
    }
    return out
  }

  throw new Error(`Unsupported PAYE schedule renderer: ${rendererVersion}`)
}

function renderPensionTier1(rendererVersion: string, payload: Record<string, unknown>): string[][] {
  if (rendererVersion !== "pension-tier1-renderer-v1") {
    throw new Error(`Unsupported pension tier 1 renderer: ${rendererVersion}`)
  }
  const period = periodValuesFromPayload(payload)
  const rows: string[][] = [
    [
      ...PAYROLL_EXPORT_PERIOD_HEADERS,
      "Staff ID",
      "TIN",
      "Employee Name",
      "Pensionable Base",
      "Tier 1 / SSNIT Remittance",
    ],
  ]
  for (const row of sortPayloadRows(((payload.rows as PayloadRow[]) || []) as PayloadRow[])) {
    rows.push([
      ...period,
      String(row.staff_id ?? ""),
      String(row.filing_tin ?? ""),
      String(row.filing_employee_name ?? ""),
      formatNumeric(row.pensionable_base),
      formatNumeric(row.tier1_ssnit_remittance),
    ])
  }
  return rows
}

function renderPensionTier2(rendererVersion: string, payload: Record<string, unknown>): string[][] {
  if (rendererVersion !== "pension-tier2-renderer-v1") {
    throw new Error(`Unsupported pension tier 2 renderer: ${rendererVersion}`)
  }
  const period = periodValuesFromPayload(payload)
  const rows: string[][] = [
    [
      ...PAYROLL_EXPORT_PERIOD_HEADERS,
      "Staff ID",
      "TIN",
      "Employee Name",
      "Pensionable Base",
      "Tier 2 Pension Remittance",
    ],
  ]
  for (const row of sortPayloadRows(((payload.rows as PayloadRow[]) || []) as PayloadRow[])) {
    rows.push([
      ...period,
      String(row.staff_id ?? ""),
      String(row.filing_tin ?? ""),
      String(row.filing_employee_name ?? ""),
      formatNumeric(row.pensionable_base),
      formatNumeric(row.tier2_pension_remittance),
    ])
  }
  return rows
}

function renderNetSalary(rendererVersion: string, payload: Record<string, unknown>): string[][] {
  if (rendererVersion !== "net-salary-renderer-v1") {
    throw new Error(`Unsupported net salary renderer: ${rendererVersion}`)
  }
  const period = periodValuesFromPayload(payload)
  const rows: string[][] = [
    [
      ...PAYROLL_EXPORT_PERIOD_HEADERS,
      "Employee Name",
      "Bank Name",
      "Bank Account Name",
      "Bank Account Number",
      "Net Pay",
    ],
  ]
  for (const row of sortPayloadRows(((payload.rows as PayloadRow[]) || []) as PayloadRow[])) {
    rows.push([
      ...period,
      String(row.filing_employee_name ?? ""),
      String(row.bank_name ?? ""),
      String(row.bank_account_name ?? ""),
      String(row.bank_account_number ?? ""),
      formatNumeric(row.net_salary),
    ])
  }
  return rows
}

function renderObligations(rendererVersion: string, payload: Record<string, unknown>): string[][] {
  if (rendererVersion !== "obligations-renderer-v1") {
    throw new Error(`Unsupported obligations renderer: ${rendererVersion}`)
  }
  const period = periodValuesFromPayload(payload)
  const rows: string[][] = [
    [
      ...PAYROLL_EXPORT_PERIOD_HEADERS,
      "Obligation Type",
      "Label",
      "Amount Due",
      "Amount Paid",
      "Outstanding Amount",
      "Status",
      "Due Date",
      "Liability Account Code",
    ],
  ]
  for (const row of sortPayloadRows(((payload.rows as PayloadRow[]) || []) as PayloadRow[])) {
    const due = Number(row.amount_due ?? 0)
    const paid = Number(row.amount_paid ?? 0)
    rows.push([
      ...period,
      String(row.obligation_type ?? ""),
      String(row.label ?? ""),
      formatNumeric(row.amount_due),
      formatNumeric(row.amount_paid),
      formatNumeric(Math.max(0, due - paid)),
      String(row.status ?? ""),
      String(row.due_date ?? ""),
      String(row.liability_account_code ?? ""),
    ])
  }
  return rows
}

function renderPayrollRegisterV1(payload: Record<string, unknown>): string[][] {
  const period = periodValuesFromPayload(payload)
  const totals = (payload.control_totals || {}) as Record<string, unknown>
  const run = (payload.run || {}) as Record<string, unknown>
  const employerCost =
    controlTotal(totals, "gross_salary", "total_cash_emolument") +
    controlTotal(totals, "employer_social_security")
  return [
    [
      ...PAYROLL_EXPORT_PERIOD_HEADERS,
      "Business Name",
      "Run Status",
      "Gross Salary",
      "Regular Allowances",
      "Employee Social Security",
      "Employer Social Security",
      "Taxable Income",
      "Total PAYE",
      "Deductions",
      "Net Salary Payable",
      "Tier 1 / SSNIT Remittance",
      "Tier 2 Pension Remittance",
      "Total Employer Payroll Cost",
      "Included Employees",
    ],
    [
      ...period,
      businessDisplayName(payload),
      String(run.source_status ?? ""),
      formatNumeric(controlTotal(totals, "gross_salary", "total_cash_emolument")),
      formatNumeric(controlTotal(totals, "allowances", "total_cash_allowances")),
      formatNumeric(controlTotal(totals, "employee_social_security", "total_employee_social_security")),
      formatNumeric(controlTotal(totals, "employer_social_security")),
      formatNumeric(controlTotal(totals, "taxable_income", "total_chargeable_income")),
      formatNumeric(controlTotal(totals, "paye", "total_paye")),
      formatNumeric(controlTotal(totals, "deductions")),
      formatNumeric(controlTotal(totals, "net_salary")),
      formatNumeric(controlTotal(totals, "tier1_remittance")),
      formatNumeric(controlTotal(totals, "tier2_remittance")),
      formatNumeric(employerCost),
      String(totals.included_count ?? totals.included_employee_count ?? ""),
    ],
  ]
}

const PAYROLL_REGISTER_V2_ENTRY_HEADERS = [
  "Serial Number",
  "Staff ID",
  "TIN",
  "Employee Name",
  "GRA Position Code",
  "Basic Salary",
  "Cash Allowances",
  "Bonus Income",
  "Overtime Income",
  "Total Cash Emolument",
  "Chargeable Income",
  "Total Tax Payable",
  "Employee Social Security",
  ...PAYE_SCHEDULE_V2_TAX_HEADERS,
] as const

function renderPayrollRegisterV2(payload: Record<string, unknown>): string[][] {
  const summary = renderPayrollRegisterV1(payload)
  const period = periodValuesFromPayload(payload)
  const rows: string[][] = [
    ["# Payroll register v2 — run summary (frozen at approval)"],
    summary[0],
    summary[1],
    [],
    ["# Included employees — tax method evidence (frozen at approval)"],
    [...PAYROLL_EXPORT_PERIOD_HEADERS, ...PAYROLL_REGISTER_V2_ENTRY_HEADERS],
  ]

  for (const row of sortPayloadRows(payloadEntryRows(payload))) {
    rows.push([
      ...period,
      String(row.serial_number ?? ""),
      String(row.staff_id ?? ""),
      String(row.filing_tin ?? ""),
      String(row.filing_employee_name ?? ""),
      String(row.gra_position_code ?? ""),
      formatNumeric(row.basic_salary),
      formatNumeric(row.cash_allowances),
      formatNumeric(row.bonus_income),
      formatNumeric(row.overtime_income),
      formatNumeric(row.total_cash_emolument),
      formatNumeric(row.chargeable_income),
      formatNumeric(row.total_tax_payable ?? row.paye),
      formatNumeric(row.employee_social_security),
      ...payeScheduleV2TaxCells(row),
    ])
  }

  return rows
}

function renderPayrollRegister(rendererVersion: string, payload: Record<string, unknown>): string[][] {
  if (rendererVersion === "payroll-register-renderer-v1") {
    return renderPayrollRegisterV1(payload)
  }
  if (rendererVersion === "payroll-register-renderer-v2") {
    return renderPayrollRegisterV2(payload)
  }
  throw new Error(`Unsupported payroll register renderer: ${rendererVersion}`)
}

export function renderSnapshotCsvRows(
  snapshot: PayrollExportSnapshotRow
): string[][] {
  const payload = snapshot.source_payload
  switch (snapshot.export_type) {
    case "paye_schedule":
      return renderPayeSchedule(snapshot.renderer_version, payload)
    case "pension_tier1":
      return renderPensionTier1(snapshot.renderer_version, payload)
    case "pension_tier2":
      return renderPensionTier2(snapshot.renderer_version, payload)
    case "net_salary":
      return renderNetSalary(snapshot.renderer_version, payload)
    case "obligations":
      return renderObligations(snapshot.renderer_version, payload)
    case "payroll_register":
      return renderPayrollRegister(snapshot.renderer_version, payload)
    default:
      throw new Error(`No CSV renderer for export type ${snapshot.export_type}`)
  }
}

export function resolveSnapshotFilename(
  snapshot: PayrollExportSnapshotRow,
  fallbackPrefix: string,
  payrollRun: PayrollRunExportMeta,
  mode: PayrollExportMode
): string {
  const stored = snapshot.filename?.trim()
  if (stored) {
    return stored.replace(/gra-ready/gi, "preparation")
  }
  if (snapshot.export_type === "gra_dt107a") {
    return payrollExportFilename(
      mode === "audit" ? "gra-dt107a-paye-audit" : "gra-dt107a-paye-preparation",
      payrollRun
    )
  }
  return payrollExportFilename(fallbackPrefix, payrollRun)
}

export function renderPayrollExportContent(args: {
  snapshot: PayrollExportSnapshotRow
  mode: PayrollExportMode
  payrollRun: Record<string, unknown>
  filenamePrefix: string
  legacyBanner?: boolean
}): { content: string; filename: string; contentSha256: string; contentLength: number } {
  const { snapshot, mode, payrollRun, filenamePrefix, legacyBanner } = args
  const runMeta = payrollRun as PayrollRunExportMeta

  if (snapshot.export_type === "gra_dt107a") {
    const tableContent = snapshot.rendered_content
    if (!tableContent) {
      throw new Error("GRA DT 107A snapshot is missing rendered_content")
    }
    const tableHash = sha256Hex(tableContent)
    if (snapshot.rendered_content_sha256 && tableHash !== snapshot.rendered_content_sha256) {
      throw new Error("GRA DT 107A rendered_content hash mismatch")
    }

    if (mode === "preparation") {
      const filename = resolveSnapshotFilename(snapshot, filenamePrefix, runMeta, mode)
      return {
        content: tableContent,
        filename,
        contentSha256: tableHash,
        contentLength: Buffer.byteLength(tableContent, "utf8"),
      }
    }

    const metaLines = legacyBanner
      ? [[LEGACY_AUDIT_BANNER], []]
      : buildDt107aAuditMetadataLines(snapshot, payrollRun)
    const content = rowsToCsv(metaLines) + tableContent
    const filename = resolveSnapshotFilename(snapshot, filenamePrefix, runMeta, mode)
    return {
      content,
      filename,
      contentSha256: sha256Hex(content),
      contentLength: Buffer.byteLength(content, "utf8"),
    }
  }

  const rows = renderSnapshotCsvRows(snapshot)
  if (legacyBanner && mode === "audit") {
    rows.unshift([], [LEGACY_AUDIT_BANNER])
  }
  const content = rowsToCsv(rows)
  const filename = resolveSnapshotFilename(snapshot, filenamePrefix, runMeta, mode)
  return {
    content,
    filename,
    contentSha256: sha256Hex(content),
    contentLength: Buffer.byteLength(content, "utf8"),
  }
}

export async function recordPayrollExportDownloadEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  args: {
    businessId: string
    payrollRunId: string
    snapshotId: string
    exportType: PayrollExportType
    mode: PayrollExportMode
    actualContentSha256: string
    filename: string
    rendererVersion: string
    contentLength: number
  }
): Promise<{ error?: NextResponse }> {
  const { error } = await supabase.rpc("record_payroll_export_event", {
    p_business_id: args.businessId,
    p_payroll_run_id: args.payrollRunId,
    p_snapshot_id: args.snapshotId,
    p_export_type: args.exportType,
    p_mode: args.mode,
    p_actual_content_sha256: args.actualContentSha256,
    p_filename: args.filename,
    p_renderer_version: args.rendererVersion,
    p_content_length: args.contentLength,
  })

  if (error) {
    const code = extractPayrollExportErrorCode(error as { message?: string; details?: string })
    if (code && code !== "PAYROLL_EXPORT_FAILED") {
      return { error: mapPayrollExportRpcError(error as { message?: string; details?: string }) }
    }
    return {
      error: NextResponse.json(
        {
          error: String(
            (error as { message?: string }).message || "Failed to record payroll export download event"
          ),
          code: "PAYROLL_EXPORT_EVENT_RECORDING_FAILED",
        },
        { status: payrollExportErrorStatus("PAYROLL_EXPORT_EVENT_RECORDING_FAILED") }
      ),
    }
  }

  return {}
}

export function buildSnapshotExportResponse(args: {
  snapshot: PayrollExportSnapshotRow
  mode: PayrollExportMode
  payrollRun: Record<string, unknown>
  filenamePrefix: string
  legacyBanner?: boolean
}): NextResponse {
  const rendered = renderPayrollExportContent(args)
  return payrollCsvDownloadResponse(rendered.filename, rendered.content).response
}

export function legacySnapshotMissingResponse(mode: PayrollExportMode): NextResponse {
  if (mode === "audit") {
    return NextResponse.json(
      {
        error: "No approval-time export snapshot exists for this payroll run",
        code: "PAYROLL_EXPORT_LEGACY_SNAPSHOT_MISSING",
      },
      { status: 400 }
    )
  }
  return NextResponse.json(
    {
      error: "No approval-time export snapshot exists for this payroll run",
      code: "PAYROLL_EXPORT_LEGACY_SNAPSHOT_MISSING",
    },
    { status: 400 }
  )
}

export function reversedPreparationBlockedResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "Preparation export is unavailable because this payroll run was reversed",
      code: "PAYROLL_RUN_REVERSED",
    },
    { status: payrollExportErrorStatus("PAYROLL_RUN_REVERSED") }
  )
}

export { LEGACY_AUDIT_BANNER, GRA_DT107A_PAYE_HEADER_ROW }
