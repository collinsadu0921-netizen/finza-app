/**
 * Unit tests for lib/payrollEngine/jurisdictions/rwanda.ts
 * 
 * Tests validate:
 * - Rwanda payroll engine calculates correctly
 * - PAYE progressive tax bands (monthly)
 * - RSSB Pension contributions (versioned: 3%+3% before 2025, 6%+6% from 2025)
 * - RSSB Maternity contributions (0.3%+0.3%)
 * - CBHI (0.5% of net salary, employee-only)
 * - Taxable income calculation (no relief for pension/maternity)
 * - Net salary calculation
 * - Structure matches PayrollCalculationResult contract
 */

import { calculatePayroll } from "../payrollEngine"
import { rwandaPayrollEngine, RWANDA_PAYROLL_DUE_DATES } from "../payrollEngine/jurisdictions/rwanda"

describe("Payroll Engine - Rwanda Calculations", () => {
  describe("PAYE Calculations", () => {
    describe("PAYE Boundary Checks", () => {
      it("calculates PAYE = 0 for taxableMonthly = 60,000", () => {
        const result = rwandaPayrollEngine.calculate({
          jurisdiction: "RW",
          effectiveDate: "2024-01-01",
          basicSalary: 60000,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        expect(paye?.amount).toBe(0)
        expect(paye?.base).toBeCloseTo(60000, 2)
      })

      it("calculates PAYE = 4,000 for taxableMonthly = 100,000", () => {
        const result = rwandaPayrollEngine.calculate({
          jurisdiction: "RW",
          effectiveDate: "2024-01-01",
          basicSalary: 100000,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = (100,000 - 60,000) * 0.10 = 40,000 * 0.10 = 4,000
        expect(paye?.amount).toBeCloseTo(4000, 2)
        expect(paye?.base).toBeCloseTo(100000, 2)
      })

      it("calculates PAYE = 24,000 for taxableMonthly = 200,000", () => {
        const result = rwandaPayrollEngine.calculate({
          jurisdiction: "RW",
          effectiveDate: "2024-01-01",
          basicSalary: 200000,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 4,000 + (200,000 - 100,000) * 0.20 = 4,000 + 100,000 * 0.20 = 4,000 + 20,000 = 24,000
        expect(paye?.amount).toBeCloseTo(24000, 2)
        expect(paye?.base).toBeCloseTo(200000, 2)
      })

      it("calculates PAYE = 39,000 for taxableMonthly = 250,000", () => {
        const result = rwandaPayrollEngine.calculate({
          jurisdiction: "RW",
          effectiveDate: "2024-01-01",
          basicSalary: 250000,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 24,000 + (250,000 - 200,000) * 0.30 = 24,000 + 50,000 * 0.30 = 24,000 + 15,000 = 39,000
        expect(paye?.amount).toBeCloseTo(39000, 2)
        expect(paye?.base).toBeCloseTo(250000, 2)
      })
    })

    describe("PAYE Progressive Bands", () => {
      it("calculates PAYE correctly in first band (60,001 <= taxable <= 100,000)", () => {
        const result = rwandaPayrollEngine.calculate({
          jurisdiction: "RW",
          effectiveDate: "2024-01-01",
          basicSalary: 80000,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = (80,000 - 60,000) * 0.10 = 20,000 * 0.10 = 2,000
        expect(paye?.amount).toBeCloseTo(2000, 2)
      })

      it("calculates PAYE correctly in second band (100,001 <= taxable <= 200,000)", () => {
        const result = rwandaPayrollEngine.calculate({
          jurisdiction: "RW",
          effectiveDate: "2024-01-01",
          basicSalary: 150000,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 4,000 + (150,000 - 100,000) * 0.20 = 4,000 + 50,000 * 0.20 = 4,000 + 10,000 = 14,000
        expect(paye?.amount).toBeCloseTo(14000, 2)
      })

      it("calculates PAYE correctly in third band (taxable > 200,000)", () => {
        const result = rwandaPayrollEngine.calculate({
          jurisdiction: "RW",
          effectiveDate: "2024-01-01",
          basicSalary: 300000,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 24,000 + (300,000 - 200,000) * 0.30 = 24,000 + 100,000 * 0.30 = 24,000 + 30,000 = 54,000
        expect(paye?.amount).toBeCloseTo(54000, 2)
      })
    })
  })

  describe("Pension Contributions", () => {
    describe("Pension Versioning", () => {
      it("calculates pension 3% employee + 3% employer for effectiveDate before 2025-01-01", () => {
        const result = rwandaPayrollEngine.calculate({
          jurisdiction: "RW",
          effectiveDate: "2024-12-01",
          basicSalary: 1000000,
          allowances: 0,
          otherDeductions: 0,
        })

        const pensionEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_PENSION_EMPLOYEE")
        const pensionEmployer = result.employerContributions.find(c => c.code === "RSSB_PENSION_EMPLOYER")

        expect(pensionEmployee).toBeDefined()
        expect(pensionEmployee?.amount).toBeCloseTo(1000000 * 0.03, 2) // 3% = 30,000
        expect(pensionEmployee?.rate).toBe(0.03)

        expect(pensionEmployer).toBeDefined()
        expect(pensionEmployer?.amount).toBeCloseTo(1000000 * 0.03, 2) // 3% = 30,000
        expect(pensionEmployer?.rate).toBe(0.03)
      })

      it("calculates pension 6% employee + 6% employer for effectiveDate from 2025-01-01", () => {
        const result = rwandaPayrollEngine.calculate({
          jurisdiction: "RW",
          effectiveDate: "2025-01-01",
          basicSalary: 1000000,
          allowances: 0,
          otherDeductions: 0,
        })

        const pensionEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_PENSION_EMPLOYEE")
        const pensionEmployer = result.employerContributions.find(c => c.code === "RSSB_PENSION_EMPLOYER")

        expect(pensionEmployee).toBeDefined()
        expect(pensionEmployee?.amount).toBeCloseTo(1000000 * 0.06, 2) // 6% = 60,000
        expect(pensionEmployee?.rate).toBe(0.06)

        expect(pensionEmployer).toBeDefined()
        expect(pensionEmployer?.amount).toBeCloseTo(1000000 * 0.06, 2) // 6% = 60,000
        expect(pensionEmployer?.rate).toBe(0.06)
      })
    })
  })

  describe("Maternity Contributions", () => {
    it("calculates maternity 0.3% employee + 0.3% employer", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0,
      })

      const maternityEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_MATERNITY_EMPLOYEE")
      const maternityEmployer = result.employerContributions.find(c => c.code === "RSSB_MATERNITY_EMPLOYER")

      expect(maternityEmployee).toBeDefined()
      expect(maternityEmployee?.amount).toBeCloseTo(1000000 * 0.003, 2) // 0.3% = 3,000
      expect(maternityEmployee?.rate).toBe(0.003)

      expect(maternityEmployer).toBeDefined()
      expect(maternityEmployer?.amount).toBeCloseTo(1000000 * 0.003, 2) // 0.3% = 3,000
      expect(maternityEmployer?.rate).toBe(0.003)
    })
  })

  describe("CBHI Calculation", () => {
    it("calculates CBHI as 0.5% of netBeforeCbhi", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 200000,
        allowances: 0,
        otherDeductions: 0,
      })

      const cbhi = result.statutoryDeductions.find(d => d.code === "CBHI")
      expect(cbhi).toBeDefined()

      // Calculate expected values
      const grossMonthly = 200000
      const paye = 24000 // From PAYE calculation
      const pensionEmployee = 200000 * 0.03 // 3% = 6,000
      const maternityEmployee = 200000 * 0.003 // 0.3% = 600
      const netBeforeCbhi = grossMonthly - paye - pensionEmployee - maternityEmployee
      const expectedCbhi = netBeforeCbhi * 0.005

      expect(cbhi?.amount).toBeCloseTo(expectedCbhi, 2)
      expect(cbhi?.rate).toBe(0.005)
      expect(cbhi?.base).toBeCloseTo(netBeforeCbhi, 2)
    })

    it("calculates CBHI correctly with otherDeductions", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 200000,
        allowances: 0,
        otherDeductions: 10000,
      })

      const cbhi = result.statutoryDeductions.find(d => d.code === "CBHI")
      expect(cbhi).toBeDefined()

      // Calculate expected values
      const grossMonthly = 200000
      const paye = 24000
      const pensionEmployee = 200000 * 0.03 // 6,000
      const maternityEmployee = 200000 * 0.003 // 600
      const netBeforeCbhi = grossMonthly - paye - pensionEmployee - maternityEmployee - 10000
      const expectedCbhi = netBeforeCbhi * 0.005

      expect(cbhi?.amount).toBeCloseTo(expectedCbhi, 2)
    })

    it("ensures CBHI never makes netSalary negative", () => {
      // Use a very small gross to test edge case
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 10000,
        allowances: 0,
        otherDeductions: 0,
      })

      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })
  })

  describe("Taxable Income Calculation", () => {
    it("sets taxable income = grossMonthly (no relief for pension/maternity)", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 200000,
        allowances: 50000,
        otherDeductions: 0,
      })

      const grossMonthly = 250000
      expect(result.totals.taxableIncome).toBeCloseTo(grossMonthly, 2)
      expect(result.totals.taxableIncome).toBe(result.totals.grossSalary)
    })
  })

  describe("Net Salary Calculation", () => {
    it("calculates netSalary = grossMonthly - PAYE - pensionEmployee - maternityEmployee - otherDeductions - CBHI", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 200000,
        allowances: 0,
        otherDeductions: 10000,
      })

      const grossMonthly = 200000
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0
      const pensionEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_PENSION_EMPLOYEE")?.amount || 0
      const maternityEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_MATERNITY_EMPLOYEE")?.amount || 0
      const cbhi = result.statutoryDeductions.find(d => d.code === "CBHI")?.amount || 0

      const netBeforeCbhi = grossMonthly - paye - pensionEmployee - maternityEmployee - 10000
      const expectedNet = netBeforeCbhi - cbhi

      expect(result.totals.netSalary).toBeCloseTo(expectedNet, 2)
      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })

    it("ensures netSalary never goes negative", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 10000,
        allowances: 0,
        otherDeductions: 50000, // More than gross
      })

      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })
  })

  describe("Output Structure", () => {
    it("returns valid PayrollCalculationResult structure", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 200000,
        allowances: 50000,
        otherDeductions: 10000,
      })

      // Check earnings
      expect(result.earnings).toBeDefined()
      expect(typeof result.earnings.basicSalary).toBe("number")
      expect(typeof result.earnings.allowances).toBe("number")
      expect(typeof result.earnings.grossSalary).toBe("number")

      // Check statutory deductions (ordered: PAYE, RSSB_PENSION_EMPLOYEE, RSSB_MATERNITY_EMPLOYEE, CBHI)
      expect(Array.isArray(result.statutoryDeductions)).toBe(true)
      expect(result.statutoryDeductions.length).toBe(4)
      expect(result.statutoryDeductions[0].code).toBe("PAYE")
      expect(result.statutoryDeductions[1].code).toBe("RSSB_PENSION_EMPLOYEE")
      expect(result.statutoryDeductions[2].code).toBe("RSSB_MATERNITY_EMPLOYEE")
      expect(result.statutoryDeductions[3].code).toBe("CBHI")

      // Check employer contributions (ordered: RSSB_PENSION_EMPLOYER, RSSB_MATERNITY_EMPLOYER)
      expect(Array.isArray(result.employerContributions)).toBe(true)
      expect(result.employerContributions.length).toBe(2)
      expect(result.employerContributions[0].code).toBe("RSSB_PENSION_EMPLOYER")
      expect(result.employerContributions[1].code).toBe("RSSB_MATERNITY_EMPLOYER")

      // Check totals
      expect(result.totals).toBeDefined()
      expect(typeof result.totals.grossSalary).toBe("number")
      expect(typeof result.totals.totalStatutoryDeductions).toBe("number")
      expect(typeof result.totals.totalOtherDeductions).toBe("number")
      expect(typeof result.totals.taxableIncome).toBe("number")
      expect(typeof result.totals.netSalary).toBe("number")
      expect(typeof result.totals.totalEmployerContributions).toBe("number")
    })

    it("has no NaN or undefined values", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 200000,
        allowances: 50000,
        otherDeductions: 10000,
      })

      // Check earnings
      expect(Number.isFinite(result.earnings.basicSalary)).toBe(true)
      expect(Number.isFinite(result.earnings.allowances)).toBe(true)
      expect(Number.isFinite(result.earnings.grossSalary)).toBe(true)

      // Check statutory deductions
      result.statutoryDeductions.forEach(d => {
        expect(Number.isFinite(d.amount)).toBe(true)
        expect(Number.isFinite(d.rate)).toBe(true)
        expect(Number.isFinite(d.base)).toBe(true)
        expect(d.amount).not.toBeNaN()
        expect(d.amount).not.toBeUndefined()
      })

      // Check employer contributions
      result.employerContributions.forEach(c => {
        expect(Number.isFinite(c.amount)).toBe(true)
        expect(Number.isFinite(c.rate)).toBe(true)
        expect(Number.isFinite(c.base)).toBe(true)
        expect(c.amount).not.toBeNaN()
        expect(c.amount).not.toBeUndefined()
      })

      // Check totals
      expect(Number.isFinite(result.totals.grossSalary)).toBe(true)
      expect(Number.isFinite(result.totals.totalStatutoryDeductions)).toBe(true)
      expect(Number.isFinite(result.totals.totalOtherDeductions)).toBe(true)
      expect(Number.isFinite(result.totals.taxableIncome)).toBe(true)
      expect(Number.isFinite(result.totals.netSalary)).toBe(true)
      expect(Number.isFinite(result.totals.totalEmployerContributions)).toBe(true)
    })

    it("rounds all amounts to 2 decimal places", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 333333.333,
        allowances: 111111.111,
        otherDeductions: 55555.555,
      })

      const checkDecimals = (value: number) => {
        const str = value.toString()
        const decimalPart = str.split('.')[1]
        return !decimalPart || decimalPart.length <= 2
      }

      expect(checkDecimals(result.earnings.basicSalary)).toBe(true)
      expect(checkDecimals(result.earnings.allowances)).toBe(true)
      expect(checkDecimals(result.earnings.grossSalary)).toBe(true)
      expect(checkDecimals(result.totals.netSalary)).toBe(true)

      result.statutoryDeductions.forEach(d => {
        expect(checkDecimals(d.amount)).toBe(true)
      })

      result.employerContributions.forEach(c => {
        expect(checkDecimals(c.amount)).toBe(true)
      })
    })
  })

  describe("Totals Reconciliation", () => {
    it("totals reconcile correctly with all contributions", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 200000,
        allowances: 50000,
        otherDeductions: 10000,
      })

      // grossSalary = basicSalary + allowances
      expect(result.totals.grossSalary).toBe(result.earnings.basicSalary + result.earnings.allowances)

      // totalStatutoryDeductions = sum of all statutory deductions (PAYE + Pension + Maternity + Health Scheme)
      const calculatedTotal = result.statutoryDeductions.reduce((sum, d) => sum + d.amount, 0)
      expect(result.totals.totalStatutoryDeductions).toBeCloseTo(calculatedTotal, 2)

      // totalEmployerContributions = sum of all employer contributions (Pension + Maternity + Occupational Hazards + Health Scheme if RAMA)
      const calculatedEmployerTotal = result.employerContributions.reduce((sum, c) => sum + c.amount, 0)
      expect(result.totals.totalEmployerContributions).toBeCloseTo(calculatedEmployerTotal, 2)

      // Verify occupational hazards is included
      const hazards = result.employerContributions.find(c => c.code === "RSSB_OCCUPATIONAL_HAZARDS")
      expect(hazards).toBeDefined()
      expect(hazards?.amount).toBeGreaterThan(0)

      // taxableIncome = grossMonthly (no relief for pension/maternity)
      expect(result.totals.taxableIncome).toBeCloseTo(result.totals.grossSalary, 2)

      // netSalary = grossSalary - totalStatutoryDeductions - totalOtherDeductions
      const expectedNet = result.totals.grossSalary - result.totals.totalStatutoryDeductions - result.totals.totalOtherDeductions
      expect(result.totals.netSalary).toBeCloseTo(Math.max(0, expectedNet), 2)
    })
  })

  describe("Occupational Hazards (Audit-Ready 2026)", () => {
    it("calculates occupational hazards 2% employer-only for gross = 1,000,000", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0,
      })

      const hazards = result.employerContributions.find(c => c.code === "RSSB_OCCUPATIONAL_HAZARDS")
      expect(hazards).toBeDefined()
      expect(hazards?.amount).toBeCloseTo(1000000 * 0.02, 2) // 2% = 20,000
      expect(hazards?.rate).toBe(0.02)
      expect(hazards?.base).toBeCloseTo(1000000, 2)
    })

    it("includes occupational hazards in totalEmployerContributions", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0,
      })

      const calculatedTotal = result.employerContributions.reduce((sum, c) => sum + c.amount, 0)
      expect(result.totals.totalEmployerContributions).toBeCloseTo(calculatedTotal, 2)

      // Verify occupational hazards is included
      const hazards = result.employerContributions.find(c => c.code === "RSSB_OCCUPATIONAL_HAZARDS")
      expect(hazards?.amount).toBeGreaterThan(0)
    })
  })

  describe("Base Split (Pension vs Maternity)", () => {
    it("pension base includes transport, maternity base excludes transport", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 800000,
        allowances: 200000,
        otherDeductions: 0,
        transportAllowance: 100000,
      })

      const grossMonthly = 1000000
      const transport = 100000
      const pensionBase = grossMonthly // Includes transport
      const maternityBase = grossMonthly - transport // Excludes transport = 900,000

      // Check pension base
      const pensionEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_PENSION_EMPLOYEE")
      expect(pensionEmployee?.base).toBeCloseTo(pensionBase, 2)
      expect(pensionEmployee?.amount).toBeCloseTo(pensionBase * 0.03, 2) // 3% = 30,000

      // Check maternity base
      const maternityEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_MATERNITY_EMPLOYEE")
      expect(maternityEmployee?.base).toBeCloseTo(maternityBase, 2)
      expect(maternityEmployee?.amount).toBeCloseTo(maternityBase * 0.003, 2) // 0.3% = 2,700

      // Verify maternity amounts reflect 900,000 base (not 1,000,000)
      expect(maternityEmployee?.amount).toBeCloseTo(2700, 2) // 900,000 * 0.003 = 2,700
    })

    it("if transportAllowance undefined, maternityBase == grossMonthly (backward compatible)", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 800000,
        allowances: 200000,
        otherDeductions: 0,
        // transportAllowance not provided (defaults to 0)
      })

      const grossMonthly = 1000000
      const maternityEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_MATERNITY_EMPLOYEE")
      
      // Maternity base should equal grossMonthly when transportAllowance is 0
      expect(maternityEmployee?.base).toBeCloseTo(grossMonthly, 2)
      expect(maternityEmployee?.amount).toBeCloseTo(grossMonthly * 0.003, 2) // 0.3% = 3,000
    })
  })

  describe("RAMA Medical Scheme", () => {
    it("calculates RAMA 7.5% employee + 7.5% employer of basic salary only", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 200000, // RAMA ignores allowances
        otherDeductions: 0,
        healthScheme: 'RAMA',
      })

      const medicalEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_MEDICAL_EMPLOYEE")
      const medicalEmployer = result.employerContributions.find(c => c.code === "RSSB_MEDICAL_EMPLOYER")

      // RAMA: 7.5% of basic salary only (1,000,000)
      expect(medicalEmployee).toBeDefined()
      expect(medicalEmployee?.amount).toBeCloseTo(1000000 * 0.075, 2) // 7.5% = 75,000
      expect(medicalEmployee?.rate).toBe(0.075)
      expect(medicalEmployee?.base).toBeCloseTo(1000000, 2) // Basic salary

      expect(medicalEmployer).toBeDefined()
      expect(medicalEmployer?.amount).toBeCloseTo(1000000 * 0.075, 2) // 7.5% = 75,000
      expect(medicalEmployer?.rate).toBe(0.075)
      expect(medicalEmployer?.base).toBeCloseTo(1000000, 2) // Basic salary
    })

    it("ensures CBHI not present when RAMA is selected", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0,
        healthScheme: 'RAMA',
      })

      const cbhi = result.statutoryDeductions.find(d => d.code === "CBHI")
      const rama = result.statutoryDeductions.find(d => d.code === "RSSB_MEDICAL_EMPLOYEE")

      expect(cbhi).toBeUndefined()
      expect(rama).toBeDefined()
    })

    it("calculates netSalary correctly with RAMA (RAMA deducted before netSalary)", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 200000,
        allowances: 0,
        otherDeductions: 0,
        healthScheme: 'RAMA',
      })

      const grossMonthly = 200000
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0
      const pensionEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_PENSION_EMPLOYEE")?.amount || 0
      const maternityEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_MATERNITY_EMPLOYEE")?.amount || 0
      const ramaEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_MEDICAL_EMPLOYEE")?.amount || 0

      // netSalary = grossMonthly - PAYE - pensionEmployee - maternityEmployee - ramaEmployee
      const expectedNet = grossMonthly - paye - pensionEmployee - maternityEmployee - ramaEmployee

      expect(result.totals.netSalary).toBeCloseTo(expectedNet, 2)
      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })
  })

  describe("Default Behavior (Backward Compatibility)", () => {
    it("default healthScheme is CBHI (preserves existing behavior)", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 200000,
        allowances: 0,
        otherDeductions: 0,
        // healthScheme not provided (defaults to 'CBHI')
      })

      const cbhi = result.statutoryDeductions.find(d => d.code === "CBHI")
      const rama = result.statutoryDeductions.find(d => d.code === "RSSB_MEDICAL_EMPLOYEE")

      expect(cbhi).toBeDefined()
      expect(rama).toBeUndefined()
    })

    it("default transportAllowance is 0 (maternityBase == grossMonthly)", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: "RW",
        effectiveDate: "2024-01-01",
        basicSalary: 200000,
        allowances: 50000,
        otherDeductions: 0,
        // transportAllowance not provided (defaults to 0)
      })

      const grossMonthly = 250000
      const maternityEmployee = result.statutoryDeductions.find(d => d.code === "RSSB_MATERNITY_EMPLOYEE")
      
      // Maternity base should equal grossMonthly when transportAllowance is 0
      expect(maternityEmployee?.base).toBeCloseTo(grossMonthly, 2)
    })
  })

  describe("Due Date Constants", () => {
    it("exports RW_PAYE_DUE_DAY constant", () => {
      expect(RWANDA_PAYROLL_DUE_DATES.RW_PAYE_DUE_DAY).toBe(15)
    })

    it("exports RW_RSSB_DUE_DAY constant", () => {
      expect(RWANDA_PAYROLL_DUE_DATES.RW_RSSB_DUE_DAY).toBe(15)
    })

    it("exports RW_MEDICAL_DUE_DAY constant", () => {
      expect(RWANDA_PAYROLL_DUE_DATES.RW_MEDICAL_DUE_DAY).toBe(10)
    })
  })

  describe("Registry Integration", () => {
    it("resolves Rwanda engine from registry", () => {
      const result = calculatePayroll(
        {
          jurisdiction: "RW",
          effectiveDate: "2024-01-01",
          basicSalary: 200000,
          allowances: 0,
          otherDeductions: 0,
        },
        "RW"
      )

      expect(result).toBeDefined()
      expect(result.statutoryDeductions.length).toBeGreaterThan(0)
      expect(result.employerContributions.length).toBeGreaterThan(0)
    })
  })
})
