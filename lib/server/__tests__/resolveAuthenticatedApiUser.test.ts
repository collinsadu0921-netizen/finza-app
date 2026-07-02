import type { SupabaseClient, User } from "@supabase/supabase-js"

import {
  hasSupabaseAuthCookieHeader,
  resolveAuthenticatedApiUser,
  authFailureStageForScopeError,
} from "../resolveAuthenticatedApiUser"

function mockUser(id = "user-1"): User {
  return {
    id,
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as User
}

function mockSupabase(handlers: {
  getSession?: jest.Mock
  getUser?: jest.Mock
}) {
  return {
    auth: {
      getSession: handlers.getSession ?? jest.fn().mockResolvedValue({ data: { session: null } }),
      getUser: handlers.getUser ?? jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  } as unknown as SupabaseClient
}

describe("resolveAuthenticatedApiUser", () => {
  it("returns session user without calling getUser when session is valid", async () => {
    const getUser = jest.fn()
    const supabase = mockSupabase({
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: mockUser("sess-user") } },
      }),
      getUser,
    })

    const result = await resolveAuthenticatedApiUser(supabase, {
      cookieHeader: "sb-test-auth-token=eyJhIjoxfQ",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user.id).toBe("sess-user")
      expect(result.authSource).toBe("session")
    }
    expect(getUser).not.toHaveBeenCalled()
  })

  it("falls back to getUser when session empty but auth cookie present", async () => {
    const supabase = mockSupabase({
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      getUser: jest.fn().mockResolvedValue({ data: { user: mockUser("rpc-user") }, error: null }),
    })

    const result = await resolveAuthenticatedApiUser(supabase, {
      cookieHeader: "sb-test-auth-token=eyJhIjoxfQ",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user.id).toBe("rpc-user")
      expect(result.authSource).toBe("get_user")
    }
  })

  it("returns missing_cookie when no cookie and no session", async () => {
    const supabase = mockSupabase({
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
    })

    const result = await resolveAuthenticatedApiUser(supabase, { cookieHeader: "" })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.authFailureStage).toBe("missing_cookie")
    }
  })

  it("returns get_user_failed when cookie present but both session and getUser fail", async () => {
    const supabase = mockSupabase({
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      getUser: jest.fn().mockResolvedValue({
        data: { user: null },
        error: { message: "Auth server unavailable" },
      }),
    })

    const result = await resolveAuthenticatedApiUser(supabase, {
      cookieHeader: "sb-test-auth-token=eyJhIjoxfQ",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.authFailureStage).toBe("get_user_failed")
    }
  })
})

describe("hasSupabaseAuthCookieHeader", () => {
  it("detects sb auth cookie name without reading value", () => {
    expect(hasSupabaseAuthCookieHeader("foo=1; sb-abc-auth-token=secret")).toBe(true)
    expect(hasSupabaseAuthCookieHeader("foo=1")).toBe(false)
  })
})

describe("authFailureStageForScopeError", () => {
  it("maps scope errors to diagnostic stages", () => {
    expect(authFailureStageForScopeError(403)).toBe("business_access_denied")
    expect(authFailureStageForScopeError(404)).toBe("business_context_missing")
    expect(authFailureStageForScopeError(500)).toBe("unknown")
  })
})
