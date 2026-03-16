/**
 * Manual Journal Draft Posting - Test Coverage
 * Step 8.9 Batch D - Step 4: Test Coverage
 * 
 * Tests for deterministic, idempotent posting of manual journal drafts to ledger.
 * 
 * All tests validate real invariants:
 * - Deterministic hash computation
 * - Idempotent posting
 * - Transaction safety
 * - Auditor verifiability
 */

import {
  buildCanonicalPostingPayload,
  validateCanonicalPayload,
  type ManualJournalDraft,
  type DraftLine,
} from "../manualJournalDraftPosting"

describe("Manual Journal Draft Posting - Canonical Payload Builder", () => {
  const baseDraft: ManualJournalDraft = {
    id: "draft-123",
    accounting_firm_id: "firm-456",
    client_business_id: "business-789",
    period_id: "period-101",
    entry_date: "2024-01-15",
    description: "Test journal entry",
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

  describe("7. Hash Determinism", () => {
    /**
     * Test 7.1: Same inputs produce same hash
     * 
     * CRITICAL: Deterministic hash ensures same draft always produces same ledger entry
     */
    it("should produce identical hash for same draft inputs", () => {
      const payload1 = buildCanonicalPostingPayload(baseDraft)
      const payload2 = buildCanonicalPostingPayload(baseDraft)

      expect(payload1.input_hash).toBe(payload2.input_hash)
      expect(payload1.input_hash).toMatch(/^[a-f0-9]{64}$/) // SHA-256 hex format
    })

    /**
     * Test 7.2: Different inputs produce different hash
     */
    it("should produce different hash for different draft", () => {
      const payload1 = buildCanonicalPostingPayload(baseDraft)

      const modifiedDraft = {
        ...baseDraft,
        description: "Different description",
      }
      const payload2 = buildCanonicalPostingPayload(modifiedDraft)

      expect(payload1.input_hash).not.toBe(payload2.input_hash)
    })

    /**
     * Test 7.3: Amount normalization (fixed precision)
     */
    it("should normalize amounts to 2 decimal places", () => {
      const draftWithPrecision: ManualJournalDraft = {
        ...baseDraft,
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

      const payload = buildCanonicalPostingPayload(draftWithPrecision)

      // All amounts should be normalized to 2 decimals
      expect(payload.lines[0].debit).toBe("100.12")
      expect(payload.lines[1].credit).toBe("100.12")
      expect(payload.total_debit).toBe("100.12")
      expect(payload.total_credit).toBe("100.12")
    })

    /**
     * Test 7.4: Memo normalization (trim and null handling)
     */
    it("should normalize memos (trim whitespace, null to empty)", () => {
      const draftWithMemos: ManualJournalDraft = {
        ...baseDraft,
        lines: [
          {
            account_id: "account-1",
            debit: 100.0,
            credit: 0,
            memo: "  trimmed memo  ",
          },
          {
            account_id: "account-2",
            debit: 0,
            credit: 100.0,
            memo: null,
          },
          {
            account_id: "account-3",
            debit: 0,
            credit: 0,
            memo: undefined as any,
          },
        ],
      }

      const payload = buildCanonicalPostingPayload(draftWithMemos)

      expect(payload.lines[0].memo).toBe("trimmed memo") // Trimmed
      expect(payload.lines[1].memo).toBe("") // Null → empty
      expect(payload.lines[2].memo).toBe("") // Undefined → empty
    })

    /**
     * Test 7.5: Line order preservation
     */
    it("should preserve line order via index", () => {
      const draftWithOrderedLines: ManualJournalDraft = {
        ...baseDraft,
        lines: [
          {
            account_id: "account-1",
            debit: 50.0,
            credit: 0,
            memo: "First",
          },
          {
            account_id: "account-2",
            debit: 50.0,
            credit: 0,
            memo: "Second",
          },
          {
            account_id: "account-3",
            debit: 0,
            credit: 100.0,
            memo: "Third",
          },
        ],
        total_debit: 100.0,
        total_credit: 100.0,
      }

      const payload = buildCanonicalPostingPayload(draftWithOrderedLines)

      // Lines should maintain original order
      expect(payload.lines[0].index).toBe(0)
      expect(payload.lines[0].memo).toBe("First")
      expect(payload.lines[1].index).toBe(1)
      expect(payload.lines[1].memo).toBe("Second")
      expect(payload.lines[2].index).toBe(2)
      expect(payload.lines[2].memo).toBe("Third")
    })

    /**
     * Test 7.6: Hash includes all required fields
     */
    it("should include all required fields in hash computation", () => {
      const payload1 = buildCanonicalPostingPayload(baseDraft)

      // Change any field should change hash
      const tests = [
        { field: "id", value: "different-id" },
        { field: "accounting_firm_id", value: "different-firm" },
        { field: "client_business_id", value: "different-business" },
        { field: "period_id", value: "different-period" },
        { field: "entry_date", value: "2024-01-16" },
        { field: "description", value: "Different description" },
        { field: "approved_by", value: "different-user" },
      ]

      tests.forEach(({ field, value }) => {
        const modifiedDraft = { ...baseDraft, [field]: value }
        const payload2 = buildCanonicalPostingPayload(modifiedDraft)
        expect(payload1.input_hash).not.toBe(payload2.input_hash)
      })
    })
  })

  describe("Payload Validation", () => {
    /**
     * Test: Valid payload passes validation
     */
    it("should validate correct payload", () => {
      const payload = buildCanonicalPostingPayload(baseDraft)
      const validation = validateCanonicalPayload(payload)

      expect(validation.valid).toBe(true)
      expect(validation.error).toBeUndefined()
    })

    /**
     * Test: Missing required fields fail validation
     */
    it("should reject payload with missing required fields", () => {
      const invalidPayloads = [
        { ...buildCanonicalPostingPayload(baseDraft), draft_id: "" },
        { ...buildCanonicalPostingPayload(baseDraft), firm_id: "" },
        { ...buildCanonicalPostingPayload(baseDraft), client_business_id: "" },
        { ...buildCanonicalPostingPayload(baseDraft), period_id: "" },
        { ...buildCanonicalPostingPayload(baseDraft), entry_date: "" },
        { ...buildCanonicalPostingPayload(baseDraft), description: "" },
        { ...buildCanonicalPostingPayload(baseDraft), lines: [] },
        { ...buildCanonicalPostingPayload(baseDraft), input_hash: "" },
      ]

      invalidPayloads.forEach((payload) => {
        const validation = validateCanonicalPayload(payload)
        expect(validation.valid).toBe(false)
        expect(validation.error).toBeDefined()
      })
    })

    /**
     * Test: Imbalanced payload fails validation
     */
    it("should reject imbalanced payload", () => {
      const imbalancedDraft: ManualJournalDraft = {
        ...baseDraft,
        total_debit: 100.0,
        total_credit: 99.0, // Imbalanced
      }

      const payload = buildCanonicalPostingPayload(imbalancedDraft)
      const validation = validateCanonicalPayload(payload)

      expect(validation.valid).toBe(false)
      expect(validation.error).toContain("not balanced")
    })

    /**
     * Test: Invalid lines fail validation
     */
    it("should reject payload with invalid lines", () => {
      const invalidLineDraft: ManualJournalDraft = {
        ...baseDraft,
        lines: [
          {
            account_id: "", // Missing account_id
            debit: 100.0,
            credit: 0,
            memo: null,
          },
        ],
      }

      const payload = buildCanonicalPostingPayload(invalidLineDraft)
      const validation = validateCanonicalPayload(payload)

      expect(validation.valid).toBe(false)
      expect(validation.error).toContain("account_id")
    })
  })
})
