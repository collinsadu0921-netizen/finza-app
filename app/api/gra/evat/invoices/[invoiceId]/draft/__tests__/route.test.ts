/**
 * POST /api/gra/evat/invoices/[invoiceId]/draft
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))

jest.mock("@/lib/supabaseAdmin", () => ({
  createSupabaseAdminClient: jest.fn(() => ({})),
}))

jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))

jest.mock("@/lib/gra/evat/mapInvoiceToEvatDraft", () => ({
  mapInvoiceToEvatDraft: jest.fn(),
}))

jest.mock("@/lib/gra/evat/submissions", () => {
  const actual = jest.requireActual("@/lib/gra/evat/submissions") as typeof import("@/lib/gra/evat/submissions")
  return {
    ...actual,
    createDraftEvatSubmission: jest.fn(),
  }
})

import { resolveBusinessScopeForUser } from "@/lib/business"
import { mapInvoiceToEvatDraft } from "@/lib/gra/evat/mapInvoiceToEvatDraft"
import {
  createDraftEvatSubmission,
  type GraEvatSubmissionRow,
} from "@/lib/gra/evat/submissions"
import type { EvatInvoiceDraft } from "@/lib/gra/evat/mapInvoiceToEvatDraft"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { POST } from "../route"

const mapDraft = mapInvoiceToEvatDraft as jest.MockedFunction<typeof mapInvoiceToEvatDraft>
const createSub = createDraftEvatSubmission as jest.MockedFunction<typeof createDraftEvatSubmission>
const resolveScope = resolveBusinessScopeForUser as jest.MockedFunction<typeof resolveBusinessScopeForUser>
const mockServerClient = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>

function minimalDraft(overrides: Partial<EvatInvoiceDraft> = {}): EvatInvoiceDraft {
  return {
    source: "finza_invoice",
    submittable: false,
    invoice: { id: "inv1", number: "N1", date: "2026-01-01", currency: "GHS" },
    seller: { business_id: "biz1", name: "Co", tin: "TIN123", country: "GH" },
    buyer: { name: "B", tin: null, address: null, phone: null, email: null },
    items: [],
    taxes: { levies: [], vat: [], totalLevies: 0, totalVat: 0, totalTax: 0 },
    totals: {
      subtotal: 0,
      invoiceTotal: 0,
      storedTotalTax: 0,
      mappedTotalTax: 0,
      taxDifference: 0,
    },
    warnings: [],
    blockingIssues: [],
    ...overrides,
  }
}

function submissionRow(overrides: Partial<GraEvatSubmissionRow> = {}): GraEvatSubmissionRow {
  return {
    id: "sub1",
    business_id: "biz1",
    invoice_id: "inv1",
    enrollment_id: "enr1",
    environment: "test",
    status: "draft",
    submission_type: "invoice",
    idempotency_key: "k1",
    request_hash: "h1",
    draft_snapshot: {},
    request_payload: { secret: "x" },
    response_payload: { raw: "y" },
    gra_reference: null,
    ysdcid: null,
    ysdcrecnum: null,
    ysdcregsig: null,
    ysdcintdata: null,
    ysdcmrc: null,
    qr_code: null,
    authority_timestamp: null,
    error_code: null,
    error_message: null,
    retry_count: 0,
    last_attempt_at: null,
    next_retry_at: null,
    submitted_at: null,
    accepted_at: null,
    rejected_at: null,
    failed_at: null,
    created_by: "user1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function chainInvoice(invoice: Record<string, unknown> | null) {
  const p = Promise.resolve({ data: invoice, error: null })
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: () => p,
          }),
        }),
      }),
    }),
  }
}

function chainEnrollment(row: Record<string, unknown> | null) {
  const p = Promise.resolve({ data: row, error: null })
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => p,
        }),
      }),
    }),
  }
}

function chainItems(rows: unknown[]) {
  const p = Promise.resolve({ data: rows, error: null })
  return {
    select: () => ({
      eq: () => ({
        order: () => p,
      }),
    }),
  }
}

function makeSupabase(opts: {
  user: { id: string } | null
  invoice: Record<string, unknown> | null
  enrollment: Record<string, unknown> | null
  items: unknown[]
}) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: opts.user }, error: null }),
    },
    from: jest.fn((table: string) => {
      if (table === "invoices") return chainInvoice(opts.invoice)
      if (table === "business_gra_evat_enrollments") return chainEnrollment(opts.enrollment)
      if (table === "invoice_items") return chainItems(opts.items)
      return {}
    }),
  }
}

const invoiceRow = {
  id: "inv1",
  business_id: "biz1",
  invoice_number: "N1",
  reference: null,
  issue_date: "2026-01-01",
  created_at: "2026-01-01T00:00:00Z",
  currency_code: "GHS",
  subtotal: 100,
  total_tax: 0,
  total: 100,
  tax_lines: { lines: [] },
  customers: null,
  businesses: { id: "biz1", name: "Co", tax_id: "TIN123", tin: "TIN123", address_country: "GH" },
}

beforeEach(() => {
  jest.clearAllMocks()
  resolveScope.mockResolvedValue({ ok: true, businessId: "biz1" })
  mockServerClient.mockResolvedValue(
    makeSupabase({
      user: { id: "user1" },
      invoice: invoiceRow,
      enrollment: { id: "enr1", enrollment_status: "approved" },
      items: [],
    }) as never
  )
})

function req(url: string, body?: Record<string, unknown>) {
  return new NextRequest(url, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe("POST /api/gra/evat/invoices/[invoiceId]/draft", () => {
  it("returns 401 when unauthenticated", async () => {
    mockServerClient.mockResolvedValue(
      makeSupabase({
        user: null,
        invoice: invoiceRow,
        enrollment: null,
        items: [],
      }) as never
    )
    const res = await POST(req("http://localhost/api/gra/evat/invoices/inv1/draft", {}), {
      params: { invoiceId: "inv1" },
    })
    expect(res.status).toBe(401)
    expect(mapDraft).not.toHaveBeenCalled()
  })

  it("returns 403 when business scope fails", async () => {
    resolveScope.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" })
    const res = await POST(req("http://localhost/api/gra/evat/invoices/inv1/draft", {}), {
      params: { invoiceId: "inv1" },
    })
    expect(res.status).toBe(403)
    expect(mapDraft).not.toHaveBeenCalled()
  })

  it("returns 404 when invoice not found for scoped business", async () => {
    mockServerClient.mockResolvedValue(
      makeSupabase({
        user: { id: "user1" },
        invoice: null,
        enrollment: null,
        items: [],
      }) as never
    )
    const res = await POST(req("http://localhost/api/gra/evat/invoices/missing/draft", {}), {
      params: { invoiceId: "missing" },
    })
    expect(res.status).toBe(404)
    expect(mapDraft).not.toHaveBeenCalled()
  })

  it("returns ok false without insert when not submittable (enrollment)", async () => {
    mapDraft.mockReturnValue(
      minimalDraft({
        submittable: false,
        warnings: ["evat_not_approved"],
        blockingIssues: ["evat_not_approved"],
      })
    )
    const res = await POST(req("http://localhost/api/gra/evat/invoices/inv1/draft", {}), {
      params: { invoiceId: "inv1" },
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.blockingIssues).toContain("evat_not_approved")
    expect(createSub).not.toHaveBeenCalled()
  })

  it("returns ok false without insert when blocking seller TIN", async () => {
    mapDraft.mockReturnValue(
      minimalDraft({
        submittable: false,
        warnings: ["missing_seller_tin"],
        blockingIssues: ["missing_seller_tin"],
        seller: { business_id: "biz1", name: "Co", tin: null, country: "GH" },
      })
    )
    const res = await POST(req("http://localhost/api/gra/evat/invoices/inv1/draft", {}), {
      params: { invoiceId: "inv1" },
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.blockingIssues).toContain("missing_seller_tin")
    expect(createSub).not.toHaveBeenCalled()
  })

  it("creates draft submission when submittable", async () => {
    const draft = minimalDraft({ submittable: true, warnings: [], blockingIssues: [] })
    mapDraft.mockReturnValue(draft)
    const row = submissionRow({ request_payload: { x: 1 }, response_payload: { y: 2 } })
    createSub.mockResolvedValue({ data: row, error: null })

    const res = await POST(
      req("http://localhost/api/gra/evat/invoices/inv1/draft", {
        environment: "test",
        submission_type: "invoice",
      }),
      { params: { invoiceId: "inv1" } }
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.submission.id).toBe("sub1")
    expect(json.submission).not.toHaveProperty("request_payload")
    expect(json.submission).not.toHaveProperty("response_payload")

    expect(createSub).toHaveBeenCalledTimes(1)
    const call = createSub.mock.calls[0]
    expect(call[1]).toMatchObject({
      businessId: "biz1",
      invoiceId: "inv1",
      enrollmentId: "enr1",
      environment: "test",
      submissionType: "invoice",
      createdBy: "user1",
    })
    expect(call[1].draft).toEqual(draft)
  })

  it("repeated POST returns 200 with same submission id when persistence is idempotent", async () => {
    const draft = minimalDraft({ submittable: true, warnings: [], blockingIssues: [] })
    mapDraft.mockReturnValue(draft)
    const row = submissionRow({ id: "stable-sub-id" })
    createSub.mockResolvedValue({ data: row, error: null })

    const params = { params: { invoiceId: "inv1" } }
    const body = { environment: "test", submission_type: "invoice" }
    const res1 = await POST(req("http://localhost/api/gra/evat/invoices/inv1/draft", body), params)
    const res2 = await POST(req("http://localhost/api/gra/evat/invoices/inv1/draft", body), params)

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    const j1 = await res1.json()
    const j2 = await res2.json()
    expect(j1.ok).toBe(true)
    expect(j2.ok).toBe(true)
    expect(j1.submission.id).toBe("stable-sub-id")
    expect(j2.submission.id).toBe("stable-sub-id")
    expect(createSub).toHaveBeenCalledTimes(2)
  })
})
