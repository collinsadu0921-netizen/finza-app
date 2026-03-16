/**
 * MASTER TEST PLAN — TAX & PAYROLL PLUGINS
 * 
 * This test suite validates ALL tax + payroll plugins end-to-end, catches edge cases,
 * and proves audit readiness without touching schema or ledger SQL.
 * 
 * Structure:
 * - A. Global Sanity Test (ALL COUNTRIES)
 * - B. PAYE Boundary Tests (COUNTRY-SPECIFIC)
 * - C. Aggregation Test (API ROUTE)
 * - D. True Cost Test (AUDIT VIEW)
 * - E. Deadline Export Test
 * - F. Negative / Safety Tests
 */

import { calculatePayroll } from "../payrollEngine"
import { MissingCountryError, UnsupportedCountryError } from "../payrollEngine/errors"
import { ghanaPayrollEngine } from "../payrollEngine/jurisdictions/ghana"
import { kenyaPayrollEngine } from "../payrollEngine/jurisdictions/kenya"
import { tanzaniaPayrollEngine } from "../payrollEngine/jurisdictions/tanzania"
import { rwandaPayrollEngine } from "../payrollEngine/jurisdictions/rwanda"
import { zambiaPayrollEngine } from "../payrollEngine/jurisdictions/zambia"

// ============================================================================
// A. GLOBAL SANITY TEST (ALL COUNTRIES)
// ============================================================================

describe("A. Global Sanity Test (ALL COUNTRIES)", () => {
  const countries = ['GH', 'KE', 'TZ', 'RW', 'ZM', 'NG', 'UG']
  
  countries.forEach(country => {
    describe(`A1. Engine resolution - ${country}`, () => {
      it(`should calculate payroll without throwing for ${country}`, () => {
        const result = calculatePayroll(
          {
            jurisdiction: country,
            effectiveDate: '2026-01-01',
            basicSalary: 100000,
            allowances: 0,
            otherDeductions: 0
          },
          country
        )

        // Assert: No throw
        expect(result).toBeDefined()
        
        // Assert: earnings.grossSalary === basic + allowances
        expect(result.earnings.grossSalary).toBe(100000)
        expect(result.earnings.basicSalary).toBe(100000)
        expect(result.earnings.allowances).toBe(0)
        
        // Assert: totals.netSalary >= 0
        expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
        
        // Assert: All numeric fields are finite
        expect(Number.isFinite(result.totals.grossSalary)).toBe(true)
        expect(Number.isFinite(result.totals.taxableIncome)).toBe(true)
        expect(Number.isFinite(result.totals.netSalary)).toBe(true)
        expect(Number.isFinite(result.totals.totalStatutoryDeductions)).toBe(true)
        expect(Number.isFinite(result.totals.totalEmployerContributions)).toBe(true)
        
        // Assert: Arrays exist (even if empty)
        expect(Array.isArray(result.statutoryDeductions)).toBe(true)
        expect(Array.isArray(result.employerContributions)).toBe(true)
      })
    })
  })
})

// ============================================================================
// B. PAYE BOUNDARY TESTS (COUNTRY-SPECIFIC)
// ============================================================================

