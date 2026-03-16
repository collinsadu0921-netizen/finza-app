/**
 * Unit tests for lib/taxEngine/index.ts
 * 
 * Tests validate:
 * - GH resolves to Ghana engine (compound VAT)
 * - Tier 2 countries (NG, KE, UG, TZ, RW, ZM) resolve to VAT-only engines
 * - Tier 1/2 countries normalize correctly (GH, NG, KE, UG, TZ, RW, ZM)
 * - Missing country ≠ unsupported country error semantics
 * - All Tier 2 countries calculate VAT correctly (7.5%, 16%, 18%)
 * - Tax-inclusive reverse calculation works for all Tier 2 countries
 */

import { calculateTaxes, calculateTaxesFromAmount } from "../taxEngine"
import { MissingCountryError, UnsupportedCountryError } from "../taxEngine/errors"
import { normalizeCountry, UNSUPPORTED_COUNTRY_MARKER, SUPPORTED_COUNTRIES } from "../payments/eligibility"

describe("Tax Engine - Country Normalization", () => {
  describe("Tier 1/2 countries normalize to ISO alpha-2 codes", () => {
    it("GH (Ghana) normalizes correctly", () => {
      expect(normalizeCountry("GH")).toBe("GH")
      expect(normalizeCountry("Ghana")).toBe("GH")
      expect(normalizeCountry("GHA")).toBe("GH")
      expect(normalizeCountry("gh")).toBe("GH")
      expect(normalizeCountry("  ghana  ")).toBe("GH")
    })

    it("NG (Nigeria) normalizes correctly", () => {
      expect(normalizeCountry("NG")).toBe("NG")
      expect(normalizeCountry("Nigeria")).toBe("NG")
      expect(normalizeCountry("ng")).toBe("NG")
    })

    it("KE (Kenya) normalizes correctly", () => {
      expect(normalizeCountry("KE")).toBe("KE")
      expect(normalizeCountry("Kenya")).toBe("KE")
      expect(normalizeCountry("KEN")).toBe("KE")
      expect(normalizeCountry("kenya")).toBe("KE")
    })

    it("UG (Uganda) normalizes correctly", () => {
      expect(normalizeCountry("UG")).toBe("UG")
      expect(normalizeCountry("Uganda")).toBe("UG")
      expect(normalizeCountry("ug")).toBe("UG")
    })

    it("TZ (Tanzania) normalizes correctly", () => {
      expect(normalizeCountry("TZ")).toBe("TZ")
      expect(normalizeCountry("Tanzania")).toBe("TZ")
      expect(normalizeCountry("United Republic of Tanzania")).toBe("TZ")
      expect(normalizeCountry("tz")).toBe("TZ")
    })

    it("RW (Rwanda) normalizes correctly", () => {
      expect(normalizeCountry("RW")).toBe("RW")
      expect(normalizeCountry("Rwanda")).toBe("RW")
      expect(normalizeCountry("rw")).toBe("RW")
    })

    it("ZM (Zambia) normalizes correctly", () => {
      expect(normalizeCountry("ZM")).toBe("ZM")
      expect(normalizeCountry("Zambia")).toBe("ZM")
      expect(normalizeCountry("zm")).toBe("ZM")
    })
  })

  describe("Missing country vs unsupported country", () => {
    it("missing country (null) returns null", () => {
      expect(normalizeCountry(null)).toBeNull()
      expect(normalizeCountry(undefined)).toBeNull()
      expect(normalizeCountry("")).toBeNull()
    })

    it("unsupported country returns UNSUPPORTED_COUNTRY_MARKER (not null)", () => {
      expect(normalizeCountry("US")).toBe(UNSUPPORTED_COUNTRY_MARKER)
      expect(normalizeCountry("United States")).toBe(UNSUPPORTED_COUNTRY_MARKER)
      expect(normalizeCountry("GB")).toBe(UNSUPPORTED_COUNTRY_MARKER)
      expect(normalizeCountry("United Kingdom")).toBe(UNSUPPORTED_COUNTRY_MARKER)
      expect(normalizeCountry("XX")).toBe(UNSUPPORTED_COUNTRY_MARKER)
    })

    it("distinguishes missing from unsupported", () => {
      const missing = normalizeCountry(null)
      const unsupported = normalizeCountry("US")
      
      expect(missing).toBeNull()
      expect(unsupported).toBe(UNSUPPORTED_COUNTRY_MARKER)
      expect(missing).not.toBe(unsupported)
    })
  })

  describe("SUPPORTED_COUNTRIES constant", () => {
    it("includes all Tier 1/2 countries", () => {
      const expectedCountries = ['GH', 'NG', 'KE', 'UG', 'TZ', 'RW', 'ZM']
      expect(SUPPORTED_COUNTRIES).toEqual(expect.arrayContaining(expectedCountries))
      expect(SUPPORTED_COUNTRIES.length).toBe(expectedCountries.length)
    })
  })
})

