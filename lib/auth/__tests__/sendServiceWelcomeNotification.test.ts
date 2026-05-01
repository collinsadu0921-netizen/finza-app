/**
 * Service welcome + internal signup alert: recipients, dedupe, fallbacks.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals"

jest.mock("@/lib/email/sendTransactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(),
}))

jest.mock("@/lib/supabaseAdmin", () => ({
  createSupabaseAdminClient: jest.fn(),
}))

import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import {
  resolveFinzaSupportEmailForWelcome,
  resolveInternalCustomerSuccessRecipient,
  sendServiceWelcomeNotificationsAfterProvision,
} from "@/lib/auth/sendServiceWelcomeNotification"

const BIZ = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const OWNER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

beforeEach(() => {
  jest.mocked(sendTransactionalEmail).mockReset()
  jest.mocked(sendTransactionalEmail).mockResolvedValue({ success: true, id: "re_1" })
  jest.mocked(createSupabaseAdminClient).mockReset()
  process.env.FINZA_CUSTOMER_SUCCESS_EMAIL = ""
  process.env.INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS = ""
  process.env.FINZA_SUPPORT_EMAIL = ""
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL = ""
})

afterEach(() => {
  delete process.env.FINZA_CUSTOMER_SUCCESS_EMAIL
  delete process.env.INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS
  delete process.env.FINZA_SUPPORT_EMAIL
  delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL
})

describe("resolveFinzaSupportEmailForWelcome", () => {
  it("uses FINZA_SUPPORT_EMAIL when set", () => {
    process.env.FINZA_SUPPORT_EMAIL = "help@co.test"
    expect(resolveFinzaSupportEmailForWelcome()).toBe("help@co.test")
  })

  it("falls back to support@finza.africa", () => {
    expect(resolveFinzaSupportEmailForWelcome()).toBe("support@finza.africa")
  })
})

describe("resolveInternalCustomerSuccessRecipient", () => {
  it("prefers FINZA_CUSTOMER_SUCCESS_EMAIL", () => {
    process.env.FINZA_CUSTOMER_SUCCESS_EMAIL = "cs@co.test"
    expect(resolveInternalCustomerSuccessRecipient()).toBe("cs@co.test")
  })

  it("falls back to first INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS entry", () => {
    process.env.INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS = "ops@co.test, other@co.test"
    expect(resolveInternalCustomerSuccessRecipient()).toBe("ops@co.test")
  })

  it("returns null when no env", () => {
    expect(resolveInternalCustomerSuccessRecipient()).toBeNull()
  })
})

function buildAdminMock(opts: {
  business: Record<string, unknown>
  ownerEmail: string | null
  dupWelcome?: boolean
  dupInternal?: boolean
}) {
  const tenantEvents = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest
      .fn()
      .mockResolvedValueOnce(opts.dupWelcome ? { data: { id: "x" }, error: null } : { data: null, error: null })
      .mockResolvedValueOnce(opts.dupInternal ? { data: { id: "y" }, error: null } : { data: null, error: null }),
    insert: jest.fn().mockResolvedValue({ error: null }),
  }

  const admin = {
    from: jest.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: opts.business, error: null }),
        }
      }
      if (table === "tenant_notification_events") {
        return tenantEvents
      }
      return {}
    }),
    auth: {
      admin: {
        getUserById: jest.fn().mockResolvedValue({
          data: { user: opts.ownerEmail ? { email: opts.ownerEmail } : { email: null } },
          error: null,
        }),
      },
    },
  }
  return { admin, tenantEvents }
}

describe("sendServiceWelcomeNotificationsAfterProvision", () => {
  it("sends welcome to owner and internal alert when env set", async () => {
    process.env.FINZA_CUSTOMER_SUCCESS_EMAIL = "internal@co.test"
    const { admin, tenantEvents } = buildAdminMock({
      business: {
        id: BIZ,
        name: "Acme",
        email: "biz@co.test",
        phone: "+233",
        service_subscription_tier: "starter",
        service_subscription_status: "trialing",
        trial_ends_at: "2026-07-01T00:00:00.000Z",
        created_at: "2026-06-01T00:00:00.000Z",
      },
      ownerEmail: "owner@co.test",
    })
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    await sendServiceWelcomeNotificationsAfterProvision({ businessId: BIZ, ownerUserId: OWNER })

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2)
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@co.test",
        subject: "Welcome to Finza Service",
      })
    )
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "internal@co.test",
        subject: "New Finza Service signup",
      })
    )
    expect(tenantEvents.maybeSingle).toHaveBeenCalled()
  })

  it("falls back welcome to business email when owner has no email", async () => {
    process.env.FINZA_CUSTOMER_SUCCESS_EMAIL = "internal@co.test"
    const { admin } = buildAdminMock({
      business: {
        id: BIZ,
        name: "Acme",
        email: "biz@co.test",
        phone: null,
        service_subscription_tier: "starter",
        service_subscription_status: "active",
        trial_ends_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
      },
      ownerEmail: null,
    })
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    await sendServiceWelcomeNotificationsAfterProvision({ businessId: BIZ, ownerUserId: OWNER })

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "biz@co.test",
        subject: "Welcome to Finza Service",
      })
    )
  })

  it("skips internal alert when no internal recipient env", async () => {
    const { admin } = buildAdminMock({
      business: {
        id: BIZ,
        name: "Acme",
        email: "biz@co.test",
        phone: null,
        service_subscription_tier: "starter",
        service_subscription_status: "active",
        trial_ends_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
      },
      ownerEmail: "owner@co.test",
    })
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    await sendServiceWelcomeNotificationsAfterProvision({ businessId: BIZ, ownerUserId: OWNER })

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1)
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Welcome to Finza Service" })
    )
  })

  it("does not resend welcome when dedupe row exists", async () => {
    process.env.FINZA_CUSTOMER_SUCCESS_EMAIL = "internal@co.test"
    const { admin } = buildAdminMock({
      business: {
        id: BIZ,
        name: "Acme",
        email: null,
        phone: null,
        service_subscription_tier: "starter",
        service_subscription_status: "active",
        trial_ends_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
      },
      ownerEmail: "owner@co.test",
      dupWelcome: true,
      dupInternal: true,
    })
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    await sendServiceWelcomeNotificationsAfterProvision({ businessId: BIZ, ownerUserId: OWNER })

    expect(sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it("continues after welcome send failure (internal still attempted)", async () => {
    process.env.FINZA_CUSTOMER_SUCCESS_EMAIL = "internal@co.test"
    jest
      .mocked(sendTransactionalEmail)
      .mockResolvedValueOnce({ success: false, reason: "resend_down" })
      .mockResolvedValueOnce({ success: true, id: "re_2" })

    const { admin } = buildAdminMock({
      business: {
        id: BIZ,
        name: "Acme",
        email: null,
        phone: null,
        service_subscription_tier: "starter",
        service_subscription_status: "active",
        trial_ends_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
      },
      ownerEmail: "owner@co.test",
    })
    jest.mocked(createSupabaseAdminClient).mockReturnValue(admin as never)

    await expect(
      sendServiceWelcomeNotificationsAfterProvision({ businessId: BIZ, ownerUserId: OWNER })
    ).resolves.toBeUndefined()

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2)
  })
})