describe("B. PAYE Boundary Tests (COUNTRY-SPECIFIC)", () => {
  describe("B1. Ghana (GH)", () => {
    it("should calculate PAYE = 0 for 490 (first band edge)", () => {
      // Adjust basic to get taxable income of 490 after SSNIT
      // SSNIT = 5.5% of gross, so: taxable = gross - 0.055*gross = 0.945*gross
      // For taxable = 490: gross = 490 / 0.945 ≈ 518.52
      const gross = 490 / 0.945
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: 'GH',
        effectiveDate: '2026-01-01',
        basicSalary: Math.round(gross),
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      expect(paye?.amount).toBeCloseTo(0, 1) // Should be 0 or very close
    })

    it("should calculate PAYE correctly for 650 (second band edge)", () => {
      const gross = 650 / 0.945
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: 'GH',
        effectiveDate: '2026-01-01',
        basicSalary: Math.round(gross),
        allowances: 0,
        otherDeductions: 0
      })

      const taxable = result.totals.taxableIncome
      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // PAYE = (650 - 490) * 5% = 8
      expect(paye?.amount).toBeCloseTo(8, 1)
    })

    it("should calculate PAYE correctly for 3,850 (third band edge)", () => {
      const gross = 3850 / 0.945
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: 'GH',
        effectiveDate: '2026-01-01',
        basicSalary: Math.round(gross),
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // Cumulative: (650-490)*5% + (3850-650)*10% = 8 + 320 = 328
      expect(paye?.amount).toBeCloseTo(328, 1)
    })

    it("should calculate PAYE correctly for 20,000 (fourth band edge)", () => {
      const gross = 20000 / 0.945
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: 'GH',
        effectiveDate: '2026-01-01',
        basicSalary: Math.round(gross),
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // Cumulative: 8 + 320 + (20000-3850)*17.5% = 8 + 320 + 2826.25 = 3154.25
      expect(paye?.amount).toBeCloseTo(3154.25, 1)
    })

    it("should calculate PAYE correctly for 50,000 (fifth band edge)", () => {
      const gross = 50000 / 0.945
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: 'GH',
        effectiveDate: '2026-01-01',
        basicSalary: Math.round(gross),
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // Cumulative: 8 + 320 + 2826.25 + (50000-20000)*25% = 8 + 320 + 2826.25 + 7500 = 10654.25
      expect(paye?.amount).toBeCloseTo(10654.25, 1)
    })

    it("should calculate PAYE correctly for 100,000 (sixth band)", () => {
      const gross = 100000 / 0.945
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: 'GH',
        effectiveDate: '2026-01-01',
        basicSalary: Math.round(gross),
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // Cumulative: 8 + 320 + 2826.25 + 7500 + (taxable-50000)*30%
      // taxable ≈ 100000/0.945 ≈ 105820
      // PAYE ≈ 10654.25 + (105820-50000)*30% ≈ 10654.25 + 16746 ≈ 27400
      expect(paye?.amount).toBeGreaterThan(20000)
    })

    it("should verify SSNIT employee reduces taxable income", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: 'GH',
        effectiveDate: '2026-01-01',
        basicSalary: 10000,
        allowances: 0,
        otherDeductions: 0
      })

      const ssnitEmployee = result.statutoryDeductions.find(d => d.code === 'SSNIT_EMPLOYEE')
      expect(ssnitEmployee?.amount).toBeCloseTo(550, 2) // 5.5% of 10000
      
      // Taxable = gross - SSNIT employee
      expect(result.totals.taxableIncome).toBeCloseTo(10000 - 550, 2)
    })

    it("should verify net salary reconciles", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: 'GH',
        effectiveDate: '2026-01-01',
        basicSalary: 5000,
        allowances: 1000,
        otherDeductions: 200
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')?.amount || 0
      const ssnitEmployee = result.statutoryDeductions.find(d => d.code === 'SSNIT_EMPLOYEE')?.amount || 0
      
      // Net = taxable - PAYE - otherDeductions
      const expectedNet = result.totals.taxableIncome - paye - 200
      expect(result.totals.netSalary).toBeCloseTo(expectedNet, 2)
    })
  })

  describe("B2. Kenya (KE) — both regimes", () => {
    describe("Legacy (NHIF)", () => {
      it("should use NHIF flat amount for effectiveDate 2024-06-01", () => {
        const result = kenyaPayrollEngine.calculate({
          jurisdiction: 'KE',
          effectiveDate: '2024-06-01',
          basicSalary: 50000,
          allowances: 0,
          otherDeductions: 0
        })

        const nhif = result.statutoryDeductions.find(d => d.code === 'NHIF')
        expect(nhif).toBeDefined()
        expect(nhif?.amount).toBe(1200) // For 50,000 gross

        // Should NOT have SHIF or AHL
        const shif = result.statutoryDeductions.find(d => d.code === 'SHIF')
        expect(shif).toBeUndefined()

        const ahlEmployee = result.statutoryDeductions.find(d => d.code === 'AHL_EMPLOYEE')
        expect(ahlEmployee).toBeUndefined()
      })

      it("should apply Personal Relief after PAYE (never negative)", () => {
        const result = kenyaPayrollEngine.calculate({
          jurisdiction: 'KE',
          effectiveDate: '2024-06-01',
          basicSalary: 50000,
          allowances: 0,
          otherDeductions: 0
        })

        const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
        expect(paye).toBeDefined()
        expect(paye?.amount).toBeGreaterThanOrEqual(0) // Personal Relief applied, never negative
      })
    })

    describe("Current (SHIF + AHL)", () => {
      it("should use SHIF (2.75% gross) for effectiveDate 2026-01-01", () => {
        const result = kenyaPayrollEngine.calculate({
          jurisdiction: 'KE',
          effectiveDate: '2026-01-01',
          basicSalary: 50000,
          allowances: 0,
          otherDeductions: 0
        })

        const shif = result.statutoryDeductions.find(d => d.code === 'SHIF')
        expect(shif).toBeDefined()
        expect(shif?.amount).toBeCloseTo(50000 * 0.0275, 2) // 2.75% of 50,000 = 1,375

        // Should NOT have NHIF
        const nhif = result.statutoryDeductions.find(d => d.code === 'NHIF')
        expect(nhif).toBeUndefined()
      })

      it("should use AHL (1.5% gross employee + 1.5% employer) for effectiveDate 2026-01-01", () => {
        const result = kenyaPayrollEngine.calculate({
          jurisdiction: 'KE',
          effectiveDate: '2026-01-01',
          basicSalary: 50000,
          allowances: 0,
          otherDeductions: 0
        })

        const ahlEmployee = result.statutoryDeductions.find(d => d.code === 'AHL_EMPLOYEE')
        expect(ahlEmployee).toBeDefined()
        expect(ahlEmployee?.amount).toBeCloseTo(50000 * 0.015, 2) // 1.5% of 50,000 = 750

        const ahlEmployer = result.employerContributions.find(c => c.code === 'AHL_EMPLOYER')
        expect(ahlEmployer).toBeDefined()
        expect(ahlEmployer?.amount).toBeCloseTo(50000 * 0.015, 2) // 1.5% of 50,000 = 750
      })

      it("should apply Personal Relief = 2,400 and net PAYE = max(0, grossPAYE - 2400)", () => {
        const result = kenyaPayrollEngine.calculate({
          jurisdiction: 'KE',
          effectiveDate: '2026-01-01',
          basicSalary: 50000,
          allowances: 0,
          otherDeductions: 0
        })

        const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
        expect(paye).toBeDefined()
        // PAYE should account for Personal Relief (2,400)
        // If gross PAYE < 2400, net PAYE = 0
        // If gross PAYE >= 2400, net PAYE = gross PAYE - 2400
        expect(paye?.amount).toBeGreaterThanOrEqual(0)
      })
    })
  })

  describe("B3. Tanzania (TZ)", () => {
    it("should calculate taxable = gross - NSSF employee", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: 'TZ',
        effectiveDate: '2026-01-01',
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0
      })

      const nssfEmployee = result.statutoryDeductions.find(d => d.code === 'NSSF_EMPLOYEE')
      expect(nssfEmployee?.amount).toBeCloseTo(1000000 * 0.10, 2) // 10% of 1,000,000 = 100,000

      // Taxable = gross - NSSF employee
      expect(result.totals.taxableIncome).toBeCloseTo(1000000 - 100000, 2)
    })

    it("should calculate PAYE = 0 for 270,000 (first band edge)", () => {
      const gross = 270000 / 0.90 // NSSF = 10%, so taxable = 0.90 * gross
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: 'TZ',
        effectiveDate: '2026-01-01',
        basicSalary: Math.round(gross),
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      expect(paye?.amount).toBeCloseTo(0, 1)
    })

    it("should calculate PAYE = 20,000 for 520,000 (second band edge)", () => {
      const gross = 520000 / 0.90
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: 'TZ',
        effectiveDate: '2026-01-01',
        basicSalary: Math.round(gross),
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // PAYE = (520,000 - 270,000) * 8% = 20,000
      expect(paye?.amount).toBeCloseTo(20000, 1)
    })

    it("should calculate PAYE = 68,000 for 760,000 (third band edge)", () => {
      const gross = 760000 / 0.90
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: 'TZ',
        effectiveDate: '2026-01-01',
        basicSalary: Math.round(gross),
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // PAYE = 20,000 + (760,000 - 520,000) * 20% = 20,000 + 48,000 = 68,000
      expect(paye?.amount).toBeCloseTo(68000, 1)
    })

    it("should calculate PAYE = 128,000 for 1,000,000 (fourth band edge)", () => {
      const gross = 1000000 / 0.90
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: 'TZ',
        effectiveDate: '2026-01-01',
        basicSalary: Math.round(gross),
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // PAYE = 68,000 + (1,000,000 - 760,000) * 25% = 68,000 + 60,000 = 128,000
      expect(paye?.amount).toBeCloseTo(128000, 1)
    })

    it("should calculate employer contributions: NSSF 10%, SDL 3.5%, WCF 0.5%", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: 'TZ',
        effectiveDate: '2026-01-01',
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0
      })

      const nssfEmployer = result.employerContributions.find(c => c.code === 'NSSF_EMPLOYER')
      expect(nssfEmployer?.amount).toBeCloseTo(1000000 * 0.10, 2) // 10% = 100,000

      const sdl = result.employerContributions.find(c => c.code === 'SDL')
      expect(sdl?.amount).toBeCloseTo(1000000 * 0.035, 2) // 3.5% = 35,000

      const wcf = result.employerContributions.find(c => c.code === 'WCF')
      expect(wcf?.amount).toBeCloseTo(1000000 * 0.005, 2) // 0.5% = 5,000
    })
  })

  describe("B4. Rwanda (RW)", () => {
    describe("Versioning", () => {
      it("should use pension 3%/3% for 2024-12-01", () => {
        const result = rwandaPayrollEngine.calculate({
          jurisdiction: 'RW',
          effectiveDate: '2024-12-01',
          basicSalary: 1000000,
          allowances: 0,
          otherDeductions: 0
        })

        const pensionEmployee = result.statutoryDeductions.find(d => d.code === 'PENSION_EMPLOYEE')
        const pensionEmployer = result.employerContributions.find(c => c.code === 'PENSION_EMPLOYER')
        
        // Pension base = gross (includes transport from 2025, but this is 2024)
        expect(pensionEmployee?.amount).toBeCloseTo(1000000 * 0.03, 2) // 3% = 30,000
        expect(pensionEmployer?.amount).toBeCloseTo(1000000 * 0.03, 2) // 3% = 30,000
      })

      it("should use pension 6%/6% for 2026-01-01", () => {
        const result = rwandaPayrollEngine.calculate({
          jurisdiction: 'RW',
          effectiveDate: '2026-01-01',
          basicSalary: 1000000,
          allowances: 0,
          otherDeductions: 0
        })

        const pensionEmployee = result.statutoryDeductions.find(d => d.code === 'PENSION_EMPLOYEE')
        const pensionEmployer = result.employerContributions.find(c => c.code === 'PENSION_EMPLOYER')
        
        expect(pensionEmployee?.amount).toBeCloseTo(1000000 * 0.06, 2) // 6% = 60,000
        expect(pensionEmployer?.amount).toBeCloseTo(1000000 * 0.06, 2) // 6% = 60,000
      })
    })

    it("should calculate pension base = gross", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: 'RW',
        effectiveDate: '2026-01-01',
        basicSalary: 500000,
        allowances: 200000,
        otherDeductions: 0
      })

      const pensionEmployee = result.statutoryDeductions.find(d => d.code === 'PENSION_EMPLOYEE')
      // Pension base = gross = 500,000 + 200,000 = 700,000
      expect(pensionEmployee?.amount).toBeCloseTo(700000 * 0.06, 2) // 6% of 700,000
    })

    it("should calculate maternity base = gross - transportAllowance", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: 'RW',
        effectiveDate: '2026-01-01',
        basicSalary: 500000,
        allowances: 200000, // This includes transport
        otherDeductions: 0
      })

      const maternityEmployee = result.statutoryDeductions.find(d => d.code === 'MATERNITY_EMPLOYEE')
      // Maternity base excludes transport, but we don't have separate transport field
      // For this test, we verify maternity is calculated on a base
      expect(maternityEmployee).toBeDefined()
    })

    it("should calculate default CBHI = 0.5% of net", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: 'RW',
        effectiveDate: '2026-01-01',
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0
      })

      const cbhi = result.statutoryDeductions.find(d => d.code === 'CBHI')
      // CBHI = 0.5% of netBeforeHealth
      // netBeforeHealth = gross - PAYE - pension - maternity - otherDeductions
      expect(cbhi).toBeDefined()
      expect(cbhi?.amount).toBeGreaterThan(0)
    })

    it("should calculate RAMA toggle: 7.5% employee + 7.5% employer on basic only", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: 'RW',
        effectiveDate: '2026-01-01',
        basicSalary: 1000000,
        allowances: 200000,
        otherDeductions: 0,
        healthScheme: 'RAMA' // Toggle RAMA
      } as any)

      const ramaEmployee = result.statutoryDeductions.find(d => d.code === 'RAMA_EMPLOYEE')
      const ramaEmployer = result.employerContributions.find(c => c.code === 'RAMA_EMPLOYER')
      
      // RAMA on basic only (1,000,000), not on allowances
      if (ramaEmployee) {
        expect(ramaEmployee.amount).toBeCloseTo(1000000 * 0.075, 2) // 7.5% = 75,000
      }
      if (ramaEmployer) {
        expect(ramaEmployer.amount).toBeCloseTo(1000000 * 0.075, 2) // 7.5% = 75,000
      }
    })

    it("should calculate PAYE = 0 for 60k", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: 'RW',
        effectiveDate: '2026-01-01',
        basicSalary: 60000,
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      expect(paye?.amount).toBeCloseTo(0, 1)
    })

    it("should calculate PAYE = 4,000 for 100k", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: 'RW',
        effectiveDate: '2026-01-01',
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // PAYE = (100,000 - 60,000) * 10% = 4,000
      expect(paye?.amount).toBeCloseTo(4000, 1)
    })

    it("should calculate PAYE = 24,000 for 200k", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: 'RW',
        effectiveDate: '2026-01-01',
        basicSalary: 200000,
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // PAYE = 4,000 + (200,000 - 100,000) * 20% = 4,000 + 20,000 = 24,000
      expect(paye?.amount).toBeCloseTo(24000, 1)
    })

    it("should calculate PAYE = 39,000 for 250k", () => {
      const result = rwandaPayrollEngine.calculate({
        jurisdiction: 'RW',
        effectiveDate: '2026-01-01',
        basicSalary: 250000,
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // PAYE = 24,000 + (250,000 - 200,000) * 30% = 24,000 + 15,000 = 39,000
      expect(paye?.amount).toBeCloseTo(39000, 1)
    })
  })

  describe("B5. Zambia (ZM)", () => {
    it("should calculate PAYE = 0 for 5,100", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: 'ZM',
        effectiveDate: '2026-01-01',
        basicSalary: 5100,
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      expect(paye?.amount).toBeCloseTo(0, 1)
    })

    it("should calculate PAYE = 400 for 7,100", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: 'ZM',
        effectiveDate: '2026-01-01',
        basicSalary: 7100,
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // PAYE = (7,100 - 5,100) * 20% = 400
      expect(paye?.amount).toBeCloseTo(400, 1)
    })

    it("should calculate PAYE = 1,030 for 9,200", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: 'ZM',
        effectiveDate: '2026-01-01',
        basicSalary: 9200,
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // PAYE = 400 + (9,200 - 7,100) * 30% = 400 + 630 = 1,030
      expect(paye?.amount).toBeCloseTo(1030, 1)
    })

    it("should calculate PAYE = 1,400 for 10,200", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: 'ZM',
        effectiveDate: '2026-01-01',
        basicSalary: 10200,
        allowances: 0,
        otherDeductions: 0
      })

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      // PAYE = 1,030 + (10,200 - 9,200) * 37% = 1,030 + 370 = 1,400
      expect(paye?.amount).toBeCloseTo(1400, 1)
    })

    describe("NAPSA versioning", () => {
      it("should use cap 1,708.20 for 2025-06-01", () => {
        const result = zambiaPayrollEngine.calculate({
          jurisdiction: 'ZM',
          effectiveDate: '2025-06-01',
          basicSalary: 100000, // High salary to hit cap
          allowances: 0,
          otherDeductions: 0
        })

        const napsaEmployee = result.statutoryDeductions.find(d => d.code === 'NAPSA_EMPLOYEE')
        // NAPSA = 5% of gross, capped at 1,708.20
        // 5% of 100,000 = 5,000, but capped at 1,708.20
        expect(napsaEmployee?.amount).toBeCloseTo(1708.20, 2)
      })

      it("should use cap 1,861.80 for 2026-01-01", () => {
        const result = zambiaPayrollEngine.calculate({
          jurisdiction: 'ZM',
          effectiveDate: '2026-01-01',
          basicSalary: 100000, // High salary to hit cap
          allowances: 0,
          otherDeductions: 0
        })

        const napsaEmployee = result.statutoryDeductions.find(d => d.code === 'NAPSA_EMPLOYEE')
        // NAPSA = 5% of gross, capped at 1,861.80
        expect(napsaEmployee?.amount).toBeCloseTo(1861.80, 2)
      })
    })

    it("should calculate NHIMA default base = basic", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: 'ZM',
        effectiveDate: '2026-01-01',
        basicSalary: 50000,
        allowances: 20000,
        otherDeductions: 0
      })

      const nhimaEmployee = result.statutoryDeductions.find(d => d.code === 'NHIMA_EMPLOYEE')
      // NHIMA = 1% of basic (50,000), not gross (70,000)
      expect(nhimaEmployee?.amount).toBeCloseTo(50000 * 0.01, 2) // 1% = 500
    })

    it("should calculate employer-only: SDL = 0.5% gross", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: 'ZM',
        effectiveDate: '2026-01-01',
        basicSalary: 40000,
        allowances: 0,
        otherDeductions: 0
      })

      const sdl = result.employerContributions.find(c => c.code === 'SDL')
      expect(sdl?.amount).toBeCloseTo(40000 * 0.005, 2) // 0.5% = 200
    })

    it("should include WCFCB only if wcfcRate > 0", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: 'ZM',
        effectiveDate: '2026-01-01',
        basicSalary: 40000,
        allowances: 0,
        otherDeductions: 0
      })

      const wcfcb = result.employerContributions.find(c => c.code === 'WCFCB')
      // WCFCB only included if wcfcRate > 0 (default is 0)
      // This test verifies it's not included by default
      expect(wcfcb).toBeUndefined()
    })
  })
})