describe("Tax Engine - Engine Resolution", () => {
  describe("GH resolves to Ghana engine", () => {
    it("calculates taxes for GH using Ghana engine", () => {
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 100 }],
        "GH",
        "2024-01-01",
        true
      )

      // Ghana engine should return tax lines (NHIL, GETFund, COVID, VAT)
      expect(result.taxLines.length).toBeGreaterThan(0)
      expect(result.taxLines.some(line => line.code === "NHIL")).toBe(true)
      expect(result.taxLines.some(line => line.code === "GETFUND")).toBe(true)
      expect(result.taxLines.some(line => line.code === "VAT")).toBe(true)
      expect(result.tax_total).toBeGreaterThan(0)
      expect(result.total_incl_tax).toBeGreaterThan(result.subtotal_excl_tax)
    })

    it("handles various GH input formats", () => {
      const testCases = ["GH", "Ghana", "GHA", "gh"]
      
      testCases.forEach(country => {
        const result = calculateTaxes(
          [{ quantity: 1, unit_price: 100 }],
          country,
          "2024-01-01",
          true
        )
        
        expect(result.taxLines.length).toBeGreaterThan(0)
        expect(result.tax_total).toBeGreaterThan(0)
      })
    })
  })

  describe("Tier 2 countries (VAT-only engines) calculate taxes correctly", () => {
    it("NG (Nigeria) calculates 7.5% VAT correctly", () => {
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 100 }],
        "NG",
        "2024-01-01",
        false // Exclusive
      )

      expect(result.taxLines.length).toBe(1)
      expect(result.taxLines[0].code).toBe("VAT")
      expect(result.taxLines[0].name).toBe("VAT")
      expect(result.taxLines[0].rate).toBe(0.075)
      expect(result.taxLines[0].base).toBe(100)
      expect(result.taxLines[0].amount).toBe(7.5)
      expect(result.subtotal_excl_tax).toBe(100)
      expect(result.tax_total).toBe(7.5)
      expect(result.total_incl_tax).toBe(107.5)
    })

    it("KE (Kenya) calculates 16% VAT correctly", () => {
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 100 }],
        "KE",
        "2024-01-01",
        false // Exclusive
      )

      expect(result.taxLines.length).toBe(1)
      expect(result.taxLines[0].code).toBe("VAT")
      expect(result.taxLines[0].rate).toBe(0.16)
      expect(result.taxLines[0].base).toBe(100)
      expect(result.taxLines[0].amount).toBe(16)
      expect(result.subtotal_excl_tax).toBe(100)
      expect(result.tax_total).toBe(16)
      expect(result.total_incl_tax).toBe(116)
    })

    it("ZM (Zambia) calculates 16% VAT correctly", () => {
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 100 }],
        "ZM",
        "2024-01-01",
        false // Exclusive
      )

      expect(result.taxLines.length).toBe(1)
      expect(result.taxLines[0].code).toBe("VAT")
      expect(result.taxLines[0].rate).toBe(0.16)
      expect(result.taxLines[0].amount).toBe(16)
      expect(result.subtotal_excl_tax).toBe(100)
      expect(result.tax_total).toBe(16)
      expect(result.total_incl_tax).toBe(116)
    })

    it("UG (Uganda) calculates 18% VAT correctly", () => {
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 100 }],
        "UG",
        "2024-01-01",
        false // Exclusive
      )

      expect(result.taxLines.length).toBe(1)
      expect(result.taxLines[0].code).toBe("VAT")
      expect(result.taxLines[0].rate).toBe(0.18)
      expect(result.taxLines[0].amount).toBe(18)
      expect(result.subtotal_excl_tax).toBe(100)
      expect(result.tax_total).toBe(18)
      expect(result.total_incl_tax).toBe(118)
    })

    it("TZ (Tanzania) calculates 18% VAT correctly", () => {
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 100 }],
        "TZ",
        "2024-01-01",
        false // Exclusive
      )

      expect(result.taxLines.length).toBe(1)
      expect(result.taxLines[0].code).toBe("VAT")
      expect(result.taxLines[0].rate).toBe(0.18)
      expect(result.taxLines[0].amount).toBe(18)
      expect(result.subtotal_excl_tax).toBe(100)
      expect(result.tax_total).toBe(18)
      expect(result.total_incl_tax).toBe(118)
    })

    it("RW (Rwanda) calculates 18% VAT correctly", () => {
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 100 }],
        "RW",
        "2024-01-01",
        false // Exclusive
      )

      expect(result.taxLines.length).toBe(1)
      expect(result.taxLines[0].code).toBe("VAT")
      expect(result.taxLines[0].rate).toBe(0.18)
      expect(result.taxLines[0].amount).toBe(18)
      expect(result.subtotal_excl_tax).toBe(100)
      expect(result.tax_total).toBe(18)
      expect(result.total_incl_tax).toBe(118)
    })
  })

  describe("Tier 2 countries support tax-inclusive reverse calculation", () => {
    it("NG (Nigeria) reverses correctly from tax-inclusive total (7.5% VAT)", () => {
      // If total is 107.5 (including 7.5% VAT), base should be 100
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 107.5 }],
        "NG",
        "2024-01-01",
        true // Inclusive
      )

      expect(result.taxLines.length).toBe(1)
      expect(result.taxLines[0].code).toBe("VAT")
      expect(result.taxLines[0].rate).toBe(0.075)
      // Base should be approximately 100 (reverse calculated)
      expect(result.subtotal_excl_tax).toBeCloseTo(100, 2)
      // VAT should be approximately 7.5
      expect(result.tax_total).toBeCloseTo(7.5, 2)
      // Total should be 107.5
      expect(result.total_incl_tax).toBeCloseTo(107.5, 2)
    })

    it("KE (Kenya) reverses correctly from tax-inclusive total (16% VAT)", () => {
      // If total is 116 (including 16% VAT), base should be 100
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 116 }],
        "KE",
        "2024-01-01",
        true // Inclusive
      )

      expect(result.taxLines.length).toBe(1)
      expect(result.subtotal_excl_tax).toBeCloseTo(100, 2)
      expect(result.tax_total).toBeCloseTo(16, 2)
      expect(result.total_incl_tax).toBeCloseTo(116, 2)
    })

    it("UG (Uganda) reverses correctly from tax-inclusive total (18% VAT)", () => {
      // If total is 118 (including 18% VAT), base should be 100
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 118 }],
        "UG",
        "2024-01-01",
        true // Inclusive
      )

      expect(result.taxLines.length).toBe(1)
      expect(result.subtotal_excl_tax).toBeCloseTo(100, 2)
      expect(result.tax_total).toBeCloseTo(18, 2)
      expect(result.total_incl_tax).toBeCloseTo(118, 2)
    })

    it("ZM (Zambia) reverses correctly from tax-inclusive total (16% VAT)", () => {
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 116 }],
        "ZM",
        "2024-01-01",
        true // Inclusive
      )

      expect(result.subtotal_excl_tax).toBeCloseTo(100, 2)
      expect(result.tax_total).toBeCloseTo(16, 2)
      expect(result.total_incl_tax).toBeCloseTo(116, 2)
    })

    it("TZ (Tanzania) reverses correctly from tax-inclusive total (18% VAT)", () => {
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 118 }],
        "TZ",
        "2024-01-01",
        true // Inclusive
      )

      expect(result.subtotal_excl_tax).toBeCloseTo(100, 2)
      expect(result.tax_total).toBeCloseTo(18, 2)
      expect(result.total_incl_tax).toBeCloseTo(118, 2)
    })

    it("RW (Rwanda) reverses correctly from tax-inclusive total (18% VAT)", () => {
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 118 }],
        "RW",
        "2024-01-01",
        true // Inclusive
      )

      expect(result.subtotal_excl_tax).toBeCloseTo(100, 2)
      expect(result.tax_total).toBeCloseTo(18, 2)
      expect(result.total_incl_tax).toBeCloseTo(118, 2)
    })
  })

  describe("Tier 2 countries work with normalizeCountry()", () => {
    it("NG normalizes from various inputs", () => {
      const testCases = ["NG", "Nigeria", "ng"]
      
      testCases.forEach(country => {
        const result = calculateTaxes(
          [{ quantity: 1, unit_price: 100 }],
          country,
          "2024-01-01",
          false
        )
        
        expect(result.taxLines.length).toBe(1)
        expect(result.taxLines[0].code).toBe("VAT")
        expect(result.tax_total).toBe(7.5)
      })
    })

    it("KE normalizes from various inputs", () => {
      const testCases = ["KE", "Kenya", "KEN", "ke"]
      
      testCases.forEach(country => {
        const result = calculateTaxes(
          [{ quantity: 1, unit_price: 100 }],
          country,
          "2024-01-01",
          false
        )
        
        expect(result.taxLines.length).toBe(1)
        expect(result.tax_total).toBe(16)
      })
    })

    it("UG, TZ, RW normalize correctly", () => {
      const ugResult = calculateTaxes(
        [{ quantity: 1, unit_price: 100 }],
        "Uganda",
        "2024-01-01",
        false
      )
      expect(ugResult.tax_total).toBe(18)

      const tzResult = calculateTaxes(
        [{ quantity: 1, unit_price: 100 }],
        "Tanzania",
        "2024-01-01",
        false
      )
      expect(tzResult.tax_total).toBe(18)

      const rwResult = calculateTaxes(
        [{ quantity: 1, unit_price: 100 }],
        "Rwanda",
        "2024-01-01",
        false
      )
      expect(rwResult.tax_total).toBe(18)
    })
  })

  describe("Tier 2 countries no longer throw UnsupportedCountryError", () => {
    const tier2Countries = ['NG', 'KE', 'UG', 'TZ', 'RW', 'ZM']
    
    tier2Countries.forEach(countryCode => {
      it(`${countryCode} no longer throws UnsupportedCountryError`, () => {
        expect(() => {
          calculateTaxes(
            [{ quantity: 1, unit_price: 100 }],
            countryCode,
            "2024-01-01",
            true
          )
        }).not.toThrow(UnsupportedCountryError)
      })
    })
  })

  describe("Missing country throws MissingCountryError", () => {
    it("throws MissingCountryError for null country", () => {
      expect(() => {
        calculateTaxes(
          [{ quantity: 1, unit_price: 100 }],
          null,
          "2024-01-01",
          true
        )
      }).toThrow(MissingCountryError)
    })

    it("throws MissingCountryError for undefined country", () => {
      expect(() => {
        calculateTaxes(
          [{ quantity: 1, unit_price: 100 }],
          undefined,
          "2024-01-01",
          true
        )
      }).toThrow(MissingCountryError)
    })

    it("throws MissingCountryError for empty string", () => {
      expect(() => {
        calculateTaxes(
          [{ quantity: 1, unit_price: 100 }],
          "",
          "2024-01-01",
          true
        )
      }).toThrow(MissingCountryError)
    })

    it("distinguishes MissingCountryError from UnsupportedCountryError", () => {
      // Missing country
      expect(() => {
        calculateTaxes(
          [{ quantity: 1, unit_price: 100 }],
          null,
          "2024-01-01",
          true
        )
      }).toThrow(MissingCountryError)

      // All Tier 1/2 countries are now implemented, so no UnsupportedCountryError examples
      // UnsupportedCountryError would only be thrown for a country in supported set but without engine
      // For now, we can test that implemented countries don't throw MissingCountryError
      expect(() => {
        calculateTaxes(
          [{ quantity: 1, unit_price: 100 }],
          "KE",
          "2024-01-01",
          true
        )
      }).not.toThrow(MissingCountryError)
    })
  })

  describe("Unsupported countries use zero-tax fallback", () => {
    it("returns zero taxes for unsupported countries (not in Tier 1/2)", () => {
      // Note: This behavior may change in future - for now, unsupported countries
      // outside Tier 1/2 get zero-tax fallback (no error)
      const result = calculateTaxes(
        [{ quantity: 1, unit_price: 100 }],
        "US", // Not in supported set
        "2024-01-01",
        true
      )

      expect(result.taxLines.length).toBe(0)
      expect(result.tax_total).toBe(0)
      expect(result.total_incl_tax).toBe(100)
      expect(result.subtotal_excl_tax).toBe(100)
    })
  })
})

describe("Tax Engine - calculateTaxesFromAmount", () => {
  it("GH resolves to Ghana engine for amount calculation", () => {
    const result = calculateTaxesFromAmount(
      100,
      "GH",
      "2024-01-01",
      true
    )

    expect(result.taxLines.length).toBeGreaterThan(0)
    expect(result.tax_total).toBeGreaterThan(0)
    expect(result.total_incl_tax).toBeGreaterThan(result.subtotal_excl_tax)
  })

  it("NG (Nigeria) calculates taxes correctly from amount", () => {
    const result = calculateTaxesFromAmount(100, "NG", "2024-01-01", false)
    expect(result.taxLines.length).toBe(1)
    expect(result.taxLines[0].code).toBe("VAT")
    expect(result.tax_total).toBe(7.5)
    expect(result.total_incl_tax).toBe(107.5)
  })

  it("throws MissingCountryError for null country", () => {
    expect(() => {
      calculateTaxesFromAmount(100, null, "2024-01-01", true)
    }).toThrow(MissingCountryError)
  })
})
