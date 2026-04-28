/**
 * Inbound "new documents" notification: recipient resolution, idempotency, send wiring.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"

jest.mock("@/lib/email/sendTransactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(),
}))

import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import {
  buildInboundDocumentsReceivedEmail,
  notifyInboundDocumentsCreated,
  resolveInboundDocumentsNotificationRecipient,
} from "@/lib/email/sendInboundDocumentsReceivedNotification"

const BIZ = "11111111-1111-4111-8111-111111111111"
const MSG = "22222222-2222-4222-8222-222222222222"
const DOC = "33333333-3333-4333-8333-333333333333"

beforeEach(() => {
  jest.mocked(sendTransactionalEmail).mockReset()
  jest.mocked(sendTransactionalEmail).mockResolvedValue({ success: true, id: "re_1" })
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test"
})

describe("buildInboundDocumentsReceivedEmail", () => {
  it("uses review URL for a single document", () => {
    const { html, text } = buildInboundDocumentsReceivedEmail({
      businessName: "Acme Ltd",
      senderAddress: "vendor@example.com",
      subject: "Invoice April",
      fileNames: ["inv.pdf"],
      reviewUrl: "https://app.test/service/incoming-documents/doc1/review?business_id=x",
      listUrl: "https://app.test/service/incoming-documents?business_id=x",
      multiple: false,
    })
    expect(html).toContain("Review document")
    expect(html).toContain("vendor@example.com")
    expect(html).toContain("Invoice April")
    expect(html).toContain("inv.pdf")
    expect(text).toContain("From: vendor@example.com")
  })

  it("uses list CTA when multiple documents", () => {
    const { html } = buildInboundDocumentsReceivedEmail({
      businessName: "Acme Ltd",
      senderAddress: "a@b.co",
      subject: null,
      fileNames: ["a.pdf", "b.pdf"],
      reviewUrl: "https://app.test/list",
      listUrl: "https://app.test/list",
      multiple: true,
    })
    expect(html).toContain("Open incoming documents")
  })
})

describe("resolveInboundDocumentsNotificationRecipient", () => {
  it("prefers businesses.email when valid", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { name: "Co", email: "biz@co.test", owner_id: "u1" },
              error: null,
            }),
          }),
        }),
      }),
    } as never
    const r = await resolveInboundDocumentsNotificationRecipient(supabase, BIZ)
    expect(r).toEqual({ to: "biz@co.test", businessName: "Co" })
  })

  it("falls back to owner users.email", async () => {
    let usersCalled = false
    const supabase = {
      from: (table: string) => {
        if (table === "businesses") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { name: "Co", email: null, owner_id: "u1" },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === "users") {
          usersCalled = true
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { email: "owner@co.test" },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      },
    } as never
    const r = await resolveInboundDocumentsNotificationRecipient(supabase, BIZ)
    expect(usersCalled).toBe(true)
    expect(r).toEqual({ to: "owner@co.test", businessName: "Co" })
  })
})

describe("notifyInboundDocumentsCreated", () => {
  it("skips when no document ids", async () => {
    const supabase = { from: jest.fn() } as never
    const r = await notifyInboundDocumentsCreated(supabase, {
      messageId: MSG,
      businessId: BIZ,
      createdDocumentIds: [],
      fileNames: [],
      senderAddress: "x@y.z",
      subject: "S",
    })
    expect(r).toEqual({ ok: true, skipped: true, reason: "no_documents" })
    expect(sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it("skips when no recipient email on file", async () => {
    const supabase = {
      from: (table: string) => {
        if (table === "inbound_email_messages") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { documents_notify_sent_at: null }, error: null }),
              }),
            }),
          }
        }
        if (table === "businesses") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { name: "Co", email: "not-an-email", owner_id: "u1" },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { email: null }, error: null }),
              }),
            }),
          }
        }
        return {}
      },
    } as never
    const r = await notifyInboundDocumentsCreated(supabase, {
      messageId: MSG,
      businessId: BIZ,
      createdDocumentIds: [DOC],
      fileNames: ["f.pdf"],
      senderAddress: "x@y.z",
      subject: "S",
    })
    expect(r).toEqual({ ok: true, skipped: true, reason: "no_recipient" })
    expect(sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it("skips when documents_notify_sent_at already set", async () => {
    const supabase = {
      from: (table: string) => {
        if (table === "inbound_email_messages") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { documents_notify_sent_at: "2026-01-01T00:00:00Z" },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      },
    } as never
    const r = await notifyInboundDocumentsCreated(supabase, {
      messageId: MSG,
      businessId: BIZ,
      createdDocumentIds: [DOC],
      fileNames: ["f.pdf"],
      senderAddress: "x@y.z",
      subject: "S",
    })
    expect(r).toEqual({ ok: true, skipped: true, reason: "already_notified" })
    expect(sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it("sends once and stamps documents_notify_sent_at", async () => {
    const updates: unknown[] = []
    let inboundFromN = 0
    const supabase = {
      from: (table: string) => {
        if (table === "inbound_email_messages") {
          inboundFromN += 1
          if (inboundFromN === 1) {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { documents_notify_sent_at: null }, error: null }),
                }),
              }),
            }
          }
          return {
            update: (payload: unknown) => {
              updates.push(payload)
              return {
                eq: () => ({
                  is: () => Promise.resolve({ error: null }),
                }),
              }
            },
          }
        }
        if (table === "businesses") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { name: "Acme", email: "hello@acme.test", owner_id: null },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      },
    } as never

    const r = await notifyInboundDocumentsCreated(supabase, {
      messageId: MSG,
      businessId: BIZ,
      createdDocumentIds: [DOC],
      fileNames: ["inv.pdf"],
      senderAddress: "supplier@test.com",
      subject: "Bill",
    })

    expect(r).toEqual({ ok: true, sent: true })
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1)
    const call = jest.mocked(sendTransactionalEmail).mock.calls[0][0]
    expect(call.to).toBe("hello@acme.test")
    expect(call.subject).toBe("New document received in Finza")
    expect(call.html).toContain("supplier@test.com")
    expect(updates.length).toBeGreaterThan(0)
  })
})
