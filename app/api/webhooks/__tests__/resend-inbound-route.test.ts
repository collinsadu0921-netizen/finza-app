/**
 * POST /api/webhooks/resend-inbound — Svix verify + delegate to ingestion (mocked).
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"

jest.mock("svix", () => ({
  Webhook: jest.fn().mockImplementation(() => ({
    verify: jest.fn(() => ({
      type: "email.received",
      data: {
        email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
        to: ["inbound@finza.test"],
        from: "Sender <sender@example.com>",
        subject: "Receipt",
        created_at: "2026-01-03T10:00:00.000Z",
      },
    })),
  })),
}))

jest.mock("@/lib/supabaseServiceRole", () => ({
  getSupabaseServiceRoleClient: jest.fn(() => ({ mock: true })),
}))

jest.mock("@/lib/email/resendInboundNormalize", () => ({
  buildNormalizedInboundEmailFromResendWebhook: jest.fn(async () => ({
    provider: "resend" as const,
    providerMessageId: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
    recipientAddresses: ["inbound@finza.test"],
    senderAddress: "sender@example.com",
    subject: "Receipt",
    receivedAtIso: "2026-01-03T10:00:00.000Z",
    attachments: [
      {
        providerAttachmentId: "att-1",
        fileName: "receipt.pdf",
        contentType: "application/pdf",
        downloadUrl: "https://inbound-cdn.resend.com/signed",
        fileSizeBytes: 100,
      },
    ],
  })),
}))

jest.mock("@/lib/email/inboundEmailIngestionService", () => ({
  ingestNormalizedInboundEmail: jest.fn(),
}))

import { POST } from "../resend-inbound/route"
import { ingestNormalizedInboundEmail } from "@/lib/email/inboundEmailIngestionService"

const mockIngest = jest.mocked(ingestNormalizedInboundEmail)

function postReq(body?: string): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/resend-inbound", {
    method: "POST",
    headers: {
      "svix-id": "msg_1",
      "svix-timestamp": String(Math.floor(Date.now() / 1000)),
      "svix-signature": "v1,signature",
    },
    body: body ?? "{}",
  })
}

describe("POST /api/webhooks/resend-inbound", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.RESEND_WEBHOOK_SECRET = "whsec_test_secret"
    process.env.RESEND_API_KEY = "re_test_key"
  })

  it("returns 503 when RESEND_WEBHOOK_SECRET is unset", async () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {})
    delete process.env.RESEND_WEBHOOK_SECRET
    const res = await POST(postReq())
    expect(res.status).toBe(503)
    err.mockRestore()
    process.env.RESEND_WEBHOOK_SECRET = "whsec_test_secret"
  })

  it("returns 503 when RESEND_API_KEY is unset", async () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {})
    delete process.env.RESEND_API_KEY
    const res = await POST(postReq())
    expect(res.status).toBe(503)
    err.mockRestore()
    process.env.RESEND_API_KEY = "re_test_key"
  })

  it("returns 200 with ignored when ingestion reports unknown recipient", async () => {
    mockIngest.mockResolvedValue({
      ok: true,
      ignored: true,
      reason: "unknown_recipient",
      attachmentsIngested: 0,
    })
    const res = await POST(postReq("{}"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.ignored).toBe(true)
    expect(json.reason).toBe("unknown_recipient")
    expect(mockIngest).toHaveBeenCalledTimes(1)
  })

  it("returns 200 with idempotent flag when message already completed", async () => {
    mockIngest.mockResolvedValue({
      ok: true,
      idempotent: true,
      businessId: "b1",
      messageId: "m1",
      attachmentsIngested: 0,
    })
    const res = await POST(postReq("{}"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.idempotent).toBe(true)
    expect(json.attachments_ingested).toBe(0)
  })

  it("returns 200 with attachment count on successful ingest", async () => {
    mockIngest.mockResolvedValue({
      ok: true,
      businessId: "b1",
      messageId: "m1",
      attachmentsIngested: 1,
    })
    const res = await POST(postReq("{}"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.attachments_ingested).toBe(1)
    expect(json.message_id).toBe("m1")
  })
})
