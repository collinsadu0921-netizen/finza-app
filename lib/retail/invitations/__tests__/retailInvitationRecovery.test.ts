import { describe, expect, it, jest } from "@jest/globals"
import {
  classifyRetailInvitationForUser,
  hashRetailInvitationToken,
  isPlausibleRetailInviteToken,
  maskEmailForUi,
  normalizeRetailInviteEmail,
  retailInvitationTokenFromPath,
  safeRetailInviteNextPath,
} from "../retailInvitationToken"
import {
  pendingRetailInvitationForEmail,
  previewRetailInvitation,
} from "../retailInvitationAdmin"

jest.mock("server-only", () => ({}))

describe("retail invitation recovery", () => {
  it("never treats resume as a token", () => {
    expect(isPlausibleRetailInviteToken("resume")).toBe(false)
    expect(retailInvitationTokenFromPath("/retail/invite/resume")).toBeNull()
    expect(safeRetailInviteNextPath("/retail/invite/resume")).toBe("/retail/invite/resume")
  })

  it("normalizes uppercase and surrounding spaces for email match", () => {
    expect(normalizeRetailInviteEmail("  RoadPav6@Gmail.COM ")).toBe("roadpav6@gmail.com")
    expect(
      classifyRetailInvitationForUser({
        status: "pending",
        expiresAt: "2099-01-01T00:00:00.000Z",
        invitationEmail: "roadpav6@gmail.com",
        userEmail: "  RoadPav6@Gmail.COM ",
      })
    ).toBe("ready")
  })

  it("denies a mismatched manager/admin session and unavailable invitations", () => {
    expect(
      classifyRetailInvitationForUser({
        status: "pending",
        expiresAt: "2099-01-01T00:00:00.000Z",
        invitationEmail: "roadpav6@gmail.com",
        userEmail: "support@finza.africa",
      })
    ).toBe("denied")
    for (const status of ["accepted", "revoked", "expired"]) {
      expect(
        classifyRetailInvitationForUser({
          status,
          expiresAt: "2099-01-01T00:00:00.000Z",
          invitationEmail: "roadpav6@gmail.com",
          userEmail: "roadpav6@gmail.com",
        })
      ).toBe("unavailable")
    }
  })

  it("masks signed-in emails for mismatch UI", () => {
    expect(maskEmailForUi("roadpav6@gmail.com")).toBe("ro…@gmail.com")
    expect(maskEmailForUi("support@finza.africa")).toBe("su…@finza.africa")
  })

  it("preview: matching email, mismatched admin session, and resume token", async () => {
    const token = "a".repeat(32)
    const tokenHash = hashRetailInvitationToken(token)
    const row = {
      id: "inv-1",
      status: "pending",
      expires_at: "2099-01-01T00:00:00.000Z",
      email_normalized: "roadpav6@gmail.com",
      business_name: "Finza Retail invite",
      token_version: 1,
      token_hash: tokenHash,
    }
    const admin = {
      from: () => ({
        select: () => ({
          eq: (_col: string, value: string) => ({
            maybeSingle: async () => ({
              data: value === tokenHash ? row : null,
              error: null,
            }),
          }),
        }),
        update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    } as never

    const match = await previewRetailInvitation(admin, token, {
      userId: "0fdfc148-a9f4-4b88-b117-72d8622e756d",
      email: "RoadPav6@gmail.com",
    })
    expect(match).toMatchObject({
      state: "ready",
      emailMatches: true,
      businessName: "Finza Retail invite",
      signedInUserId: "0fdfc148-a9f4-4b88-b117-72d8622e756d",
    })

    const mismatch = await previewRetailInvitation(admin, token, {
      userId: "admin-1",
      email: "support@finza.africa",
    })
    expect(mismatch).toMatchObject({
      state: "ready",
      emailMatches: false,
      businessName: null,
      signedInUserId: "admin-1",
      signedInEmailMasked: "su…@finza.africa",
    })

    const resume = await previewRetailInvitation(admin, "resume", {
      userId: "0fdfc148-a9f4-4b88-b117-72d8622e756d",
      email: "roadpav6@gmail.com",
    })
    expect(resume.state).toBe("invalid")
  })

  it("resume pending lookup returns newest of multiple and null when none", async () => {
    const withRows = (rows: Array<Record<string, unknown>>) =>
      ({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => Promise.resolve({ data: rows, error: null }),
              }),
            }),
          }),
        }),
      }) as never

    const pending = await pendingRetailInvitationForEmail(
      withRows([
        {
          id: "newer",
          business_name: "New Retail",
          status: "pending",
          expires_at: "2099-01-01T00:00:00.000Z",
        },
        {
          id: "older",
          business_name: "Old Retail",
          status: "pending",
          expires_at: "2099-01-01T00:00:00.000Z",
        },
      ]),
      "  RoadPav6@Gmail.COM "
    )
    expect(pending).toEqual({
      id: "newer",
      businessName: "New Retail",
      pendingCount: 2,
    })

    expect(await pendingRetailInvitationForEmail(withRows([]), "roadpav6@gmail.com")).toBeNull()
  })

  it("create button is only enabled when preview is ready and email matches", () => {
    const canAccept = (preview: {
      state: string
      emailMatches?: boolean | null
      working?: boolean
    }) => preview.state === "ready" && preview.emailMatches === true && !preview.working
    expect(canAccept({ state: "invalid" })).toBe(false)
    expect(canAccept({ state: "ready", emailMatches: false })).toBe(false)
    expect(canAccept({ state: "ready", emailMatches: null })).toBe(false)
    expect(canAccept({ state: "ready", emailMatches: true, working: true })).toBe(false)
    expect(canAccept({ state: "ready", emailMatches: true })).toBe(true)
  })
})
