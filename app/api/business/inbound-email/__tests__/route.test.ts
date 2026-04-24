/**
 * GET/POST/PATCH /api/business/inbound-email — auth, tier, role, and delegation to route management.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest, NextResponse } from "next/server"
import { GET, POST, PATCH } from "../route"
import * as mgmt from "@/lib/businessInboundEmail/inboundEmailRouteManagement"
import * as enforce from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { getUserRole } from "@/lib/userRoles"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))

jest.mock("@/lib/businessInboundEmail/inboundEmailRouteManagement", () => ({
  getConfiguredInboundEmailDomain: jest.fn(),
  fetchInboundRouteForBusiness: jest.fn(),
  createInboundRouteForBusiness: jest.fn(),
  rotateInboundRouteForBusiness: jest.fn(),
  setInboundRouteActiveForBusiness: jest.fn(),
}))

jest.mock("@/lib/serviceWorkspace/enforceServiceWorkspaceAccess", () => ({
  enforceServiceWorkspaceAccess: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

const mockGetUser = jest.fn()
const mockCreateClient = jest.mocked(createSupabaseServerClient)
const mockGetUserRole = jest.mocked(getUserRole)
const mockEnforce = jest.mocked(enforce.enforceServiceWorkspaceAccess)
const mockDomain = jest.mocked(mgmt.getConfiguredInboundEmailDomain)
const mockFetch = jest.mocked(mgmt.fetchInboundRouteForBusiness)
const mockCreate = jest.mocked(mgmt.createInboundRouteForBusiness)
const mockRotate = jest.mocked(mgmt.rotateInboundRouteForBusiness)
const mockSetActive = jest.mocked(mgmt.setInboundRouteActiveForBusiness)

const sampleRoute = {
  id: "r1",
  business_id: "b1",
  recipient_address: "fd" + "0".repeat(40) + "@in.test",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: mockGetUser,
    },
  } as never)
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } })
  mockEnforce.mockResolvedValue(null)
  mockGetUserRole.mockResolvedValue("admin")
  mockDomain.mockReturnValue("in.test")
})

describe("GET /api/business/inbound-email", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await GET(new NextRequest("http://localhost/api/business/inbound-email?business_id=b1"))
    expect(res.status).toBe(401)
  })

  it("returns 400 when business_id missing", async () => {
    const res = await GET(new NextRequest("http://localhost/api/business/inbound-email"))
    expect(res.status).toBe(400)
  })

  it("returns 403 when service workspace access denied", async () => {
    mockEnforce.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }) as never)
    const res = await GET(new NextRequest("http://localhost/api/business/inbound-email?business_id=b1"))
    expect(res.status).toBe(403)
  })

  it("returns domain flags and route", async () => {
    mockFetch.mockResolvedValueOnce(sampleRoute)
    const res = await GET(new NextRequest("http://localhost/api/business/inbound-email?business_id=b1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.domain_configured).toBe(true)
    expect(json.domain).toBe("in.test")
    expect(json.route?.recipient_address).toBe(sampleRoute.recipient_address)
    expect(mockFetch).toHaveBeenCalledWith(expect.anything(), "b1")
  })
})

describe("POST /api/business/inbound-email", () => {
  function post(body: object) {
    return new NextRequest("http://localhost/api/business/inbound-email", {
      method: "POST",
      body: JSON.stringify(body),
    })
  }

  it("returns 503 when inbound domain is not configured", async () => {
    mockDomain.mockReturnValueOnce(null)
    const res = await POST(post({ business_id: "b1", action: "create" }))
    expect(res.status).toBe(503)
  })

  it("returns 403 when user is not owner/admin", async () => {
    mockGetUserRole.mockResolvedValueOnce("employee")
    const res = await POST(post({ business_id: "b1", action: "create" }))
    expect(res.status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("creates route and returns created flag", async () => {
    mockCreate.mockResolvedValueOnce({ row: sampleRoute, created: true })
    const res = await POST(post({ business_id: "b1", action: "create" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.created).toBe(true)
    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), "b1", "in.test")
  })

  it("rotates when action is rotate", async () => {
    mockRotate.mockResolvedValueOnce({ row: { ...sampleRoute, recipient_address: "fd" + "f".repeat(40) + "@in.test" } })
    const res = await POST(post({ business_id: "b1", action: "rotate" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.rotated).toBe(true)
    expect(mockRotate).toHaveBeenCalledWith(expect.anything(), "b1", "in.test")
  })
})

describe("PATCH /api/business/inbound-email", () => {
  function patch(body: object) {
    return new NextRequest("http://localhost/api/business/inbound-email", {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  }

  it("returns 400 when is_active is not boolean", async () => {
    const res = await PATCH(patch({ business_id: "b1", is_active: "no" }))
    expect(res.status).toBe(400)
  })

  it("returns 403 when user cannot manage settings", async () => {
    mockGetUserRole.mockResolvedValueOnce("manager")
    const res = await PATCH(patch({ business_id: "b1", is_active: false }))
    expect(res.status).toBe(403)
    expect(mockSetActive).not.toHaveBeenCalled()
  })

  it("deactivates route", async () => {
    mockSetActive.mockResolvedValueOnce({ row: { ...sampleRoute, is_active: false } })
    const res = await PATCH(patch({ business_id: "b1", is_active: false }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.route.is_active).toBe(false)
    expect(mockSetActive).toHaveBeenCalledWith(expect.anything(), "b1", false)
  })
})
