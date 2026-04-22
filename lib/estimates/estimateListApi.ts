/** Shared list row shape for GET /api/estimates/list and service UI. */
export type EstimateListRow = {
  id: string
  estimate_number: string | null
  customer_id: string | null
  customer_name: string | null
  total_amount: number
  status: string
  expiry_date: string | null
  created_at: string
}

export type EstimatesListPagination = {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export type EstimatesListSummary = {
  /** Rows matching status filter (not search), non-deleted */
  totalInFilter: number
  /** “Awaiting response” card — matches prior client semantics */
  sentInScope: number
  /** “Accepted” card — matches prior client semantics */
  acceptedInScope: number
}

export type EstimatesListResponse = {
  estimates: EstimateListRow[]
  pagination: EstimatesListPagination
  summary: EstimatesListSummary
  business_default_currency: string | null
}

export const DEFAULT_ESTIMATES_LIST_PAGE_SIZE = 50
export const MAX_ESTIMATES_LIST_PAGE_SIZE = 100
