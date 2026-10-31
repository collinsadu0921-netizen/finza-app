import {
  batchStatusLabel,
  computeBatchProgress,
  employeeCountLabel,
  getBatchItemDisplayStatus,
} from "@/lib/payroll/batchProgress"

describe("payroll payment batch progress", () => {
  it("counts paid, pending and processing employees and amounts", () => {
    const progress = computeBatchProgress(
      [
        { id: "i1", status: "paid", amount: 1000 },
        { id: "i2", status: "pending", amount: 500 },
        { id: "i3", status: "pending", amount: 250 },
        { id: "i4", status: "pending", amount: 750 },
      ],
      [
        { batch_item_id: "i2", status: "pending" },
        { batch_item_id: "i3", status: "awaiting_authorization" },
      ]
    )

    expect(progress).toMatchObject({
      applicableCount: 4,
      paidCount: 1,
      pendingCount: 1,
      processingCount: 2,
      failedCount: 0,
      totalAmount: 2500,
      paidAmount: 1000,
      processingAmount: 750,
      outstandingAmount: 1500,
    })
  })

  it("does not treat a successful API call as paid before the item is settled", () => {
    expect(getBatchItemDisplayStatus("pending", "pending")).toBe("processing")
    expect(getBatchItemDisplayStatus("pending", "successful")).toBe("processing")
    expect(getBatchItemDisplayStatus("paid", "successful")).toBe("paid")
  })

  it("shows failed transfers as failed and excludes skipped employees", () => {
    const progress = computeBatchProgress(
      [
        { id: "i1", status: "failed", amount: 100 },
        { id: "i2", status: "pending", amount: 200 },
        { id: "i3", status: "skipped", amount: 300 },
      ],
      [{ batch_item_id: "i2", status: "reversed" }]
    )

    expect(progress.applicableCount).toBe(2)
    expect(progress.failedCount).toBe(2)
    expect(progress.skippedCount).toBe(1)
    expect(progress.totalAmount).toBe(300)
    expect(progress.outstandingAmount).toBe(300)
  })

  it("reports fully paid batches and friendly status labels", () => {
    const progress = computeBatchProgress([
      { id: "i1", status: "paid", amount: 400 },
      { id: "i2", status: "paid", amount: 600 },
    ])

    expect(progress.paidCount).toBe(2)
    expect(progress.outstandingAmount).toBe(0)
    expect(batchStatusLabel("partially_paid")).toBe("Part paid")
    expect(batchStatusLabel("processing")).toBe("Paying")
    expect(employeeCountLabel(1)).toBe("1 employee")
    expect(employeeCountLabel(4)).toBe("4 employees")
  })
})
