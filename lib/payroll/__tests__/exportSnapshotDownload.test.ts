import {
  buildDt107aAuditMetadataLines,
  buildSnapshotExportResponse,
  normalizePayrollExportMode,
  payrollExportErrorStatus,
  rawCsvResponse,
  renderPayrollExportContent,
  renderSnapshotCsvRows,
  rowsToCsv,
  sha256Hex,
  verifySnapshotContentHashes,
  type PayrollExportSnapshotRow,
} from "@/lib/payroll/exportSnapshotDownload"
import { GRA_DT107A_PAYE_HEADER_ROW } from "@/lib/payroll/graDt107aPayeExport"

function sampleDt107aSnapshot(overrides: Partial<PayrollExportSnapshotRow> = {}): PayrollExportSnapshotRow {
  const header = [...GRA_DT107A_PAYE_HEADER_ROW]
  const cells = [
    "C0000000001",
    'Ada "Lovelace"',
    "1",
    "OTHR",
    "N",
    "1000.00",
    "N",
    "55.00",
    "0.00",
    "0.00",
    "0.00",
    "0.00",
    "0.00",
    "1000.00",
    "0.00",
    "0.00",
    "0.00",
    "1000.00",
    "0.00",
    "0.00",
    "945.00",
    "50.00",
    "0.00",
    "0.00",
    "50.00",
    "0.00",
    "",
  ]
  const body = rowsToCsv([header, cells]) + "\n"
  return {
    id: "11111111-1111-1111-1111-111111111111",
    business_id: "22222222-2222-2222-2222-222222222222",
    payroll_run_id: "33333333-3333-3333-3333-333333333333",
    export_type: "gra_dt107a",
    snapshot_schema_version: "gra-dt107a-schema-v1",
    renderer_version: "gra-dt107a-renderer-v1",
    template_version: "gra-dt0107a-monthly-v1",
    template_reference: "GRA DT 0107A uploadable monthly PAYE employee format v1",
    source_run_status: "approved",
    source_payload: {
      schema: "gra-dt107a-schema-v1",
      header,
      expected_column_count: 27,
      run: {
        payroll_month: "2026-01-01",
        pay_period_start: "2026-01-01",
        pay_period_end: "2026-01-31",
        payroll_frequency: "monthly",
        run_type: "regular",
        source_status: "approved",
        approved_at: "2026-01-15T10:00:00.000Z",
        approved_by: "user-1",
        calculation_engine_version: "finza-ghana-v2",
        paye_rate_version: "gh-paye-2026",
        pension_rate_version: "gh-pension-2026",
        calculation_jurisdiction: "GH",
        statutory_period_basis: "2026-01-01",
      },
      business: {
        id: "22222222-2222-2222-2222-222222222222",
        legal_name: "Acme Ltd",
        trading_name: "Acme",
        tin: "C0000000000",
      },
      rows: [
        {
          staff_id: "44444444-4444-4444-4444-444444444444",
          serial_number: 1,
          cells,
        },
      ],
    },
    source_payload_sha256: "a".repeat(64),
    row_count: 1,
    control_totals: { total_paye: 50, included_employee_count: 1 },
    rendered_content: body,
    rendered_content_sha256: sha256Hex(body),
    content_type: "text/csv",
    filename: "dt107a-preparation-2026-01.csv",
    materialized_at: "2026-01-15T00:00:00.000Z",
    created_at: "2026-01-15T00:00:00.000Z",
    created_by: null,
    ...overrides,
  }
}

