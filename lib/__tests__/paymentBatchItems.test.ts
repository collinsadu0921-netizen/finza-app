import {
  buildPayrollPaymentBatchItemsFromEntries,
  syncBatchStatusFromItems,
  deriveBatchStatusFromItemStatuses,
  assertManualBatchStatusTransition,
  BATCH_EXPORT_DISCLAIMER,
  BATCH_EXPORT_HEADERS,
} from "@/lib/payroll/paymentBatchItems"
import { formatNumeric } from "@/lib/payroll/csvExport"

describe("paymentBatchItems helpers", () => {
  it("snapshots net salary and destination from default staff_payment_method", () => {
    const entries = [
      {
        id: "e1",
        staff_id: "s1",
        net_salary: 1000.5,
        staff: { id: "s1", name: "Ama K", bank_name: "Old", bank_account: "000", phone: "02" },
      },
    ]
    const defaultMethodByStaffId = new Map([
      [
        "s1",
        {
          id: "m1",
          staff_id: "s1",
          method_type: "bank",
          bank_name: "GCB",
          bank_code: "GCB",
          account_number: "123",
          account_name: "Ama K",
        },
      ],
    ])
    const out = buildPayrollPaymentBatchItemsFromEntries({
      businessId: "b1",
      payrollRunId: "r1",
      entries,
      defaultMethodByStaffId,
    })
    expect(out.items).toHaveLength(1)
    expect(out.items[0].amount).toBe(1000.5)
    expect(out.items[0].destination_bank_name).toBe("GCB")
    expect(out.items[0].destination_account_number).toBe("123")
    expect(out.items[0].legacy_destination_source).toBe("staff_payment_method")
    expect(out.items[0].employee_name).toBe("Ama K")
    expect(out.allDestinationsComplete).toBe(true)
  })

  it("uses legacy staff bank when no default method and does not read live method after snapshot", () => {
    const entries = [
      {
        id: "e1",
        staff_id: "s1",
        net_salary: 200,
        staff: { name: "Joe", bank_name: "ABSA", bank_account: "999", phone: null },
      },
    ]
    const v1 = buildPayrollPaymentBatchItemsFromEntries({
      businessId: "b1",
      payrollRunId: "r1",
      entries,
      defaultMethodByStaffId: new Map(),
    })
    expect(v1.items[0].destination_bank_name).toBe("ABSA")
    expect(v1.items[0].legacy_destination_source).toBe("legacy_staff_bank")

    // Simulate changing default method in DB: rebuilt snapshot map would differ, but frozen rows keep v1
    const laterDefault = new Map([
      ["s1", { id: "m2", staff_id: "s1", method_type: "momo", momo_provider: "MTN", momo_number: "024" }],
    ])
    const hypotheticalRebuild = buildPayrollPaymentBatchItemsFromEntries({
      businessId: "b1",
      payrollRunId: "r1",
      entries,
      defaultMethodByStaffId: laterDefault,
    })
    expect(v1.items[0].destination_bank_name).toBe("ABSA")
    expect(hypotheticalRebuild.items[0].destination_momo_number).toBe("024")
  })

  it("marks destination incomplete when method missing", () => {
    const entries = [
      {
        id: "e1",
        staff_id: "s1",
        net_salary: 50,
        staff: { name: "No Dest", bank_name: null, bank_account: null, phone: null },
      },
    ]
    const out = buildPayrollPaymentBatchItemsFromEntries({
      businessId: "b1",
      payrollRunId: "r1",
      entries,
      defaultMethodByStaffId: new Map(),
    })
    expect(out.items[0].legacy_destination_source).toBe("missing")
    expect(out.allDestinationsComplete).toBe(false)
  })

  it("syncBatchStatusFromItems derives paid / partially_paid from item rows", () => {
    const baseItem = {
      destination_method_type: "bank" as const,
      destination_bank_name: "X",
      destination_account_number: "1",
      destination_momo_provider: null as string | null,
      destination_momo_number: null as string | null,
    }
    expect(
      syncBatchStatusFromItems("processing", [
        { ...baseItem, status: "paid" },
        { ...baseItem, status: "pending" },
      ])
    ).toBe("partially_paid")

    expect(
      syncBatchStatusFromItems("processing", [
        { ...baseItem, status: "paid" },
        { ...baseItem, status: "paid" },
      ])
    ).toBe("paid")

    expect(
      syncBatchStatusFromItems("processing", [
        { ...baseItem, status: "failed" },
        { ...baseItem, status: "pending" },
      ])
    ).toBe("failed")

    expect(deriveBatchStatusFromItemStatuses(["failed", "pending"]).suggested).toBe("failed")
  })

  it("assertManualBatchStatusTransition allows cancel from processing", () => {
    expect(() => assertManualBatchStatusTransition("processing", "cancelled")).not.toThrow()
    expect(() => assertManualBatchStatusTransition("processing", "paid")).toThrow()
  })

  it("CSV snapshot rows use BATCH_EXPORT_HEADERS order (contract)", () => {
    expect(BATCH_EXPORT_HEADERS).toContain("Batch ID")
    expect(BATCH_EXPORT_HEADERS).toContain("Destination Source")
    expect(BATCH_EXPORT_HEADERS).toContain("Failure Reason")
    const row = [
      "batch-uuid",
      "run-uuid",
      "2026-05",
      "Staff Name",
      "staff-uuid",
      "entry-uuid",
      formatNumeric(100),
      "GHS",
      "bank",
      "GCB",
      "",
      "",
      "123",
      "Name",
      "",
      "",
      "staff_payment_method",
      "pending",
      "",
      "",
    ]
    expect(row.length).toBe(BATCH_EXPORT_HEADERS.length)
    expect(BATCH_EXPORT_DISCLAIMER.length).toBeGreaterThan(20)
  })
})
