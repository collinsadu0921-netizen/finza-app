/**
 * PUT /api/business/profile — onboarding identity/contact validation and trims.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { PUT } from "../route"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))

jest.mock("@/lib/retail/retailSensitiveSettingsEditors", () => ({
  canEditBusinessWideSensitiveSettings: jest.fn(() => true),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"

const createClient = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>
const getUserRoleMock = getUserRole as jest.MockedFunction<typeof getUserRole>

function makeBusinessRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    owner_id: "u1",
    name: "Acme Setup",
    legal_name: null,
    trading_name: null,
    phone: null,
    email: null,
    address_country: "Ghana",
    address_region: null,
    address_city: null,
    address_street: null,
    website: null,
    tin: null,
    logo_url: null,
    default_currency: "GHS",
    start_date: null,
    onboarding_step: "business_profile",
    industry: "service",
    archived_at: null,
    cit_rate_code: "standard_25",
    vat_scheme: "standard",
    business_type: "limited_company",
    ...overrides,
  }
}

function makeSupabaseForPut(baseRow: Record<string, unknown>, user: { id: string; email: string | null }) {
  const businessesTable: Record<string, unknown> = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: baseRow, error: null }),
    update: jest.fn().mockImplementation((payload: Record<string, unknown>) => {
      const merged = { ...baseRow, ...payload }
      return {
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: merged, error: null }),
          }),
        }),
      }
    }),
  }

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: user.id, email: user.email } },
        error: null,
      }),
    },
    from: jest.fn((table: string) => {
      if (table === "businesses") return businessesTable
      return {}
    }),
  }
}

function jsonRequest(body: unknown) {
  return new NextRequest("http://localhost/api/business/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PUT /api/business/profile", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getUserRoleMock.mockResolvedValue("admin")
  })

  it("onboarding: name only + auth email + empty legal/trading/phone/body email → save succeeds", async () => {
    const base = makeBusinessRow({ name: "Acme Setup", email: null, phone: null })
    createClient.mockResolvedValue(makeSupabaseForPut(base, { id: "u1", email: "owner@example.com" }) as any)

    const res = await PUT(
      jsonRequest({
        business_id: "b1",
        legal_name: "",
        trading_name: "",
        phone: "",
        email: "",
        address_country: "Ghana",
        default_currency: "GHS",
        address_street: "",
        address_city: "",
        address_region: "",
        website: "",
        tin: "",
        logo_url: "",
        start_date: "",
        cit_rate_code: "standard_25",
        vat_scheme: "standard",
        business_type: "limited_company",
      })
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { business: { email: string | null; onboarding_step: string } }
    expect(json.business.email).toBe("owner@example.com")
    expect(json.business.onboarding_step).toBe("industry_confirmation")
  })

  it("onboarding: name + phone only (whitespace-trimmed), empty legal/trading → save succeeds", async () => {
    const base = makeBusinessRow()
    createClient.mockResolvedValue(makeSupabaseForPut(base, { id: "u1", email: null }) as any)

    const res = await PUT(
      jsonRequest({
        business_id: "b1",
        legal_name: "   ",
        trading_name: "",
        phone: "  +233 24  ",
        email: "",
        address_country: "Ghana",
        default_currency: "GHS",
        address_street: "",
        address_city: "",
        address_region: "",
        website: "",
        tin: "",
        logo_url: "",
        start_date: "",
        cit_rate_code: "standard_25",
        vat_scheme: "standard",
        business_type: "limited_company",
      })
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { business: { phone: string | null } }
    expect(json.business.phone).toBe("+233 24")
  })

  it("onboarding: no name, no legal, no trading → identity error", async () => {
    const base = makeBusinessRow({ name: "  ", legal_name: null, trading_name: null })
    createClient.mockResolvedValue(makeSupabaseForPut(base, { id: "u1", email: "a@b.com" }) as any)

    const res = await PUT(
      jsonRequest({
        business_id: "b1",
        legal_name: "",
        trading_name: "",
        phone: "1",
        email: "x@y.com",
        address_country: "Ghana",
        default_currency: "GHS",
      })
    )

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain("Business name, legal name, or trading name")
  })

  it("onboarding: no phone, no email, no auth email → contact error", async () => {
    const base = makeBusinessRow({ name: "Has Name", email: null, phone: null })
    createClient.mockResolvedValue(makeSupabaseForPut(base, { id: "u1", email: null }) as any)

    const res = await PUT(
      jsonRequest({
        business_id: "b1",
        legal_name: "",
        trading_name: "",
        phone: "",
        email: "",
        address_country: "Ghana",
        default_currency: "GHS",
      })
    )

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain("contact method")
  })

  it("onboarding: does not return contact error when identity is missing but phone is set", async () => {
    const base = makeBusinessRow({ name: "  ", legal_name: null, trading_name: null })
    createClient.mockResolvedValue(makeSupabaseForPut(base, { id: "u1", email: "a@b.com" }) as any)

    const res = await PUT(
      jsonRequest({
        business_id: "b1",
        legal_name: "",
        trading_name: "",
        phone: "+1",
        email: "",
        address_country: "Ghana",
        default_currency: "GHS",
      })
    )

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain("Business name, legal name, or trading name")
    expect(json.error).not.toMatch(/contact method/i)
  })
})
