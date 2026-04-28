/**
 * Routing, unknown recipient, and idempotent completed-message short-circuit.
 */

jest.mock("@/lib/email/sendInboundDocumentsReceivedNotification", () => ({
  notifyInboundDocumentsCreated: jest.fn().mockResolvedValue({ ok: true, sent: true }),
}))

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import {
  ingestNormalizedInboundEmail,
  resolveInboundEmailRouting,
} from "@/lib/email/inboundEmailIngestionService"
import type { NormalizedInboundEmailPayload } from "@/lib/email/inboundEmailNormalizedPayload"
import { notifyInboundDocumentsCreated } from "@/lib/email/sendInboundDocumentsReceivedNotification"

function routesChain(result: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => result,
        }),
      }),
    }),
  }
}

function messagesChain(result: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => result,
        }),
      }),
    }),
  }
}

describe("resolveInboundEmailRouting", () => {
  it("returns business when recipient matches an active route", async () => {
    const supabase = {
      from: (table: string) => {
        if (table === "business_inbound_email_routes") {
          return routesChain({ data: { business_id: "biz-uuid" }, error: null })
        }
        return {}
      },
    } as never

    const r = await resolveInboundEmailRouting(supabase, ["docs+token@inbound.example.com"])
    expect(r).toEqual({
      businessId: "biz-uuid",
      matchedRecipient: "docs+token@inbound.example.com",
    })
  })

  it("returns null when no route matches", async () => {
    const supabase = {
      from: () => routesChain({ data: null, error: null }),
    } as never
    const r = await resolveInboundEmailRouting(supabase, ["orphan@nowhere.test"])
    expect(r).toBeNull()
  })
})

describe("ingestNormalizedInboundEmail", () => {
  beforeEach(() => {
    jest.mocked(notifyInboundDocumentsCreated).mockClear()
  })

  const minimalPayload: NormalizedInboundEmailPayload = {
    provider: "resend",
    providerMessageId: "email-uuid-1",
    recipientAddresses: ["orphan@nowhere.test"],
    senderAddress: "sender@external.test",
    subject: "Hello",
    receivedAtIso: "2026-01-02T12:00:00.000Z",
    attachments: [],
  }

  it("ignores unknown inbound recipient without touching inbound_email_messages", async () => {
    const from = jest.fn((table: string) => {
      if (table === "business_inbound_email_routes") {
        return routesChain({ data: null, error: null })
      }
      throw new Error(`unexpected table ${table}`)
    })
    const supabase = { from } as never
    const r = await ingestNormalizedInboundEmail(supabase, minimalPayload)
    expect(r).toEqual({ ok: true, ignored: true, reason: "unknown_recipient", attachmentsIngested: 0 })
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith("business_inbound_email_routes")
    expect(notifyInboundDocumentsCreated).not.toHaveBeenCalled()
  })

  it("short-circuits when inbound message is already completed (idempotent retry)", async () => {
    const from = jest.fn((table: string) => {
      if (table === "business_inbound_email_routes") {
        return routesChain({ data: { business_id: "biz-1" }, error: null })
      }
      if (table === "inbound_email_messages") {
        return messagesChain({
          data: { id: "msg-1", processing_status: "completed" },
          error: null,
        })
      }
      throw new Error(`unexpected table ${table}`)
    })
    const supabase = { from } as never
    const r = await ingestNormalizedInboundEmail(supabase, {
      ...minimalPayload,
      recipientAddresses: ["docs@biz.test"],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.idempotent).toBe(true)
      expect(r.businessId).toBe("biz-1")
      expect(r.messageId).toBe("msg-1")
      expect(r.attachmentsIngested).toBe(0)
    }
    expect(notifyInboundDocumentsCreated).not.toHaveBeenCalled()
  })
})
