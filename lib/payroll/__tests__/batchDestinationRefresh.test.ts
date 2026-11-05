import { destinationFieldsFromPaymentMethod } from "@/lib/payroll/paymentBatchItems"

describe("batch destination refresh mapping", () => {
  it("maps a current Mobile Money default method", () => {
    expect(
      destinationFieldsFromPaymentMethod({
        id: "m1",
        staff_id: "s1",
        method_type: "momo",
        momo_provider: "MTN",
        momo_number: "0241234567",
        account_name: "Ama Serwaa",
      })
    ).toMatchObject({
      destination_method_type: "momo",
      destination_momo_provider: "MTN",
      destination_momo_number: "0241234567",
      destination_account_name: "Ama Serwaa",
      destination_bank_name: null,
    })
  })

  it("maps a current bank default method", () => {
    expect(
      destinationFieldsFromPaymentMethod({
        id: "m2",
        staff_id: "s2",
        method_type: "bank",
        bank_name: "GCB Bank",
        bank_code: "GH050100",
        branch_name: "Accra",
        account_number: "1234567890",
        account_name: "Kwame Mensah",
      })
    ).toMatchObject({
      destination_method_type: "bank",
      destination_bank_name: "GCB Bank",
      destination_bank_code: "GH050100",
      destination_branch_name: "Accra",
      destination_account_number: "1234567890",
      destination_account_name: "Kwame Mensah",
      destination_momo_provider: null,
    })
  })
})
