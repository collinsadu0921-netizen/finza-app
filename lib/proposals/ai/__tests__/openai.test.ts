import { describe, expect, it } from "@jest/globals"
import type { ProposalAiContext } from "../context"
import {
  buildProposalAiRequest,
  estimateProposalAiCostUsd,
  generateProposalDraftWithAi,
  ProposalAiError,
} from "../openai"
import type { ProposalAiDraft } from "../schema"

const CONTEXT: ProposalAiContext = {
  business: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Acme Studio",
    legalName: "Acme Studio Limited",
    tradingName: "Acme Studio",
    logoUrl: "https://example.com/logo.png",
    address: "14 Independence Avenue, Accra, Ghana",
    phone: "+233300000000",
    email: "hello@acme.example",
    website: "https://acme.example",
    tin: "C0012345678",
    defaultCurrency: "GHS",
    industry: "service",
  },
  proposal: {
    id: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
    title: "Office cleaning proposal",
    status: "draft",
    customerId: null,
    templateId: "premium_v1",
    currencyCode: "GHS",
    expiresAt: null,
    sections: [],
    pricingMode: "none",
    pricingPayload: { mode: "none" },
  },
  selectedCustomer: null,
  customers: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "ABC Company", email: null, phone: null }],
  services: [{ name: "Office cleaning", unitPrice: 4500, source: "service_catalog" }],
}

const DRAFT: ProposalAiDraft = {
  summary: "Drafted a cleaning proposal.",
  title: "Office cleaning for ABC Company",
  customer_match: {
    customer_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    customer_name: "ABC Company",
    confidence: "high",
  },
  chapters: [
    {
      title: "Introduction",
      paragraphs: ["A professional cleaning proposal for ABC Company."],
      bullets: [],
    },
    {
      title: "Scope of work",
      paragraphs: ["Three visits per week for six months."],
      bullets: ["Offices", "Washrooms", "Meeting rooms"],
    },
    {
      title: "Investment and pricing",
      paragraphs: ["Monthly investment is shown below."],
      bullets: [],
    },
  ],
  pricing: {
    mode: "line_items",
    fixed_amount: null,
    fixed_label: null,
    items: [
      { description: "Office cleaning — monthly", quantity: 6, unit_price: 4500, discount_amount: null },
    ],
  },
}

describe("proposal AI request construction", () => {
  it("builds a structured draft request with the supplied business context", () => {
    const request = buildProposalAiRequest({
      model: "gpt-5.4-mini",
      action: "generate",
      instruction: "Prepare a cleaning proposal.",
      context: CONTEXT,
    })
    expect(request.model).toBe("gpt-5.4-mini")
    expect(request.store).toBe(false)
    expect(request.reasoning.effort).toBe("low")
    expect(JSON.stringify(request.text)).toContain("proposal_draft")
    expect(JSON.stringify(request.text)).toContain("strict")
    const input = JSON.stringify(request.input)
    expect(input).toContain("Acme Studio")
    expect(input).toContain("ABC Company")
    expect(input).toContain("Office cleaning")
    expect(input).toContain("Prepare a cleaning proposal.")
  })

  it("uses no reasoning for targeted edits", () => {
    const request = buildProposalAiRequest({
      model: "gpt-5.4-mini",
      action: "refine",
      instruction: "Shorten this chapter.",
      context: CONTEXT,
    })
    expect(request.reasoning.effort).toBe("none")
    expect(JSON.stringify(request.text)).toContain("proposal_edit")
  })
})

describe("proposal AI structured output", () => {
  it("accepts only schema-valid structured output and returns usage", async () => {
    const client = {
      responses: {
        parse: async () => ({
          output_parsed: DRAFT,
          output: [{ type: "message", content: [{ type: "output_text" }] }],
          usage: { input_tokens: 1200, output_tokens: 700, total_tokens: 1900 },
          id: "resp_test",
        }),
      },
    }
    const result = await generateProposalDraftWithAi({
      instruction: "Prepare a cleaning proposal.",
      context: CONTEXT,
      client,
      model: "gpt-5.4-mini",
    })
    expect(result.draft.title).toBe("Office cleaning for ABC Company")
    expect(result.usage.input_tokens).toBe(1200)
    expect(result.usage.output_tokens).toBe(700)
    expect(result.usage.estimated_cost_usd).toBeCloseTo(0.00405, 6)
  })

  it("rejects malformed output without applying anything", async () => {
    const client = {
      responses: {
        parse: async () => ({
          output_parsed: { title: "Missing chapters" },
          output: [{ type: "message", content: [{ type: "output_text" }] }],
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
      },
    }
    await expect(
      generateProposalDraftWithAi({
        instruction: "Prepare a cleaning proposal.",
        context: CONTEXT,
        client,
        model: "gpt-5.4-mini",
      })
    ).rejects.toMatchObject({ code: "AI_PARSE_FAILED", httpStatus: 502 })
  })

  it("maps refusals to a safe error", async () => {
    const client = {
      responses: {
        parse: async () => ({
          output_parsed: DRAFT,
          output: [{ type: "message", content: [{ type: "refusal" }] }],
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
      },
    }
    await expect(
      generateProposalDraftWithAi({
        instruction: "Prepare a cleaning proposal.",
        context: CONTEXT,
        client,
        model: "gpt-5.4-mini",
      })
    ).rejects.toBeInstanceOf(ProposalAiError)
  })
})

describe("proposal AI cost estimates", () => {
  it("uses documented per-million-token pricing for known models", () => {
    expect(estimateProposalAiCostUsd("gpt-5.4-mini", 1_000, 500)).toBeCloseTo(0.003, 6)
    expect(estimateProposalAiCostUsd("gpt-5.4-nano", 1_000, 500)).toBeCloseTo(0.000825, 6)
    expect(estimateProposalAiCostUsd("unknown-model", 1_000, 500)).toBeNull()
  })

  it("returns null for missing token counts instead of inventing usage", () => {
    expect(estimateProposalAiCostUsd("gpt-5.4-mini", null, 100)).toBeNull()
    expect(estimateProposalAiCostUsd("gpt-5.4-mini", 100, undefined)).toBeNull()
  })
})
