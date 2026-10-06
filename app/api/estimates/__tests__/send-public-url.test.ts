import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  requireBusinessScopeForUser: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite", () => ({
  enforceServiceIndustryFinancialWrite: jest.fn().mockResolvedValue(null),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("@/lib/communication/whatsappLink", () => ({
  buildWhatsAppLink: jest.fn((_phone: string, message: string) => ({
    ok: true,
    whatsappUrl: `https://wa.me/233200000000?text=${encodeURIComponent(message)}`,
  })),
}))
jest.mock("@/lib/communication/getBusinessWhatsAppTemplate", () => ({
  getBusinessWhatsAppTemplate: jest.fn().mockResolvedValue("{{public_url}}"),
}))
jest.mock("@/lib/communication/renderWhatsAppTemplate", () => ({
  renderWhatsAppTemplate: jest.fn((_template: string, vars: { public_url?: string }) => vars.public_url || ""),
}))
jest.mock("@/lib/documentState", () => ({
  isValidEstimateTransition: jest.fn(() => true),
}))
jest.mock("@/lib/email/sendServiceWorkspaceDocumentEmail", () => ({
  sendServiceWorkspaceDocumentEmail: jest.fn(),
}))
jest.mock("@/lib/email/sendTransactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireBusinessScopeForUser } from "@/lib/business"
import { sendServiceWorkspaceDocumentEmail } from "@/lib/email/sendServiceWorkspaceDocumentEmail"
import { POST } from "../[id]/send/route"

const mockSupabase = createSupabaseServerClient as jest.Mock
const mockScope = requireBusinessScopeForUser as jest.Mock
const mockEmail = sendServiceWorkspaceDocumentEmail as jest.Mock

function client(options: {
  publicToken: string | null
  updateError?: { message: string } | null
}) {
  const updates: Record<string, unknown>[] = []
  return {
    updates,
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    from(table: string) {
      if (table === "customers") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: "cust-1",
                  name: "Ama",
                  email: "ama@example.com",
                  phone: "0240000000",
                  whatsapp_phone: "0240000000",
                },
              }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: "est-1",
                  business_id: "biz-1",
                  customer_id: "cust-1",
                  status: "sent",
                  public_token: options.publicToken,
                  estimate_number: "QUO-0010",
                  businesses: { trading_name: "Cleaning Co", industry: "service", email: "co@example.com" },
                },
                error: null,
              }),
            }),
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: () => ({
            eq: async () => {
              updates.push(values)
              return { error: options.updateError ?? null }
            },
          }),
        }),
      }
    },
  }
}

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("https://finza-preview.vercel.app/api/estimates/est-1/send", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: "est-1" }) }
  )
}

describe("estimate send public URL", () => {
  const previous = {
    app: process.env.NEXT_PUBLIC_APP_URL,
    vercel: process.env.VERCEL_ENV,
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com"
    process.env.VERCEL_ENV = "preview"
    mockScope.mockResolvedValue({ ok: true, businessId: "biz-1" })
    mockEmail.mockReset()
    mockEmail.mockResolvedValue({ success: true })
  })

  afterAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = previous.app
    process.env.VERCEL_ENV = previous.vercel
  })

  it("reuses an existing token for WhatsApp, email, and copy link", async () => {
    const supabase = client({ publicToken: "tok-existing" })
    mockSupabase.mockResolvedValue(supabase)

    const whatsapp = await post({ sendWhatsApp: true, business_id: "biz-1" })
    const whatsappBody = await whatsapp.json()
    expect(whatsapp.status).toBe(200)
    expect(decodeURIComponent(whatsappBody.whatsappUrl)).toContain(
      "https://finza-preview.vercel.app/quote-public/tok-existing"
    )

    const email = await post({ sendEmail: true, business_id: "biz-1" })
    expect(email.status).toBe(200)
    expect(mockEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        publicUrl: "https://finza-preview.vercel.app/quote-public/tok-existing",
      })
    )

    const copy = await post({ copyLink: true, business_id: "biz-1" })
    const copyBody = await copy.json()
    expect(copy.status).toBe(200)
    expect(copyBody.publicUrl).toBe("https://finza-preview.vercel.app/quote-public/tok-existing")
    expect(supabase.updates.some((row) => "public_token" in row)).toBe(false)
  })

  it("persists a missing token before WhatsApp returns a URL", async () => {
    const supabase = client({ publicToken: null })
    mockSupabase.mockResolvedValue(supabase)
    const res = await post({ sendWhatsApp: true, business_id: "biz-1" })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(supabase.updates.some((row) => String(row.public_token || "").startsWith("est_est-1_"))).toBe(true)
    expect(decodeURIComponent(body.whatsappUrl)).toContain("/quote-public/est_est-1_")
    expect(decodeURIComponent(body.whatsappUrl)).not.toContain("localhost")
  })

  it("does not return a URL when token persistence fails", async () => {
    const supabase = client({ publicToken: null, updateError: { message: "db down" } })
    mockSupabase.mockResolvedValue(supabase)
    const res = await post({ copyLink: true, business_id: "biz-1" })
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.publicUrl).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain("http")
    expect(mockEmail).not.toHaveBeenCalled()
  })
})
