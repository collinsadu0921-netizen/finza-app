/**
 * @jest-environment node
 */

const mockProcess = jest.fn()

jest.mock("@/lib/supabaseAdmin", () => ({
  createSupabaseAdminClient: jest.fn(() => ({})),
}))

jest.mock("@/lib/server/accountingSnapshotWorker", () => ({
  processAccountingSnapshotJobs: (...args: unknown[]) => mockProcess(...args),
}))

import { GET, POST } from "../route"

function req(auth?: string, url = "http://localhost/api/cron/accounting-snapshots") {
  return new Request(url, {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  }) as unknown as import("next/server").NextRequest
}

describe("accounting-snapshots cron route", () => {
  const prev = process.env.CRON_SECRET

  beforeEach(() => {
    mockProcess.mockReset()
    process.env.CRON_SECRET = "test-secret"
  })

  afterAll(() => {
    if (prev === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prev
  })

  it("rejects unauthenticated requests", async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockProcess).not.toHaveBeenCalled()
  })

  it("rejects wrong bearer token", async () => {
    const res = await GET(req("Bearer wrong"))
    expect(res.status).toBe(401)
  })

  it("runs bounded batch and returns counts", async () => {
    mockProcess.mockResolvedValue({
      claimed: 3,
      completed: 2,
      failed: 1,
      retried: 1,
      batches: 1,
      errors: [{ jobId: "x", error: "e" }],
    })

    const res = await POST(req("Bearer test-secret"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      claimed: 3,
      completed: 2,
      failed: 1,
      retried: 1,
      batches: 1,
      error_count: 1,
    })
    expect(mockProcess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ batchSize: 20, maxBatches: 5 })
    )
  })
})
