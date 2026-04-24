export type WhtReceivableDeductionStatus = "pending" | "partially_deducted" | "deducted"

export type WhtReceivableRow = {
  invoice_id: string
  invoice_number: string
  customer_name: string
  issue_date: string
  invoice_total: number
  expected_wht: number
  wht_outstanding: number
  deduction_status: WhtReceivableDeductionStatus
  invoice_status: string
  payment_id: string | null
  payment_date: string | null
  payment_reference: string | null
  payment_method: string | null
  wht_on_payment: number | null
}
