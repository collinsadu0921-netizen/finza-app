import { readFileSync } from "fs"
import path from "path"
import { describe, it, expect } from "@jest/globals"

const root = process.cwd()
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8")

describe("report PDF export source guards", () => {
  it("Trial Balance uses the standalone PDFKit loader", () => {
    const source = read("app/api/accounting/reports/trial-balance/export/pdf/route.ts")

    expect(source).toContain("createPdfKitDocument")
    expect(source).not.toContain('import("pdfkit")')
  })

  it.each([
    "app/api/accounting/reports/balance-sheet/export/pdf/route.ts",
    "app/api/accounting/reports/profit-and-loss/export/pdf/route.ts",
    "app/api/accounting/reports/general-ledger/export/pdf/route.ts",
  ])("draws footers without crossing the bottom margin: %s", (file) => {
    const source = read(file)

    expect(source).toContain("doc.page.margins.bottom = 0")
    expect(source).toContain("lineBreak: false")
  })

  it("report PDFs reset text fill after shaded rows", () => {
    for (const file of [
      "app/api/accounting/reports/balance-sheet/export/pdf/route.ts",
      "app/api/accounting/reports/general-ledger/export/pdf/route.ts",
      "app/api/accounting/reports/trial-balance/export/pdf/route.ts",
    ]) {
      expect(read(file)).toContain('doc.fillColor("#000000")')
    }
  })

  it("Trial Balance columns fit the portrait page", () => {
    const source = read("app/api/accounting/reports/trial-balance/export/pdf/route.ts")

    expect(source).toContain("const columnWidths = [62, 160, 55, 75, 75, 85]")
  })

  it("Ledger pagination has a deterministic unique tie-breaker", () => {
    const source = read("app/api/ledger/list/route.ts")

    expect(source).toContain('.order("date", { ascending: false })')
    expect(source).toContain('.order("created_at", { ascending: false })')
    expect(source).toContain('.order("id", { ascending: false })')
  })

  it("General Ledger columns fit the portrait page and do not truncate descriptions", () => {
    const source = read("app/api/accounting/reports/general-ledger/export/pdf/route.ts")

    expect(source).toContain("const columnWidths = [70, 210, 75, 75, 82]")
    expect(source).not.toContain("substring(0, 40)")
  })
})
