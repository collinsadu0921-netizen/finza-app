import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { NextRequest } from "next/server"
import type { ProposalAiContext } from "@/lib/proposals/ai/context"
import type { ProposalAiDraft } from "@/lib/proposals/ai/schema"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))
jest.mock("@/lib/proposals/ai/context", () => ({
  loadProposalAiContext: jest.fn(),
}))
jest.mock("@/lib/proposals/ai/rateLimit", () => ({
  checkProposalAiRateLimit: jest.fn(),
}))
jest.mock("@/lib/proposals/ai/openai", () => {
  const actual = jest.requireActual("@/lib/proposals/ai/openai") as Record<string, unknown>
  return {
    ...actual,
    generateProposalDraftWithAi: jest.fn(),
    editProposalDraftWithAi: jest.fn(),
  }
})

import { POST } from "../route"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { loadProposalAiContext } from "@/lib/proposals/ai/context"
import { checkProposalAiRateLimit } from "@/lib/proposals/ai/rateLimit"
import {
  editProposalDraftWithAi,
  generateProposalDraftWithAi,
  ProposalAiError,
} from "@/lib/proposals/ai/openai"

const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const PROPOSAL_ID = "pppppppp-pppp-4ppp-8ppp-pppppppppppp"
const CUSTOMER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

const CONTEXT: ProposalAiContext = {
  business: {
    id: BUSINESS_ID,
    name: "Acme Studio",
    legalName: "Acme Studio Limited",
    tradingName: "Acme Studio",
    logoUrl: null,
    address: "Accra, Ghana",
    phone: null,
    email: null,
    website: null,
    tin: null,
    defaultCurrency: "GHS",
    industry: "service",
  },
  proposal: {
    id: PROPOSAL_ID,
    title: "Cleaning proposal",
    status: "draft",
    customerId: CUSTOMER_ID,
    templateId: "premium_v1",
    currencyCode: "GHS",
    expiresAt: null,
    sections: [{ type: "heading", level: 2, text: "Scope", id: "s1" }],
    pricingMode: "line_items",
    pricingPayload: { mode: "line_items", items: [] },
  },
  selectedCustomer: { id: CUSTOMER_ID, name: "ABC Company", email: null, phone: null },
  customers: [{ id: CUSTOMER_ID, name: "ABC Company", email: null, phone: null }],
  services: [{ name: "Office cleaning", unitPrice: 4500, source: "service_catalog" }],
}

const DRAFT: ProposalAiDraft = {
  summary: "Drafted a cleaning proposal.",
  title: "Office cleaning proposal",
  customer_match: { customer_id: CUSTOMER_ID, customer_name: "ABC Company", confidence: "high" },
  chapters: [
    { title: "Introduction", paragraphs: ["Proposal introduction."], bullets: [] },
    { title: "Scope of work", paragraphs: ["Offices and washrooms."], bullets: ["Offices", "Washrooms"] },
    { title: "Investment and pricing", paragraphs: ["Monthly investment below."], bullets: [] },
  ],
  pricing: {
    mode: "line_items",
    fixed_amount: null,
    fixed_label: null,
    items: [{ description: "Monthly cleaning", quantity: 6, unit_price: 4500, discount_amount: null }],
  },
}

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/proposals/${PROPOSAL_ID}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const GENERATE_BODY = {
  business_id: BUSINESS_ID,
  action: "generate",
  instruction: "Prepare a cleaning proposal for ABC Company.",
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } } })) },
  } as never)
  jest.mocked(resolveBusinessScopeForUser).mockResolvedValue({
    ok: true,
    businessId: BUSINESS_ID,
  } as never)
  jest.mocked(loadProposalAiContext).mockResolvedValue({ ok: true, context: CONTEXT } as never)
  jest.mocked(checkProposalAiRateLimit).mockReturnValue({ ok: true } as never)
  jest.mocked(generateProposalDraftWithAi).mockResolvedValue({
    draft: DRAFT,
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      total_tokens: 1500,
      estimated_cost_usd: 0.003,
      model: "gpt-5.4-mini",
      latency_ms: 1200,
    },
  } as never)
})

