export type ProposalListRow = {
  id: string
  title: string
  status: string
  template_id: string
  proposal_number: string | null
  customer_id: string | null
  public_token: string
  converted_estimate_id?: string | null
  created_at: string
  updated_at: string
}