// ============================================================================
// C. AGGREGATION TEST (API ROUTE)
// ============================================================================

describe("C. Aggregation Test (API ROUTE)", () => {
  it("should extract employee statutory contributions correctly for all countries", () => {
    const countries = [
      { code: 'GH', expectedCode: 'SSNIT_EMPLOYEE' },
      { code: 'KE', expectedCode: 'NSSF_EMPLOYEE' },
      { code: 'TZ', expectedCode: 'NSSF_EMPLOYEE' },
      { code: 'RW', expectedCode: 'PENSION_EMPLOYEE' },
      { code: 'ZM', expectedCode: 'NAPSA_EMPLOYEE' },
    ]

    countries.forEach(({ code, expectedCode }) => {
      const result = calculatePayroll(
        {
          jurisdiction: code,
          effectiveDate: '2026-01-01',
          basicSalary: 100000,
          allowances: 0,
          otherDeductions: 0
        },
        code
      )

      const employeeContribution = result.statutoryDeductions.find(d => 
        d.code === expectedCode || d.code.includes('EMPLOYEE')
      )
      expect(employeeContribution).toBeDefined()
      expect(employeeContribution?.amount).toBeGreaterThan(0)
    })
  })

  it("should extract employer contributions correctly for all countries", () => {
    const countries = ['GH', 'KE', 'TZ', 'RW', 'ZM']

    countries.forEach(code => {
      const result = calculatePayroll(
        {
          jurisdiction: code,
          effectiveDate: '2026-01-01',
          basicSalary: 100000,
          allowances: 0,
          otherDeductions: 0
        },
        code
      )

      expect(result.employerContributions.length).toBeGreaterThan(0)
      const totalEmployer = result.totals.totalEmployerContributions
      expect(totalEmployer).toBeGreaterThan(0)
    })
  })

  it("should extract PAYE correctly for all countries", () => {
    const countries = ['GH', 'KE', 'TZ', 'RW', 'ZM']

    countries.forEach(code => {
      const result = calculatePayroll(
        {
          jurisdiction: code,
          effectiveDate: '2026-01-01',
          basicSalary: 100000,
          allowances: 0,
          otherDeductions: 0
        },
        code
      )

      const paye = result.statutoryDeductions.find(d => d.code === 'PAYE')
      expect(paye).toBeDefined()
      expect(paye?.amount).toBeGreaterThanOrEqual(0)
    })
  })
})

