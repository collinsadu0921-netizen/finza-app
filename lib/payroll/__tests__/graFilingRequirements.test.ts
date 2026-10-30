import { findMissingGraFilingDetails } from "@/lib/payroll/graFilingRequirements"

describe("GRA filing requirements", () => {
  it("allows a complete filing identity", () => {
    const missing = findMissingGraFilingDetails([
      {
        staff_id: "s1",
        filing_tin: "C0001111222",
        filing_employee_name: "Ama Serwaa",
        payroll_tax_profile: { gra_position_code: "MNGT" },
      },
    ])
    expect(missing).toEqual([])
  })

  it("flags a missing TIN or GRA position", () => {
    const missing = findMissingGraFilingDetails([
      {
        staff_id: "s1",
        filing_tin: "",
        filing_employee_name: "Ama Serwaa",
        payroll_tax_profile: { gra_position_code: "MNGT" },
      },
      {
        staff_id: "s2",
        filing_tin: "C0002222333",
        payroll_tax_profile: { gra_position_code: "" },
        staff: { name: "Kwame Mensah" },
      },
    ])

    expect(missing).toEqual([
      { staffId: "s1", employeeName: "Ama Serwaa" },
      { staffId: "s2", employeeName: "Kwame Mensah" },
    ])
  })

  it("ignores excluded employees", () => {
    const missing = findMissingGraFilingDetails([
      {
        staff_id: "s1",
        filing_tin: null,
        payroll_tax_profile: null,
        is_included: false,
      },
    ])
    expect(missing).toEqual([])
  })
})
