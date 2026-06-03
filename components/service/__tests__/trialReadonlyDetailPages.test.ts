import { describe, it, expect } from "@jest/globals"
import fs from "fs"
import path from "path"

const ROOT = path.join(__dirname, "..", "..", "..")

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8")
}

type DetailPageSpec = {
  label: string
  file: string
  /** Substrings that must appear when read-only hardening is wired */
  required: string[]
}

const DETAIL_PAGES: DetailPageSpec[] = [
  {
    label: "invoice detail",
    file: "app/invoices/[id]/view/page.tsx",
    required: ["useServiceFinancialWrite", "readOnly", "ServiceReadOnlyNotice"],
  },
  {
    label: "bill detail",
    file: "app/bills/[id]/view/page.tsx",
    required: ["useServiceFinancialWrite", "readOnly", "ServiceReadOnlyNotice"],
  },
  {
    label: "payroll run detail",
    file: "app/payroll/[id]/page.tsx",
    required: ["useServiceFinancialWrite", "readOnly", "ServiceReadOnlyNotice"],
  },
  {
    label: "accounting periods",
    file: "components/accounting/screens/PeriodsScreen.tsx",
    required: ["useServiceFinancialWrite", "readOnly", "ServiceReadOnlyNotice"],
  },
  {
    label: "proforma detail",
    file: "app/service/proforma/[id]/view/page.tsx",
    required: ["useServiceFinancialWrite", "readOnly", "ServiceReadOnlyNotice"],
  },
  {
    label: "credit note detail",
    file: "app/credit-notes/[id]/view/page.tsx",
    required: ["useServiceFinancialWrite", "readOnly", "ServiceReadOnlyNotice"],
  },
  {
    label: "estimate detail",
    file: "app/estimates/[id]/view/page.tsx",
    required: ["useServiceFinancialWrite", "readOnly", "ServiceReadOnlyNotice"],
  },
]

describe("trial read-only detail page hardening", () => {
  it.each(DETAIL_PAGES)("$label wires read-only helpers", ({ file, required }) => {
    const source = readSource(file)
    for (const marker of required) {
      expect(source).toContain(marker)
    }
  })

  it("invoice detail hides primary mutation actions behind readOnly", () => {
    const source = readSource("app/invoices/[id]/view/page.tsx")
    expect(source).toMatch(/!readOnly && invoice\.status === "draft"/)
    expect(source).toMatch(/remainingBalance > 0\.01 && invoice\.status !== 'draft' && !readOnly/)
  })

  it("bill detail hides edit and payment actions behind readOnly", () => {
    const source = readSource("app/bills/[id]/view/page.tsx")
    expect(source).toContain("!readOnly")
    expect(source).toMatch(/guardWriteAction/)
  })

  it("payroll detail hides approve/generate/send behind readOnly", () => {
    const source = readSource("app/payroll/[id]/page.tsx")
    expect(source).toContain("!readOnly")
  })

  it("accounting periods hides reopen and passes readOnly to PeriodCloseCenter", () => {
    const source = readSource("components/accounting/screens/PeriodsScreen.tsx")
    expect(source).toContain("canReopen && !readOnly")
    expect(source).toContain("readOnly={readOnly}")
  })
})