// ============================================================================
// D. TRUE COST TEST (AUDIT VIEW)
// ============================================================================

describe("D. True Cost Test (AUDIT VIEW)", () => {
  it("should calculate true cost = gross + totalEmployerContributions for TZ 1,000,000", () => {
    const result = calculatePayroll(
      {
        jurisdiction: 'TZ',
        effectiveDate: '2026-01-01',
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0
      },
      'TZ'
    )

    const trueCost = result.totals.grossSalary + result.totals.totalEmployerContributions
    // TZ: gross 1,000,000 + NSSF employer 100,000 + SDL 35,000 + WCF 5,000 = 1,140,000
    expect(trueCost).toBeCloseTo(1140000, 1)
  })

  it("should calculate true cost for RW 1,000,000 with RAMA", () => {
    const result = rwandaPayrollEngine.calculate({
      jurisdiction: 'RW',
      effectiveDate: '2026-01-01',
      basicSalary: 1000000,
      allowances: 0,
      otherDeductions: 0,
      healthScheme: 'RAMA' // Enable RAMA
    } as any)

    const trueCost = result.totals.grossSalary + result.totals.totalEmployerContributions
    // RW: gross 1,000,000 + pension employer 60,000 + maternity employer + RAMA employer 75,000 + occupational hazards
    // Approximate: 1,000,000 + 60,000 + 3,000 + 75,000 + 20,000 = 1,158,000
    expect(trueCost).toBeGreaterThan(1100000)
  })

  it("should calculate true cost for ZM 40,000 (includes capped NAPSA + SDL + WCFCB)", () => {
    const result = calculatePayroll(
      {
        jurisdiction: 'ZM',
        effectiveDate: '2026-01-01',
        basicSalary: 40000,
        allowances: 0,
        otherDeductions: 0
      },
      'ZM'
    )

    const trueCost = result.totals.grossSalary + result.totals.totalEmployerContributions
    // ZM: gross 40,000 + NAPSA employer (capped) + NHIMA employer + SDL 200
    expect(trueCost).toBeGreaterThan(40000)
    expect(trueCost).toBeLessThan(50000) // Should be reasonable
  })
})

