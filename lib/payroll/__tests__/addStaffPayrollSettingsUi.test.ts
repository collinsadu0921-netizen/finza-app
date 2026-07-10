import fs from "fs"
import path from "path"
import { parseStaffPayrollTaxFieldsFromRequestBody } from "@/lib/payroll/staffTaxProfile"

describe("parseStaffPayrollTaxFieldsFromRequestBody", () => {
  it("parses explicit false pensionable", () => {
    const result = parseStaffPayrollTaxFieldsFromRequestBody({ is_pensionable: false })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.fields.is_pensionable).toBe(false)
  })

  it("returns empty fields when tax profile omitted", () => {
    const result = parseStaffPayrollTaxFieldsFromRequestBody({})
    expect(result.ok).toBe(true)
    if (result.ok) expect(Object.keys(result.fields)).toHaveLength(0)
  })

  it("normalizes gra position code", () => {
    const result = parseStaffPayrollTaxFieldsFromRequestBody({ gra_position_code: "senr" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.fields.gra_position_code).toBe("SENR")
  })

  it("rejects invalid gra position code", () => {
    const result = parseStaffPayrollTaxFieldsFromRequestBody({ gra_position_code: "BAD" })
    expect(result.ok).toBe(false)
  })
})

describe("Add Staff payroll settings UI", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "app", "service", "settings", "staff", "page.tsx"),
    "utf8"
  )

  it("shows payroll settings section in Add Staff modal", () => {
    expect(source).toContain("Payroll settings")
    expect(source).toContain("is_pensionable")
    expect(source).toContain("is_tax_resident")
    expect(source).toContain("gra_position_code")
    expect(source).toContain("GRA_POSITION_CODES")
  })

  it("defaults pensionable to checked in form state", () => {
    expect(source).toContain("is_pensionable: true")
  })

  it("marks start date required in Add UI", () => {
    expect(source).toContain("Start Date *")
    expect(source).toMatch(/start_date[\s\S]*required/)
    expect(source).toContain("Please enter a start date")
  })

  it("discloses resident and pensionable defaults", () => {
    expect(source).toContain(
      "New staff are created as tax resident and pensionable unless you change these settings."
    )
  })

  it("offers post-create payroll settings review link", () => {
    expect(source).toContain("Review payroll settings")
    expect(source).toContain("/service/payroll/staff/")
  })
})
