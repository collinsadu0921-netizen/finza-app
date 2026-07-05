import {
  applyRepaymentToAdvance,
  computeOutstandingAmount,
  normalizeAdvanceStatus,
  validateRepaymentAmount,
} from "@/lib/payroll/salaryAdvanceRepayments"

describe("salaryAdvanceRepayments", () => {
  describe("computeOutstandingAmount", () => {
    it("returns full amount when nothing repaid", () => {
      expect(computeOutstandingAmount(1000, 0)).toBe(1000)
    })

    it("returns zero when fully repaid", () => {
      expect(computeOutstandingAmount(1000, 1000)).toBe(0)
    })

    it("caps repaid at advance amount", () => {
      expect(computeOutstandingAmount(1000, 1200)).toBe(0)
    })
  })

  describe("validateRepaymentAmount", () => {
    it("rejects non-positive amounts", () => {
      expect(validateRepaymentAmount(0, 500)).toMatch(/positive/)
      expect(validateRepaymentAmount(-10, 500)).toMatch(/positive/)
    })

    it("rejects overpayment", () => {
      expect(validateRepaymentAmount(600, 500)).toMatch(/exceeds outstanding/)
    })

    it("accepts valid partial repayment", () => {
      expect(validateRepaymentAmount(200, 500)).toBeNull()
    })

    it("accepts exact full repayment", () => {
      expect(validateRepaymentAmount(500, 500)).toBeNull()
    })
  })

  describe("normalizeAdvanceStatus", () => {
    it("returns cancelled when cancelled_at is set", () => {
      expect(normalizeAdvanceStatus("outstanding", 1000, 0, "2026-01-01")).toBe("cancelled")
    })

    it("returns cleared when fully repaid", () => {
      expect(normalizeAdvanceStatus(null, 1000, 1000)).toBe("cleared")
    })

    it("returns partially_repaid for partial balance", () => {
      expect(normalizeAdvanceStatus(null, 1000, 400)).toBe("partially_repaid")
    })

    it("returns outstanding when nothing repaid", () => {
      expect(normalizeAdvanceStatus(null, 1000, 0)).toBe("outstanding")
    })
  })

  describe("applyRepaymentToAdvance", () => {
    it("applies partial repayment", () => {
      const result = applyRepaymentToAdvance({
        amount: 1000,
        repaid_amount: 0,
        repaymentAmount: 300,
      })
      expect(result.repaid_amount).toBe(300)
      expect(result.status).toBe("partially_repaid")
      expect(result.cleared_at).toBeNull()
    })

    it("marks advance cleared on full repayment", () => {
      const result = applyRepaymentToAdvance({
        amount: 1000,
        repaid_amount: 700,
        repaymentAmount: 300,
      })
      expect(result.repaid_amount).toBe(1000)
      expect(result.status).toBe("cleared")
      expect(result.cleared_at).not.toBeNull()
    })

    it("preserves existing cleared_at when already cleared", () => {
      const existing = "2026-01-15T00:00:00.000Z"
      const result = applyRepaymentToAdvance({
        amount: 1000,
        repaid_amount: 1000,
        cleared_at: existing,
        repaymentAmount: 0,
      })
      expect(result.status).toBe("cleared")
      expect(result.cleared_at).toBe(existing)
    })
  })
})