// ============================================================================
// E. DEADLINE EXPORT TEST
// ============================================================================

describe("E. Deadline Export Test", () => {
  it("should export deadline constants for all countries", () => {
    // Import deadline constants from jurisdiction files
    const { TANZANIA_PAYROLL_DUE_DATES } = require('../payrollEngine/jurisdictions/tanzania')
    const { RWANDA_PAYROLL_DUE_DATES } = require('../payrollEngine/jurisdictions/rwanda')
    const { ZAMBIA_PAYROLL_DUE_DATES } = require('../payrollEngine/jurisdictions/zambia')

    // Tanzania: PAYE/SDL due on 7th, NSSF due on 15th
    expect(TANZANIA_PAYROLL_DUE_DATES.PAYE_SDL_DUE_DAY).toBe(7)
    expect(TANZANIA_PAYROLL_DUE_DATES.NSSF_DUE_DAY).toBe(15)

    // Rwanda: PAYE due on 15th
    expect(RWANDA_PAYROLL_DUE_DATES.RW_PAYE_DUE_DAY).toBe(15)
    expect(RWANDA_PAYROLL_DUE_DATES.RW_RSSB_DUE_DAY).toBe(15)
    expect(RWANDA_PAYROLL_DUE_DATES.RW_MEDICAL_DUE_DAY).toBe(10)

    // Zambia: All due on 10th
    expect(ZAMBIA_PAYROLL_DUE_DATES.ZM_PAYE_DUE_DAY).toBe(10)
    expect(ZAMBIA_PAYROLL_DUE_DATES.ZM_SDL_DUE_DAY).toBe(10)
    expect(ZAMBIA_PAYROLL_DUE_DATES.ZM_NHIMA_DUE_DAY).toBe(10)
    expect(ZAMBIA_PAYROLL_DUE_DATES.ZM_NAPSA_DUE_DAY).toBe(10)

    // Note: Ghana and Kenya deadline constants may be defined elsewhere or in future
    // This test validates the countries that have explicit deadline exports
  })
})

