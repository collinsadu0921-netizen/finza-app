import {
  isBatchItemPaystackEligible,
  sumBatchItemAmounts,
} from "@/lib/payroll/paystack/batchSelection"

const momoItem = {
  status: "pending",
  amount: 1500,
  destination_method_type: "momo",
  destination_momo_provider: "MTN",
  destination_momo_number: "0241234567",
  destination_account_name: "Ama Serwaa",
}

describe("batch Paystack selection", () => {
  it("selects a complete pending Mobile Money employee", () => {
    expect(
      isBatchItemPaystackEligible({
        item: momoItem,
        paystackEnabled: true,
        batchStatus: "processing",
      })
    ).toBe(true)
  })

  it("selects a complete bank employee", () => {
    expect(
      isBatchItemPaystackEligible({
        item: {
          status: "pending",
          amount: 2000,
          destination_method_type: "bank",
          destination_bank_code: "GH050100",
          destination_bank_name: "GCB Bank",
          destination_account_number: "1234567890",
          destination_account_name: "Kwame Mensah",
        },
        paystackEnabled: true,
        batchStatus: "processing",
      })
    ).toBe(true)
  })

  it("rejects missing account holder or destination details", () => {
    expect(
      isBatchItemPaystackEligible({
        item: { ...momoItem, destination_account_name: "" },
        paystackEnabled: true,
        batchStatus: "processing",
      })
    ).toBe(false)
    expect(
      isBatchItemPaystackEligible({
        item: { ...momoItem, destination_momo_number: "" },
        paystackEnabled: true,
        batchStatus: "processing",
      })
    ).toBe(false)
    expect(
      isBatchItemPaystackEligible({
        item: {
          status: "pending",
          amount: 100,
          destination_method_type: "bank",
          destination_bank_name: "GCB Bank",
          destination_account_number: "1234567890",
          destination_account_name: "No Code",
        },
        paystackEnabled: true,
        batchStatus: "processing",
      })
    ).toBe(false)
  })

  it("rejects rows with an active or successful transfer", () => {
    expect(
      isBatchItemPaystackEligible({
        item: momoItem,
        transfer: { status: "pending" },
        paystackEnabled: true,
        batchStatus: "processing",
      })
    ).toBe(false)
    expect(
      isBatchItemPaystackEligible({
        item: momoItem,
        transfer: { status: "successful" },
        paystackEnabled: true,
        batchStatus: "processing",
      })
    ).toBe(false)
  })

  it("allows a safely failed transfer to be retried", () => {
    expect(
      isBatchItemPaystackEligible({
        item: { ...momoItem, status: "failed" },
        transfer: { status: "failed" },
        paystackEnabled: true,
        batchStatus: "processing",
      })
    ).toBe(true)
  })

  it("rejects paid, missing-connection and cancelled-batch rows", () => {
    expect(
      isBatchItemPaystackEligible({
        item: { ...momoItem, payroll_payment_id: "pay-1" },
        paystackEnabled: true,
        batchStatus: "processing",
      })
    ).toBe(false)
    expect(
      isBatchItemPaystackEligible({
        item: momoItem,
        paystackEnabled: false,
        batchStatus: "processing",
      })
    ).toBe(false)
    expect(
      isBatchItemPaystackEligible({
        item: momoItem,
        paystackEnabled: true,
        batchStatus: "cancelled",
      })
    ).toBe(false)
  })

  it("sums selected amounts to two decimals", () => {
    expect(sumBatchItemAmounts([momoItem, { ...momoItem, amount: 2000.005 }])).toBe(3500.01)
  })
})
