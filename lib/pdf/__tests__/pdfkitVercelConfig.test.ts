import fs from "fs"
import path from "path"

const nextConfig = require("../../../next.config.js")

const GL_PDF_ROUTE = "/api/accounting/reports/general-ledger/export/pdf"

describe("pdfkit Vercel bundling config", () => {
  it("keeps pdfkit external for serverless runtime", () => {
    expect(nextConfig.serverExternalPackages).toContain("pdfkit")
  })

  it("includes standard font metrics for general ledger PDF export", () => {
    const includes = nextConfig.outputFileTracingIncludes?.[GL_PDF_ROUTE]
    expect(includes).toEqual(
      expect.arrayContaining(["./node_modules/pdfkit/js/data/**/*"])
    )
  })

  it("has Helvetica.afm available locally for pdfkit standard fonts", () => {
    const helveticaAfm = path.join(
      process.cwd(),
      "node_modules",
      "pdfkit",
      "js",
      "data",
      "Helvetica.afm"
    )
    expect(fs.existsSync(helveticaAfm)).toBe(true)
  })
})
