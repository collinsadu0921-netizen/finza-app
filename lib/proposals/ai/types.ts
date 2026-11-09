import type { PricingMode, ProposalSectionBlock } from "@/lib/proposals/schema"

export type ProposalAiAction = "generate" | "edit" | "refine" | "generate_section"

export type ProposalAiSnapshot = {
  title: string
  customer_id: string | null
  template_id: string
  currency_code: string | null
  sections: ProposalSectionBlock[]
  pricing_mode: PricingMode
  pricing_payload: unknown
}

export type ProposalAiCustomerHint = {
  customer_id: string | null
  customer_name: string | null
  confidence: "high" | "medium" | "low"
}

export type ProposalAiPreview = {
  title: string
  customer_id: string | null
  customer_hint: ProposalAiCustomerHint | null
  sections: ProposalSectionBlock[]
  pricing_mode: PricingMode
  pricing_payload: unknown
  changed_chapters: string[]
  warnings: string[]
}

export type ProposalAiUsage = {
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  estimated_cost_usd: number | null
  model: string
  latency_ms: number
}

export type ProposalAiSuccessResponse = {
  ok: true
  summary: string
  preview: ProposalAiPreview
  usage: ProposalAiUsage
}

export type ProposalAiErrorResponse = {
  ok: false
  error: string
  code: string
  retry_after_sec?: number
}

export type ProposalAiResponse = ProposalAiSuccessResponse | ProposalAiErrorResponse