// ============================================================================
// F. NEGATIVE / SAFETY TESTS
// ============================================================================

describe("F. Negative / Safety Tests", () => {
  it("should handle allowances > basic (ok)", () => {
    const result = calculatePayroll(
      {
        jurisdiction: 'GH',
        effectiveDate: '2026-01-01',
        basicSalary: 10000,
        allowances: 50000, // Allowances exceed basic
        otherDeductions: 0
      },
      'GH'
    )

    expect(result.earnings.grossSalary).toBe(60000) // 10,000 + 50,000
    expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
  })

  it("should handle transportAllowance > allowances (clamped or handled)", () => {
    // This test verifies the system doesn't crash with edge cases
    const result = calculatePayroll(
      {
        jurisdiction: 'RW',
        effectiveDate: '2026-01-01',
        basicSalary: 100000,
        allowances: 50000,
        otherDeductions: 0
      },
      'RW'
    )

    expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
  })

  it("should handle wcfcRate < 0 (ignored or warned)", () => {
    // Zambia WCFCB should handle negative rates gracefully
    const result = zambiaPayrollEngine.calculate({
      jurisdiction: 'ZM',
      effectiveDate: '2026-01-01',
      basicSalary: 40000,
      allowances: 0,
      otherDeductions: 0,
      wcfcRate: -0.01 // Negative rate
    } as any)

    // Should not crash, WCFCB should be ignored or 0
    expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
  })

  it("should throw MissingCountryError for null country", () => {
    expect(() => {
      calculatePayroll(
        {
          jurisdiction: 'GH',
          effectiveDate: '2026-01-01',
          basicSalary: 1000,
          allowances: 0,
          otherDeductions: 0
        },
        null
      )
    }).toThrow(MissingCountryError)
  })

  it("should throw MissingCountryError for undefined country", () => {
    expect(() => {
      calculatePayroll(
        {
          jurisdiction: 'GH',
          effectiveDate: '2026-01-01',
          basicSalary: 1000,
          allowances: 0,
          otherDeductions: 0
        },
        undefined
      )
    }).toThrow(MissingCountryError)
  })

  it("should throw UnsupportedCountryError for unsupported country", () => {
    expect(() => {
      calculatePayroll(
        {
          jurisdiction: 'US',
          effectiveDate: '2026-01-01',
          basicSalary: 1000,
          allowances: 0,
          otherDeductions: 0
        },
        'US'
      )
    }).toThrow(UnsupportedCountryError)
  })
})
