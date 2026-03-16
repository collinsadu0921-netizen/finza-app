/**
 * Opening Balance Imports - Canonical Builder Test Coverage
 * Step 9.1 Batch F - Test Suite 1: Canonical Builder Determinism
 * 
 * Tests for deterministic, normalized opening balance import payload builder.
 * 
 * All tests validate real invariants:
 * - Deterministic hash computation
 * - Amount normalization (2 decimals)
 * - Memo normalization
 * - Deterministic line ordering
 */

import {
  buildCanonicalOpeningBalancePayload,
  validateCanonicalOpeningBalancePayload,
  type OpeningBalanceImport,
  type OpeningBalanceLine,
} from "../openingBalanceImports"

describe("Opening Balance Imports - Canonical Payload Builder", () => {
  const baseImport: OpeningBalanceImport = {
    id: "import-123",
    accounting_firm_id: "firm-456",
    client_business_id: "business-789",
    period_id: "period-101",
    source_type: "manual",
    lines: [
      {
        account_id: "account-1",
        debit: 100.0,
        credit: 0,
        memo: "Test memo",
      },
      {
        account_id: "account-2",
        debit: 0,
        credit: 100.0,
        memo: null,
      },
    ],
    total_debit: 100.0,
    total_credit: 100.0,
    approved_by: "user-999",
  }

  describe("1. Hash Determinism", () => {
    /**
     * Test 1.1: Same inputs produce same hash
     * 
     * CRITICAL: Deterministic hash ensures same import always produces same ledger entry
     */
    it("should produce identical hash for same import inputs", () => {
      const payload1 = buildCanonicalOpeningBalancePayload(baseImport)
      const payload2 = buildCanonicalOpeningBalancePayload(baseImport)

      expect(payload1.input_hash).toBe(payload2.input_hash)
      expect(payload1.input_hash).toMatch(/^[a-f0-9]{64}$/) // SHA-256 hex format
    })

    /**
     * Test 1.2: Different inputs produce different hash
     */
    it("should produce different hash for different import", () => {
      const payload1 = buildCanonicalOpeningBalancePayload(baseImport)

      const modifiedImport = {
        ...baseImport,
        lines: [
          ...baseImport.lines,
          {
            account_id: "account-3",
            debit: 50.0,
            credit: 0,
            memo: "Additional line",
          },
        ],
      }
      const payload2 = buildCanonicalOpeningBalancePayload(modifiedImport)

      expect(payload1.input_hash).not.toBe(payload2.input_hash)
    })

    /**
     * Test 1.3: Hash includes import ID (for uniqueness)
     * 
     * NOTE: The implementation includes import ID in hash to ensure
     * each import has a unique hash, even with identical data.
     * This is correct behavior for idempotency checks.
     */
    it("should produce different hash for different import ID", () => {
      const import1 = { ...baseImport, id: "import-1" }
      const import2 = { ...baseImport, id: "import-2" }

      const payload1 = buildCanonicalOpeningBalancePayload(import1)
      const payload2 = buildCanonicalOpeningBalancePayload(import2)

      // Different IDs should produce different hashes
      expect(payload1.input_hash).not.toBe(payload2.input_hash)
    })
  })

  describe("2. Amount Normalization", () => {
    /**
     * Test 2.1: Amounts normalized to 2 decimal places
     */
    it("should normalize amounts to 2 decimal places", () => {
      const importWithPrecision: OpeningBalanceImport = {
        ...baseImport,
        lines: [
          {
            account_id: "account-1",
            debit: 100.123456,
            credit: 0,
            memo: null,
          },
          {
            account_id: "account-2",
            debit: 0,
            credit: 100.123456,
            memo: null,
          },
        ],
        total_debit: 100.123456,
        total_credit: 100.123456,
      }

      const payload = buildCanonicalOpeningBalancePayload(importWithPrecision)

      // Canonical payload uses strings for amounts (fixed precision)
      expect(payload.lines[0].debit).toBe("100.12")
      expect(payload.lines[1].credit).toBe("100.12")
    })

    /**
     * Test 2.2: Zero amounts preserved
     */
    it("should preserve zero amounts", () => {
      const payload = buildCanonicalOpeningBalancePayload(baseImport)

      // Canonical payload uses strings for amounts (fixed precision)
      expect(payload.lines[0].credit).toBe("0.00")
      expect(payload.lines[1].debit).toBe("0.00")
    })

    /**
     * Test 2.3: Large amounts handled correctly
     */
    it("should handle large amounts correctly", () => {
      const largeImport: OpeningBalanceImport = {
        ...baseImport,
        lines: [
          {
            account_id: "account-1",
            debit: 999999999.99,
            credit: 0,
            memo: null,
          },
          {
            account_id: "account-2",
            debit: 0,
            credit: 999999999.99,
            memo: null,
          },
        ],
        total_debit: 999999999.99,
        total_credit: 999999999.99,
      }

      const payload = buildCanonicalOpeningBalancePayload(largeImport)

      // Canonical payload uses strings for amounts (fixed precision)
      expect(payload.lines[0].debit).toBe("999999999.99")
      expect(payload.lines[1].credit).toBe("999999999.99")
    })
  })

  describe("3. Memo Normalization", () => {
    /**
     * Test 3.1: Memos trimmed of whitespace
     */
    it("should trim whitespace from memos", () => {
      const importWithWhitespace: OpeningBalanceImport = {
        ...baseImport,
        lines: [
          {
            account_id: "account-1",
            debit: 100.0,
            credit: 0,
            memo: "  Test memo with spaces  ",
          },
          {
            account_id: "account-2",
            debit: 0,
            credit: 100.0,
            memo: null,
          },
        ],
      }

      const payload = buildCanonicalOpeningBalancePayload(importWithWhitespace)

      expect(payload.lines[0].memo).toBe("Test memo with spaces")
    })

    /**
     * Test 3.2: Null memos preserved as empty string
     */
    it("should convert null memos to empty string", () => {
      const payload = buildCanonicalOpeningBalancePayload(baseImport)

      expect(payload.lines[1].memo).toBe("")
    })

    /**
     * Test 3.3: Empty string memos preserved
     */
    it("should preserve empty string memos", () => {
      const importWithEmptyMemo: OpeningBalanceImport = {
        ...baseImport,
        lines: [
          {
            account_id: "account-1",
            debit: 100.0,
            credit: 0,
            memo: "",
          },
          {
            account_id: "account-2",
            debit: 0,
            credit: 100.0,
            memo: null,
          },
        ],
      }

      const payload = buildCanonicalOpeningBalancePayload(importWithEmptyMemo)

      expect(payload.lines[0].memo).toBe("")
      expect(payload.lines[1].memo).toBe("")
    })
  })

  describe("4. Line Ordering Determinism", () => {
    /**
     * Test 4.1: Lines maintain order from input
     */
    it("should maintain line order from input", () => {
      const importWithOrderedLines: OpeningBalanceImport = {
        ...baseImport,
        lines: [
          {
            account_id: "account-1",
            debit: 50.0,
            credit: 0,
            memo: "First",
          },
          {
            account_id: "account-2",
            debit: 30.0,
            credit: 0,
            memo: "Second",
          },
          {
            account_id: "account-3",
            debit: 0,
            credit: 80.0,
            memo: "Third",
          },
        ],
        total_debit: 80.0,
        total_credit: 80.0,
      }

      const payload = buildCanonicalOpeningBalancePayload(importWithOrderedLines)

      expect(payload.lines[0].account_id).toBe("account-1")
      expect(payload.lines[1].account_id).toBe("account-2")
      expect(payload.lines[2].account_id).toBe("account-3")
    })

    /**
     * Test 4.2: Same lines in different order produce different hash
     */
    it("should produce different hash for different line order", () => {
      const import1: OpeningBalanceImport = {
        ...baseImport,
        lines: [
          {
            account_id: "account-1",
            debit: 50.0,
            credit: 0,
            memo: null,
          },
          {
            account_id: "account-2",
            debit: 0,
            credit: 50.0,
            memo: null,
          },
        ],
        total_debit: 50.0,
        total_credit: 50.0,
      }

      const import2: OpeningBalanceImport = {
        ...baseImport,
        lines: [
          {
            account_id: "account-2",
            debit: 0,
            credit: 50.0,
            memo: null,
          },
          {
            account_id: "account-1",
            debit: 50.0,
            credit: 0,
            memo: null,
          },
        ],
        total_debit: 50.0,
        total_credit: 50.0,
      }

      const payload1 = buildCanonicalOpeningBalancePayload(import1)
      const payload2 = buildCanonicalOpeningBalancePayload(import2)

      // Different order should produce different hash
      expect(payload1.input_hash).not.toBe(payload2.input_hash)
    })
  })

  describe("5. Payload Validation", () => {
    /**
     * Test 5.1: Valid balanced payload passes validation
     */
    it("should validate balanced payload", () => {
      const payload = buildCanonicalOpeningBalancePayload(baseImport)
      const result = validateCanonicalOpeningBalancePayload(payload)

      expect(result.valid).toBe(true)
    })

    /**
     * Test 5.2: Imbalanced payload fails validation
     */
    it("should reject imbalanced payload", () => {
      const imbalancedPayload = {
        ...buildCanonicalOpeningBalancePayload(baseImport),
        total_debit: "100.00",
        total_credit: "50.00", // Imbalanced
      }

      const result = validateCanonicalOpeningBalancePayload(imbalancedPayload)

      expect(result.valid).toBe(false)
      expect(result.error).toContain("not balanced")
    })

    /**
     * Test 5.3: Empty lines fail validation
     */
    it("should reject payload with empty lines", () => {
      const emptyPayload = {
        ...buildCanonicalOpeningBalancePayload(baseImport),
        lines: [],
      }

      const result = validateCanonicalOpeningBalancePayload(emptyPayload)

      expect(result.valid).toBe(false)
      expect(result.error).toContain("empty lines")
    })

    /**
     * Test 5.4: Missing account_id fails validation
     */
    it("should reject payload with missing account_id", () => {
      const invalidPayload = {
        ...buildCanonicalOpeningBalancePayload(baseImport),
        lines: [
          {
            account_id: "", // Invalid
            debit: "100.00",
            credit: "0.00",
            memo: "",
            index: 0,
          },
        ],
      }

      const result = validateCanonicalOpeningBalancePayload(invalidPayload)

      expect(result.valid).toBe(false)
      expect(result.error).toContain("account_id")
    })

    /**
     * Test 5.5: Negative amounts fail validation
     */
    it("should reject payload with negative amounts", () => {
      const invalidPayload = {
        ...buildCanonicalOpeningBalancePayload(baseImport),
        lines: [
          {
            account_id: "account-1",
            debit: "-100.00", // Invalid
            credit: "0.00",
            memo: "",
            index: 0,
          },
          {
            account_id: "account-2",
            debit: "0.00",
            credit: "100.00",
            memo: "",
            index: 1,
          },
        ],
      }

      const result = validateCanonicalOpeningBalancePayload(invalidPayload)

      expect(result.valid).toBe(false)
      expect(result.error).toContain("negative")
    })
  })

  describe("6. Source Type Handling", () => {
    /**
     * Test 6.1: All source types handled correctly
     */
    it("should handle manual source type", () => {
      const manualImport: OpeningBalanceImport = {
        ...baseImport,
        source_type: "manual",
      }

      const payload = buildCanonicalOpeningBalancePayload(manualImport)

      expect(payload).toBeDefined()
      expect(payload.input_hash).toBeDefined()
    })

    it("should handle csv source type", () => {
      const csvImport: OpeningBalanceImport = {
        ...baseImport,
        source_type: "csv",
      }

      const payload = buildCanonicalOpeningBalancePayload(csvImport)

      expect(payload).toBeDefined()
      expect(payload.input_hash).toBeDefined()
    })

    it("should handle excel source type", () => {
      const excelImport: OpeningBalanceImport = {
        ...baseImport,
        source_type: "excel",
      }

      const payload = buildCanonicalOpeningBalancePayload(excelImport)

      expect(payload).toBeDefined()
      expect(payload.input_hash).toBeDefined()
    })
  })
})
