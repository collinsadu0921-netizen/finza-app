import {
  PAYROLL_DRAFT_DELETE_CONFIRM,
  canShowPayrollDraftDelete,
} from "@/lib/payroll/payrollDraftDeleteUi"
import fs from "fs"
import path from "path"

describe("canShowPayrollDraftDelete", () => {
  it("allows delete for draft runs only", () => {
    expect(canShowPayrollDraftDelete("draft")).toBe(true)
    expect(canShowPayrollDraftDelete("approved")).toBe(false)
    expect(canShowPayrollDraftDelete("locked")).toBe(false)
    expect(canShowPayrollDraftDelete(null)).toBe(false)
  })
})

describe("PAYROLL_DRAFT_DELETE_CONFIRM copy", () => {
  it("matches product wording", () => {
    expect(PAYROLL_DRAFT_DELETE_CONFIRM.title).toBe("Delete draft payroll?")
    expect(PAYROLL_DRAFT_DELETE_CONFIRM.confirmLabel).toBe("Delete draft")
    expect(PAYROLL_DRAFT_DELETE_CONFIRM.description).toContain("accounting records")
  })
})

describe("payroll draft delete UI wiring", () => {
  const root = path.join(__dirname, "..", "..", "..")

  it("detail page shows delete for draft runs with ConfirmProvider", () => {
    const source = fs.readFileSync(path.join(root, "app/payroll/[id]/page.tsx"), "utf8")
    expect(source).toContain("PAYROLL_DRAFT_DELETE_CONFIRM")
    expect(source).toContain("openConfirm")
    expect(source).toContain("canShowPayrollDraftDelete")
    expect(source).toMatch(/canShowPayrollDraftDelete\(payrollRun\.status\)/)
  })

  it("list page shows delete for draft runs only", () => {
    const source = fs.readFileSync(path.join(root, "app/payroll/page.tsx"), "utf8")
    expect(source).toContain("Delete draft")
    expect(source).toContain("canShowPayrollDraftDelete")
    expect(source).toMatch(/canShowPayrollDraftDelete\(run\.status\)/)
  })
})
