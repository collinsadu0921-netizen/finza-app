import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildEvatIdempotencyKey,
  createDraftEvatSubmission,
  hashEvatDraftSnapshot,
  stableStringifyForEvatHash,
  type GraEvatSubmissionRow,
} from "../submissions"
import type { EvatInvoiceDraft } from "../mapInvoiceToEvatDraft"

function minimalDraft(overrides: Partial<EvatInvoiceDraft> = {}): EvatInvoiceDraft {
  return {
    source: "finza_invoice",
    submittable: true,
    invoice: { id: "inv1", number: "N1", date: "2026-01-01", currency: "GHS" },
    seller: { business_id: "b1", name: "S", tin: "T", country: "GH" },
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

/** select * … eq idempotency … eq business … maybeSingle */
function chainSelectByIdempotencyKey(data: unknown | null, error: { message: string } | null = null) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data, error }),
        }),
      }),
    }),
  }
}

/** select * … 4× eq … in … order … limit … maybeSingle */
function chainSelectOpenPipeline(data: unknown | null, error: { message: string } | null = null) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data, error }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  }
}

function chainInsertSelectSingle(result: { data: unknown; error: unknown }) {
  return {
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve(result),
      }),
    }),
  }
}

function baseRow(overrides: Partial<GraEvatSubmissionRow> = {}): GraEvatSubmissionRow {
  const draft = minimalDraft()
  return {
    id: "sub1",
    business_id: "b1",
    invoice_id: "inv1",
    enrollment_id: null,
    environment: "test",
    status: "draft",
    submission_type: "invoice",
    idempotency_key: buildEvatIdempotencyKey({
      businessId: "b1",
      invoiceId: "inv1",
      environment: "test",
      submissionType: "invoice",
    }),
    request_hash: hashEvatDraftSnapshot(draft),
    draft_snapshot: {},
    request_payload: null,
    response_payload: null,
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
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

describe("gra evat submissions helpers", () => {
  it("buildEvatIdempotencyKey is deterministic", () => {
    const a = buildEvatIdempotencyKey({
      businessId: "b1",
      invoiceId: "i1",
      environment: "live",
      submissionType: "invoice",
    })
    const b = buildEvatIdempotencyKey({
      businessId: "b1",
      invoiceId: "i1",
      environment: "live",
      submissionType: "invoice",
    })
    expect(a).toBe(b)
    expect(a).toBe("gra-evat:live:b1:i1:invoice")
  })

  it("hashEvatDraftSnapshot is stable when nested key order differs", () => {
    const nestBFirst = { z: 1, a: { y: 2, x: 3 } }
    const nestAFirst = { z: 1, a: { x: 3, y: 2 } }
    expect(stableStringifyForEvatHash(nestBFirst)).toBe(stableStringifyForEvatHash(nestAFirst))

    const draft1 = minimalDraft({
      invoice: { id: "inv1", number: "N1", date: "2026-01-01", currency: "GHS" },
    })
    const draft2 = minimalDraft({
      invoice: { currency: "GHS", date: "2026-01-01", number: "N1", id: "inv1" },
    })
    expect(hashEvatDraftSnapshot(draft1)).toBe(hashEvatDraftSnapshot(draft2))
  })

  it("createDraftEvatSubmission sends expected insert shape when no existing row (mocked)", async () => {
    const draft = minimalDraft()
    const row = baseRow()
    const insertSpy = jest.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: row, error: null }),
      }),
    }))
    const from = jest.fn()
    from.mockImplementationOnce(() => chainSelectByIdempotencyKey(null))
    from.mockImplementationOnce(() => chainSelectOpenPipeline(null))
    from.mockImplementationOnce(() => ({ insert: insertSpy }))
    const supabase = { from } as unknown as SupabaseClient

    const { data, error } = await createDraftEvatSubmission(supabase, {
      businessId: "b1",
      invoiceId: "inv1",
      environment: "test",
      draft,
    })

    expect(error).toBeNull()
    expect(data).toEqual(row)
    expect(from).toHaveBeenCalledTimes(3)
    expect(insertSpy).toHaveBeenCalledTimes(1)

    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>
    const allowedKeys = new Set([
      "business_id",
      "invoice_id",
      "enrollment_id",
      "environment",
      "submission_type",
      "idempotency_key",
      "request_hash",
      "draft_snapshot",
      "status",
      "created_by",
    ])
    expect(Object.keys(payload).every((k) => allowedKeys.has(k))).toBe(true)
    expect(payload).not.toHaveProperty("secret_config_encrypted")
    expect(payload).not.toHaveProperty("vsdc_private_key")
    expect(payload).not.toHaveProperty("api_secret")
    expect(payload.request_payload).toBeUndefined()
    expect(payload.response_payload).toBeUndefined()
  })

  it("createDraftEvatSubmission returns existing row by idempotency key without insert", async () => {
    const draft = minimalDraft()
    const existing = baseRow({ id: "existing-1" })
    const from = jest.fn(() => chainSelectByIdempotencyKey(existing))
    const supabase = { from } as unknown as SupabaseClient

    const { data, error } = await createDraftEvatSubmission(supabase, {
      businessId: "b1",
      invoiceId: "inv1",
      environment: "test",
      draft,
    })

    expect(error).toBeNull()
    expect(data?.id).toBe("existing-1")
    expect(from).toHaveBeenCalledTimes(1)
  })

  it("createDraftEvatSubmission returns existing open-pipeline row when idempotency miss (legacy key)", async () => {
    const draft = minimalDraft()
    const openRow = baseRow({
      id: "legacy-open",
      idempotency_key: "legacy-different-key",
      status: "draft",
    })
    const from = jest.fn()
    from.mockImplementationOnce(() => chainSelectByIdempotencyKey(null))
    from.mockImplementationOnce(() => chainSelectOpenPipeline(openRow))
    const supabase = { from } as unknown as SupabaseClient

    const { data, error } = await createDraftEvatSubmission(supabase, {
      businessId: "b1",
      invoiceId: "inv1",
      environment: "test",
      draft,
    })

    expect(error).toBeNull()
    expect(data?.id).toBe("legacy-open")
    expect(from).toHaveBeenCalledTimes(2)
  })

  it("createDraftEvatSubmission recovers on insert 23505 duplicate by re-selecting idempotency key", async () => {
    const draft = minimalDraft()
    const row = baseRow()
    const from = jest.fn()
    from.mockImplementationOnce(() => chainSelectByIdempotencyKey(null))
    from.mockImplementationOnce(() => chainSelectOpenPipeline(null))
    from.mockImplementationOnce(() =>
      chainInsertSelectSingle({ data: null, error: { message: "duplicate key", code: "23505" } })
    )
    from.mockImplementationOnce(() => chainSelectByIdempotencyKey(row))
    const supabase = { from } as unknown as SupabaseClient

    const { data, error } = await createDraftEvatSubmission(supabase, {
      businessId: "b1",
      invoiceId: "inv1",
      environment: "test",
      draft,
    })

    expect(error).toBeNull()
    expect(data?.id).toBe("sub1")
    expect(from).toHaveBeenCalledTimes(4)
  })

  it("createDraftEvatSubmission recovers on 23505 via open-pipeline select when key select still empty", async () => {
    const draft = minimalDraft()
    const openRow = baseRow({ id: "open-recovered" })
    const from = jest.fn()
    from.mockImplementationOnce(() => chainSelectByIdempotencyKey(null))
    from.mockImplementationOnce(() => chainSelectOpenPipeline(null))
    from.mockImplementationOnce(() =>
      chainInsertSelectSingle({ data: null, error: { message: "duplicate key", code: "23505" } })
    )
    from.mockImplementationOnce(() => chainSelectByIdempotencyKey(null))
    from.mockImplementationOnce(() => chainSelectOpenPipeline(openRow))
    const supabase = { from } as unknown as SupabaseClient

    const { data, error } = await createDraftEvatSubmission(supabase, {
      businessId: "b1",
      invoiceId: "inv1",
      environment: "test",
      draft,
    })

    expect(error).toBeNull()
    expect(data?.id).toBe("open-recovered")
    expect(from).toHaveBeenCalledTimes(5)
  })

  it("createDraftEvatSubmission surfaces non-unique Supabase errors", async () => {
    const draft = minimalDraft()
    const from = jest.fn()
    from.mockImplementationOnce(() => chainSelectByIdempotencyKey(null))
    from.mockImplementationOnce(() => chainSelectOpenPipeline(null))
    from.mockImplementationOnce(() =>
      chainInsertSelectSingle({ data: null, error: { message: "permission denied", code: "42501" } })
    )
    const supabase = { from } as unknown as SupabaseClient

    const { data, error } = await createDraftEvatSubmission(supabase, {
      businessId: "b1",
      invoiceId: "inv1",
      environment: "live",
      draft,
    })
    expect(data).toBeNull()
    expect(error?.message).toBe("permission denied")
  })

  it("createDraftEvatSubmission: first call inserts, second call hits idempotency select only", async () => {
    const draft = minimalDraft()
    const row = baseRow()
    const from = jest.fn()
    const insertSpy = jest.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: row, error: null }),
      }),
    }))

    // First invocation: key null, open null, insert
    from.mockImplementationOnce(() => chainSelectByIdempotencyKey(null))
    from.mockImplementationOnce(() => chainSelectOpenPipeline(null))
    from.mockImplementationOnce(() => ({ insert: insertSpy }))
    // Second invocation: key hit
    from.mockImplementationOnce(() => chainSelectByIdempotencyKey(row))

    const supabase = { from } as unknown as SupabaseClient

    const r1 = await createDraftEvatSubmission(supabase, {
      businessId: "b1",
      invoiceId: "inv1",
      environment: "test",
      draft,
    })
    const r2 = await createDraftEvatSubmission(supabase, {
      businessId: "b1",
      invoiceId: "inv1",
      environment: "test",
      draft,
    })

    expect(r1.error).toBeNull()
    expect(r2.error).toBeNull()
    expect(r1.data?.id).toBe("sub1")
    expect(r2.data?.id).toBe("sub1")
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledTimes(4)
  })
})