describe("exportSnapshotDownload", () => {
  it("normalizes gra-ready to preparation", () => {
    expect(normalizePayrollExportMode("gra-ready")).toBe("preparation")
    expect(normalizePayrollExportMode("preparation")).toBe("preparation")
    expect(normalizePayrollExportMode("audit")).toBe("audit")
  })

  it("verifies rendered content hash and fails closed on tamper", () => {
    const snap = sampleDt107aSnapshot()
    expect(verifySnapshotContentHashes(snap).ok).toBe(true)
    const bad = sampleDt107aSnapshot({
      rendered_content: snap.rendered_content + "x",
    })
    expect(verifySnapshotContentHashes(bad).ok).toBe(false)
  })

  it("returns byte-identical DT107A preparation content without BOM", async () => {
    const snap = sampleDt107aSnapshot()
    const rendered = renderPayrollExportContent({
      snapshot: snap,
      mode: "preparation",
      payrollRun: { id: snap.payroll_run_id, status: "approved", payroll_month: "2026-01-01" },
      filenamePrefix: "gra-dt107a-paye-preparation",
    })
    expect(rendered.content.startsWith("\uFEFF")).toBe(false)
    expect(rendered.content).toBe(snap.rendered_content)
    expect(rendered.content.split("\n")[0].split(",").length).toBe(27)
    expect(rendered.contentSha256).toBe(snap.rendered_content_sha256)
    expect(rendered.contentLength).toBe(Buffer.byteLength(rendered.content, "utf8"))
    expect(rendered.content).toContain('Ada ""Lovelace""')

    const res = buildSnapshotExportResponse({
      snapshot: snap,
      mode: "preparation",
      payrollRun: { id: snap.payroll_run_id, status: "approved", payroll_month: "2026-01-01" },
      filenamePrefix: "gra-dt107a-paye-preparation",
    })
    const csv = await res.text()
    expect(csv).toBe(rendered.content)
  })

  it("uses different content hashes for DT107A preparation vs audit", () => {
    const snap = sampleDt107aSnapshot()
    const payrollRun = {
      id: snap.payroll_run_id,
      status: "approved",
      payroll_month: "2026-01-01",
      reversed_at: null,
    }
    const preparation = renderPayrollExportContent({
      snapshot: snap,
      mode: "preparation",
      payrollRun,
      filenamePrefix: "gra-dt107a-paye-preparation",
    })
    const audit = renderPayrollExportContent({
      snapshot: snap,
      mode: "audit",
      payrollRun,
      filenamePrefix: "gra-dt107a-paye-audit",
    })
    expect(preparation.contentSha256).toBe(snap.rendered_content_sha256)
    expect(audit.contentSha256).not.toBe(preparation.contentSha256)
    expect(audit.content).toContain("# Finza DT 107A audit export")
    expect(audit.content.endsWith(snap.rendered_content || "")).toBe(true)
  })

  it("buildDt107aAuditMetadataLines uses snapshot payload for approval fields", () => {
    const snap = sampleDt107aSnapshot()
    const lines = buildDt107aAuditMetadataLines(snap, {
      status: "reversed",
      reversed_at: "2026-02-01T00:00:00.000Z",
      approved_at: "2099-01-01T00:00:00.000Z",
      approved_by: "live-user",
    })
    const flat = lines.flat().join("\n")
    expect(flat).toContain("2026-01-15T10:00:00.000Z")
    expect(flat).toContain("user-1")
    expect(flat).not.toContain("2099-01-01T00:00:00.000Z")
    expect(flat).not.toContain("live-user")
    expect(flat).toContain("reversed")
    expect(flat).toContain("approved")
    expect(flat).toContain("Acme")
    expect(flat).toContain("finza-ghana-v2")
  })

  it("maps hardened payroll export error codes to expected HTTP statuses", () => {
    expect(payrollExportErrorStatus("PAYROLL_EXPORT_PERMISSION_DENIED")).toBe(403)
    expect(payrollExportErrorStatus("PAYROLL_RUN_REVERSED")).toBe(409)
    expect(payrollExportErrorStatus("PAYROLL_EXPORT_SNAPSHOT_CORRUPTED")).toBe(500)
    expect(payrollExportErrorStatus("PAYROLL_EXPORT_EVENT_RECORDING_FAILED")).toBe(500)
    expect(payrollExportErrorStatus("PAYROLL_EXPORT_SNAPSHOT_IMMUTABLE")).toBe(409)
  })

  it("escapes RFC-compatible CSV special characters through rowsToCsv", () => {
    const csv = rowsToCsv([["a,b", 'say "hi"', "line\nbreak", "plain"]])
    expect(csv).toBe('"a,b","say ""hi""","line\nbreak",plain')
  })

  it("fails closed on unknown paye_schedule renderer version", () => {
    const snap = sampleDt107aSnapshot({
      export_type: "paye_schedule",
      renderer_version: "paye-schedule-renderer-v999",
      rendered_content: null,
      rendered_content_sha256: null,
      source_payload: { rows: [] },
    })
    expect(() => renderSnapshotCsvRows(snap)).toThrow(/Unsupported PAYE schedule renderer/i)
  })

  it("rawCsvResponse does not prepend BOM", async () => {
    const res = rawCsvResponse("x.csv", "a,b\n")
    const text = await res.text()
    expect(text.startsWith("\uFEFF")).toBe(false)
    expect(text).toBe("a,b\n")
  })
})
