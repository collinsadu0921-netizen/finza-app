import {
  computeInvoiceCreditCapacity,
  computeInvoiceGross,
  formatCreditCapacityExceededError,
  formatFullyCreditedError,
} from "../invoiceCreditCapacity"

describe("invoiceCreditCapacity", () => {
  describe("computeInvoiceGross", () => {
    it("uses invoice.total when positive", () => {
      expect(computeInvoiceGross({ total: 1000, subtotal: 800, total_tax: 200 })).toBe(1000)
    })

    it("derives gross from subtotal + total_tax when total is zero", () => {
      expect(computeInvoiceGross({ total: 0, subtotal: 800, total_tax: 200 })).toBe(1000)
    })
  })

  describe("computeInvoiceCreditCapacity", () => {
    it("returns full remaining when no applied credits", () => {
      const cap = computeInvoiceCreditCapacity("inv-1", { total: 1000 }, [])
      expect(cap.invoiceGross).toBe(1000)
      expect(cap.appliedCreditsTotal).toBe(0)
      expect(cap.remainingCreditable).toBe(1000)
      expect(cap.isFullyCredited).toBe(false)
    })

    it("subtracts only applied credit totals", () => {
      const cap = computeInvoiceCreditCapacity("inv-1", { total: 1000 }, [300])
      expect(cap.appliedCreditsTotal).toBe(300)
      expect(cap.remainingCreditable).toBe(700)
      expect(cap.isFullyCredited).toBe(false)
    })

    it("marks fully credited when applied credits reach invoice total", () => {
      const cap = computeInvoiceCreditCapacity("inv-1", { total: 1000 }, [600, 400])
      expect(cap.remainingCreditable).toBe(0)
      expect(cap.isFullyCredited).toBe(true)
    })

    it("marks fully credited within rounding tolerance", () => {
      const cap = computeInvoiceCreditCapacity("inv-1", { total: 1000 }, [999.995])
      expect(cap.isFullyCredited).toBe(true)
    })
  })

  describe("error message helpers", () => {
    it("formatCreditCapacityExceededError includes remaining amount", () => {
      const msg = formatCreditCapacityExceededError(800, 700)
      expect(msg).toContain("800.00")
      expect(msg).toContain("700.00")
    })

    it("formatFullyCreditedError states zero remaining", () => {
      expect(formatFullyCreditedError()).toContain("fully credited")
      expect(formatFullyCreditedError()).toContain("0.00")
    })
  })
})
