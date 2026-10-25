import { describe, it, expect } from "@jest/globals"
import { exportButtonClassName } from "@/components/ui/ExportButton"

describe("exportButtonClassName", () => {
  it("shares the Balance Sheet button shell across variants", () => {
    for (const variant of ["csv", "pdf", "print", "neutral"] as const) {
      const classes = exportButtonClassName(variant)
      expect(classes).toContain("rounded-lg")
      expect(classes).toContain("px-3")
      expect(classes).toContain("py-1.5")
      expect(classes).toContain("bg-white")
    }
  })

  it("keeps CSV/Print neutral and PDF destructive", () => {
    expect(exportButtonClassName("csv")).toContain("border-gray-300")
    expect(exportButtonClassName("print")).toContain("border-gray-300")
    expect(exportButtonClassName("pdf")).toContain("border-red-200")
    expect(exportButtonClassName("pdf")).toContain("text-red-600")
  })

  it("appends page-specific classes without dropping the shared shell", () => {
    const classes = exportButtonClassName("csv", "h-10 px-3.5")
    expect(classes).toContain("rounded-lg")
    expect(classes).toContain("h-10")
    expect(classes).toContain("px-3.5")
  })
})
