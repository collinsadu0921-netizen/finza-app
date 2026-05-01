/**
 * Subscription lifecycle emails: dedupe, no recipient, send + log wiring.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"

jest.mock("@/lib/email/sendTransactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(),
}))

jest.mock("@/lib/supabaseAdmin", () => ({
  createSupabaseAdminClient: jest.fn(),
}))

import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { sendSubscriptionLifecycleNotification } from "@/lib/serviceWorkspace/sendSubscriptionLifecycleNotification"

const BIZ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

beforeEach(() => {
  jest.mocked(sendTransactionalEmail).mockReset()
  jest.mocked(sendTransactionalEmail).mockResolvedValue({ success: true, id: "re_test_1" })
  jest.mocked(createSupabaseAdminClient).mockReset()
})

function adminWithChains(opts: {
  businessRow: Record<string, unknown> | null
  dupRow?: { id: string } | null
  insertError?: { code?: string; message?: string } | null
  ownerAuthEmail?: string | null
}) {
  const getUserById = jest.fn().mockResolvedValue({
    data: {
      user: opts.ownerAuthEmail ? { email: opts.ownerAuthEmail } : { email: null },
    },
    error: null,
  })

  const notificationsSelect = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({
      data: opts.dupRow ?? null,
      error: null,
    }),
  }

  const admin = {
    from: jest.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: opts.businessRow,
            error: opts.businessRow ? null : { message: "not found" },
          }),
        }
      }
      if (table === "subscription_notification_events") {
        return opts.dupRow !== undefined
          ? notificationsSelect
          : {
              insert: jest.fn().mockResolvedValue({
                data: null,
                error: opts.insertError ?? null,
              }),
            }
      }
      return {}
    }),
    auth: {
      admin: {
        getUserById,
      },
    },
  }

  return { admin, getUserById, notificationsSelect }
}

describe("sendSubscriptionLifecycleNotification", () => {
  it("returns no_recipient when business email missing and owner has no auth email", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    const { admin } = adminWithChains({
      businessRow: {
        name: "Co",
        email: null,
        owner_id: "owner-1",
      },
      ownerAuthEmail: null,
    })
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    const r = await sendSubscriptionLifecycleNotification({
      businessId: BIZ,
      eventType: "payment_failed_grace_started",
      lifecycleKey: "k1",
    })
    expect(r).toEqual({ ok: true, skipped: true, reason: "no_recipient" })
    expect(sendTransactionalEmail).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("skips send when dedupe row already exists", async () => {
    const { admin } = adminWithChains({
      businessRow: {
        name: "Co",
        email: "biz@test.co",
        owner_id: "owner-1",
      },
      dupRow: { id: "existing" },
    })
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    const r = await sendSubscriptionLifecycleNotification({
      businessId: BIZ,
      eventType: "subscription_reactivated",
      lifecycleKey: "ref-1",
    })
    expect(r).toEqual({ ok: true, skipped: true, reason: "duplicate" })
    expect(sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it("sends email and inserts log on success", async () => {
    const insertMock = jest.fn().mockResolvedValue({ data: { id: "log1" }, error: null })
    let subNotifCalls = 0
    const admin = {
      from: jest.fn((table: string) => {
        if (table === "businesses") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { name: "Co", email: "biz@test.co", owner_id: "owner-1" },
              error: null,
            }),
          }
        }
        if (table === "subscription_notification_events") {
          subNotifCalls += 1
          if (subNotifCalls === 1) {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            }
          }
          return { insert: insertMock }
        }
        return {}
      }),
      auth: {
        admin: {
          getUserById: jest.fn(),
        },
      },
    }
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    const r = await sendSubscriptionLifecycleNotification({
      businessId: BIZ,
      eventType: "payment_failed_grace_started",
      lifecycleKey: "grace|ref",
    })
    expect(r.ok).toBe(true)
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "biz@test.co",
        subject: "Your Finza subscription payment failed",
      })
    )
    expect(insertMock).toHaveBeenCalled()
  })
})