describe("POST /api/proposals/[id]/ai", () => {
  it("rejects unauthenticated requests", async () => {
    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: jest.fn(async () => ({ data: { user: null } })) },
    } as never)
    const response = await POST(request(GENERATE_BODY), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(401)
  })

  it("rejects cross-tenant business scope", async () => {
    jest.mocked(resolveBusinessScopeForUser).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    } as never)
    const response = await POST(request(GENERATE_BODY), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(403)
    expect(generateProposalDraftWithAi).not.toHaveBeenCalled()
  })

  it("rejects locked proposals before calling OpenAI", async () => {
    jest.mocked(loadProposalAiContext).mockResolvedValue({
      ok: true,
      context: {
        ...CONTEXT,
        proposal: { ...CONTEXT.proposal, status: "accepted" },
      },
    } as never)
    const response = await POST(request(GENERATE_BODY), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(409)
    expect(generateProposalDraftWithAi).not.toHaveBeenCalled()
  })

  it("rejects a snapshot customer from another tenant", async () => {
    const response = await POST(
      request({
        ...GENERATE_BODY,
        snapshot: {
          title: "Draft",
          customer_id: "99999999-9999-4999-8999-999999999999",
          template_id: "premium_v1",
          currency_code: "GHS",
          sections: [],
          pricing_mode: "none",
          pricing_payload: {},
        },
      }),
      { params: Promise.resolve({ id: PROPOSAL_ID }) }
    )
    expect(response.status).toBe(400)
    expect(generateProposalDraftWithAi).not.toHaveBeenCalled()
  })

  it("generates and maps a validated draft without writing to the database", async () => {
    const response = await POST(request(GENERATE_BODY), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    const body = (await response.json()) as {
      ok: boolean
      preview: { title: string; customer_id: string; sections: unknown[] }
      usage: { estimated_cost_usd: number }
    }
    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.preview.title).toBe("Office cleaning proposal")
    expect(body.preview.customer_id).toBe(CUSTOMER_ID)
    expect(body.preview.sections.length).toBeGreaterThan(2)
    expect(body.usage.estimated_cost_usd).toBe(0.003)
  })

  it("maps malformed AI output to a safe 502 response", async () => {
    jest
      .mocked(generateProposalDraftWithAi)
      .mockRejectedValue(new ProposalAiError("AI_PARSE_FAILED", 502, "Unusable AI result"))
    const response = await POST(request(GENERATE_BODY), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    const body = (await response.json()) as { ok: boolean; code: string }
    expect(response.status).toBe(502)
    expect(body.code).toBe("AI_PARSE_FAILED")
  })

  it("returns 429 when the per-business limit is reached", async () => {
    jest.mocked(checkProposalAiRateLimit).mockReturnValue({ ok: false, retryAfterSec: 42 } as never)
    const response = await POST(request(GENERATE_BODY), { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("42")
    expect(generateProposalDraftWithAi).not.toHaveBeenCalled()
  })

  it("applies only a targeted chapter revision and preserves unrelated sections", async () => {
    const snapshot = {
      title: "Cleaning proposal",
      customer_id: CUSTOMER_ID,
      template_id: "premium_v1",
      currency_code: "GHS",
      sections: [
        { type: "heading", level: 2, text: "Introduction", id: "h1" },
        { type: "paragraph", text: "Original introduction.", id: "p1" },
        { type: "heading", level: 2, text: "Scope", id: "h2" },
        { type: "paragraph", text: "Original scope.", id: "p2" },
      ],
      pricing_mode: "line_items",
      pricing_payload: { items: [{ description: "Cleaning", quantity: 1, unit_price: 4500 }] },
    }
    jest.mocked(editProposalDraftWithAi).mockResolvedValue({
      edit: {
        summary: "Shortened scope.",
        changes: [
          {
            op: "replace_chapter",
            title: null,
            chapter_title: "Scope",
            chapter: { title: "Scope", paragraphs: ["Short scope."], bullets: [] },
            pricing: null,
            after_chapter: null,
          },
        ],
      },
      usage: {
        input_tokens: 900,
        output_tokens: 200,
        total_tokens: 1100,
        estimated_cost_usd: 0.001575,
        model: "gpt-5.4-mini",
        latency_ms: 800,
      },
    } as never)

    const response = await POST(
      request({
        business_id: BUSINESS_ID,
        action: "edit",
        instruction: "Shorten the scope.",
        snapshot,
      }),
      { params: Promise.resolve({ id: PROPOSAL_ID }) }
    )
    const body = (await response.json()) as {
      ok: boolean
      preview: { sections: Array<{ type: string; text?: string }> }
    }
    expect(response.status).toBe(200)
    expect(JSON.stringify(body.preview.sections)).toContain("Original introduction.")
    expect(JSON.stringify(body.preview.sections)).toContain("Short scope.")
    expect(JSON.stringify(body.preview.sections)).not.toContain("Original scope.")
  })

  it("rejects refinement of a chapter that is not in the snapshot", async () => {
    const response = await POST(
      request({
        business_id: BUSINESS_ID,
        action: "refine",
        instruction: "Shorten it.",
        chapter_title: "Portfolio",
        snapshot: {
          title: "Cleaning proposal",
          customer_id: null,
          template_id: "premium_v1",
          currency_code: "GHS",
          sections: [{ type: "heading", level: 2, text: "Scope", id: "h1" }],
          pricing_mode: "none",
          pricing_payload: {},
        },
      }),
      { params: Promise.resolve({ id: PROPOSAL_ID }) }
    )
    expect(response.status).toBe(400)
    expect(editProposalDraftWithAi).not.toHaveBeenCalled()
  })
})
