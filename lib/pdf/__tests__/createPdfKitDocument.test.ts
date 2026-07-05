import fs from "fs"
import path from "path"
import { withPdfKitBundledFonts } from "../createPdfKitDocument"

describe("withPdfKitBundledFonts", () => {
  it("reads vendored Helvetica.afm when pdfkit data path is missing", () => {
    const missingPdfKitPath = path.join(process.cwd(), "fake-pdfkit-data", "Helvetica.afm")
    const bundledPath = path.join(process.cwd(), "lib", "pdf", "pdfkit-data", "Helvetica.afm")

    expect(fs.existsSync(bundledPath)).toBe(true)
    expect(fs.existsSync(missingPdfKitPath)).toBe(false)

    const content = withPdfKitBundledFonts(() =>
      fs.readFileSync(missingPdfKitPath, "utf8")
    )

    expect(String(content)).toContain("StartFontMetrics")
    expect(fs.readFileSync(bundledPath, "utf8")).toBe(content)
  })
})
